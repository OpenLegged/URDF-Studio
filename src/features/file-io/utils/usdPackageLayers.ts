import type { RobotState, UrdfLink } from '../../../types/index.ts';
import {
  USD_GEOMETRY_TYPES as GEOMETRY_TYPES,
  getUsdGeometryType as getGeometryType,
} from './usdSceneNodeFactory.ts';
import {
  makeUsdIndent,
  sanitizeUsdIdentifier,
  serializeUsdPrimSpecWithMetadata,
} from './usdTextFormatting.ts';
import {
  ISAACSIM_DEFAULT_PHYSX_SCENE_BROADPHASE_TYPE,
  ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_CCD,
  ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_GPU_DYNAMICS,
  ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_STABILIZATION,
  ISAACSIM_DEFAULT_PHYSX_SCENE_SOLVER_TYPE,
  ZERO_EPSILON,
} from './usdIsaacSimDefaults.ts';
import { supportsPhysxMimicJoint } from './usdJointAttributeWriters.ts';
import {
  serializeClosedLoopConstraintDefinition,
  serializeJointDefinition,
  serializeLinkPhysicsOverride,
  serializeNestedLinkPhysicsOverrides,
} from './usdJointSerializer.ts';
import type {
  ResolvedUsdPackageLayoutProfile,
  UsdArchivePackage,
  UsdLayerFileFormat,
  UsdLinkPathMaps,
  UsdPackageLayerContents,
  UsdPackageLayoutOptions,
  UsdPackageLayoutProfile,
} from './usdPackageTypes.ts';

export type {
  ResolvedUsdPackageLayoutProfile,
  UsdArchivePackage,
  UsdLayerFileFormat,
  UsdLinkPathMaps,
  UsdPackageLayerContents,
  UsdPackageLayoutOptions,
  UsdPackageLayoutProfile,
} from './usdPackageTypes.ts';

type OmittedIsaacRootAnchor = {
  articulationRootLinkId: string;
  omittedJointIds: Set<string>;
  omittedLinkIds: Set<string>;
};

export const resolveUsdPackageLayoutProfile = (
  layoutProfile?: UsdPackageLayoutProfile,
): ResolvedUsdPackageLayoutProfile => {
  if (layoutProfile == null) {
    return 'legacy';
  }
  return layoutProfile === 'genesis' ? 'isaacsim' : layoutProfile;
};

const createIdentityBlob = (content: string): Blob => {
  return new Blob([content], { type: 'text/plain;charset=utf-8' });
};

const getUsdLayerExtension = (fileFormat: UsdLayerFileFormat = 'usd'): 'usd' | 'usda' => {
  return fileFormat === 'usda' ? 'usda' : 'usd';
};

const resolveUsdConfigStem = (
  packageRoot: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  if (layoutProfile === 'isaacsim') {
    // Isaac Sim exports keep sidecar stems aligned with the root prim name.
    return packageRoot;
  }
  return `${packageRoot}${packageRoot.includes('description') ? '' : '_description'}`;
};

const hasExportableGeometry = (
  geometry: UrdfLink['visual'] | UrdfLink['collision'] | undefined,
): boolean => {
  return geometry !== undefined && getGeometryType(geometry.type) !== GEOMETRY_TYPES.NONE;
};

const linkHasExportablePayload = (link: UrdfLink | undefined): boolean => {
  if (!link) {
    return false;
  }

  return (
    hasExportableGeometry(link.visual) ||
    hasExportableGeometry(link.collision) ||
    (link.visualBodies || []).some((body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE) ||
    (link.collisionBodies || []).some(
      (body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE,
    ) ||
    (link.mjcfSites?.length ?? 0) > 0
  );
};

const isNearZero = (value: number | null | undefined): boolean => {
  return Math.abs(Number(value || 0)) <= ZERO_EPSILON;
};

const isMasslessLink = (link: UrdfLink | undefined): boolean => {
  if (!link?.inertial) {
    return true;
  }

  return (
    isNearZero(link.inertial.mass) &&
    isNearZero(link.inertial.inertia?.ixx) &&
    isNearZero(link.inertial.inertia?.ixy) &&
    isNearZero(link.inertial.inertia?.ixz) &&
    isNearZero(link.inertial.inertia?.iyy) &&
    isNearZero(link.inertial.inertia?.iyz) &&
    isNearZero(link.inertial.inertia?.izz)
  );
};

const resolveOmittedIsaacRootAnchor = (
  robot: RobotState,
  layoutProfile: ResolvedUsdPackageLayoutProfile,
): OmittedIsaacRootAnchor | null => {
  if (layoutProfile !== 'isaacsim' || robot.inspectionContext?.sourceFormat !== 'mjcf') {
    return null;
  }

  const rootLink = robot.links[robot.rootLinkId];
  if (!rootLink || linkHasExportablePayload(rootLink) || !isMasslessLink(rootLink)) {
    return null;
  }

  if (Object.values(robot.joints).some((joint) => joint.childLinkId === robot.rootLinkId)) {
    return null;
  }

  const childJoints = Object.values(robot.joints).filter(
    (joint) => joint.parentLinkId === robot.rootLinkId,
  );
  if (childJoints.length !== 1) {
    return null;
  }

  const childJoint = childJoints[0];
  const childJointType = String(childJoint?.type || '').toLowerCase();
  if (
    (childJointType !== 'fixed' && childJointType !== 'floating') ||
    !robot.links[childJoint.childLinkId]
  ) {
    return null;
  }

  return {
    articulationRootLinkId: childJoint.childLinkId,
    omittedJointIds: new Set([childJoint.id]),
    omittedLinkIds: new Set([robot.rootLinkId]),
  };
};

export const buildUsdLinkPathMaps = (
  robot: RobotState,
  rootPrimName: string,
  options: UsdPackageLayoutOptions = {},
): UsdLinkPathMaps => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const useFlatLinkPaths = layoutProfile === 'isaacsim';
  const childIdsByParent = new Map<string, string[]>();
  Object.values(robot.joints).forEach((joint) => {
    const children = childIdsByParent.get(joint.parentLinkId) || [];
    children.push(joint.childLinkId);
    childIdsByParent.set(joint.parentLinkId, children);
  });

  const linkPaths = new Map<string, string>();
  const visit = (linkId: string, parentPath: string) => {
    const path = useFlatLinkPaths
      ? `/${rootPrimName}/${sanitizeUsdIdentifier(linkId)}`
      : `${parentPath}/${sanitizeUsdIdentifier(linkId)}`;
    linkPaths.set(linkId, path);
    (childIdsByParent.get(linkId) || []).forEach((childLinkId) => visit(childLinkId, path));
  };

  visit(robot.rootLinkId, `/${rootPrimName}`);

  return { linkPaths, childIdsByParent };
};

export const buildUsdPhysicsLayerContent = (
  robot: RobotState,
  pathMaps: UsdLinkPathMaps,
  rootPrimName: string,
  configStem: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layerExtension = getUsdLayerExtension(options.fileFormat);
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const omittedRootAnchor = resolveOmittedIsaacRootAnchor(robot, layoutProfile);
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    subLayers = [',
    `        @${configStem}_base.${layerExtension}@`,
    '    ]',
    '    upAxis = "Z"',
    ')',
    '',
  ];

  serializeUsdPrimSpecWithMetadata(lines, 0, `over "${rootPrimName}"`, [
    ...(layoutProfile === 'isaacsim'
      ? []
      : ['prepend apiSchemas = ["PhysicsArticulationRootAPI"]']),
  ]);
  lines.push('{');

  if (layoutProfile === 'isaacsim') {
    Array.from(pathMaps.linkPaths.keys()).forEach((linkId) => {
      if (omittedRootAnchor?.omittedLinkIds.has(linkId)) {
        return;
      }
      serializeLinkPhysicsOverride(robot, linkId, lines, 1, {
        addArticulationRootApi:
          linkId === (omittedRootAnchor?.articulationRootLinkId || robot.rootLinkId),
        layoutProfile,
      });
    });
  } else {
    serializeNestedLinkPhysicsOverrides(
      robot,
      robot.rootLinkId,
      pathMaps.childIdsByParent,
      lines,
      1,
    );
  }

  lines.push('');
  lines.push('    over "joints"');
  lines.push('    {');

  const mimicReferenceJointPaths = new Map<string, string>();
  Object.entries(robot.joints).forEach(([jointKey, joint]) => {
    if (omittedRootAnchor?.omittedJointIds.has(joint.id) || !supportsPhysxMimicJoint(joint)) {
      return;
    }

    const jointPath = `/${rootPrimName}/joints/${sanitizeUsdIdentifier(
      joint.id || joint.name || 'joint',
    )}`;
    [jointKey, joint.id, joint.name].forEach((reference) => {
      const normalizedReference = String(reference || '').trim();
      if (normalizedReference) {
        mimicReferenceJointPaths.set(normalizedReference, jointPath);
      }
    });
  });

  Object.values(robot.joints).forEach((joint) => {
    if (omittedRootAnchor?.omittedJointIds.has(joint.id)) {
      return;
    }
    const mimicReference = String(joint.mimic?.joint || '').trim();
    const jointPath = `/${rootPrimName}/joints/${sanitizeUsdIdentifier(
      joint.id || joint.name || 'joint',
    )}`;
    const mimicReferenceJointPath = mimicReferenceJointPaths.get(mimicReference);
    serializeJointDefinition(joint, pathMaps.linkPaths, lines, 2, {
      layoutProfile,
      mimicReferenceJointPath:
        mimicReferenceJointPath !== jointPath ? mimicReferenceJointPath : undefined,
    });
  });
  (robot.closedLoopConstraints || []).forEach((constraint) => {
    serializeClosedLoopConstraintDefinition(constraint, pathMaps.linkPaths, lines, 2);
  });

  lines.push('    }');
  lines.push('}');
  lines.push('');
  return `${lines.join('\n')}\n`;
};

export const buildUsdSensorLayerContent = (rootPrimName: string): string => {
  return [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    ')',
    '',
    `def Xform "${rootPrimName}"`,
    '{',
    '}',
    '',
  ].join('\n');
};

const buildUsdPhysicsSceneLines = (
  rootPrimName: string,
  layoutProfile: ResolvedUsdPackageLayoutProfile,
): string[] => {
  const physicsScenePrimName = rootPrimName === 'physicsScene' ? '__physicsScene' : 'physicsScene';
  const lines: string[] = [];

  serializeUsdPrimSpecWithMetadata(
    lines,
    0,
    `def PhysicsScene "${physicsScenePrimName}"`,
    layoutProfile === 'isaacsim' ? ['prepend apiSchemas = ["PhysxSceneAPI"]'] : [],
  );
  lines.push('{');
  lines.push('    vector3f physics:gravityDirection = (0, 0, -1)');
  lines.push('    float physics:gravityMagnitude = 9.81');
  if (layoutProfile === 'isaacsim') {
    lines.push(
      `    uniform token physxScene:broadphaseType = "${ISAACSIM_DEFAULT_PHYSX_SCENE_BROADPHASE_TYPE}"`,
    );
    lines.push(
      `    bool physxScene:enableCCD = ${ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_CCD ? 'true' : 'false'}`,
    );
    lines.push(
      `    bool physxScene:enableGPUDynamics = ${ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_GPU_DYNAMICS ? 'true' : 'false'}`,
    );
    lines.push(
      `    bool physxScene:enableStabilization = ${ISAACSIM_DEFAULT_PHYSX_SCENE_ENABLE_STABILIZATION ? 'true' : 'false'}`,
    );
    lines.push(
      `    uniform token physxScene:solverType = "${ISAACSIM_DEFAULT_PHYSX_SCENE_SOLVER_TYPE}"`,
    );
  }
  lines.push('}');
  lines.push('');

  return lines;
};

export const buildUsdRootLayerContent = (
  rootPrimName: string,
  configStem: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const layerExtension = getUsdLayerExtension(options.fileFormat);

  if (layoutProfile === 'isaacsim') {
    return [
      '#usda 1.0',
      '(',
      '    customLayerData = {',
      '        string "urdfStudio:roundtripMetadata" = "1"',
      '    }',
      `    defaultPrim = "${rootPrimName}"`,
      '    metersPerUnit = 1',
      '    upAxis = "Z"',
      ')',
      '',
      ...buildUsdPhysicsSceneLines(rootPrimName, layoutProfile),
      `def Xform "${rootPrimName}" (`,
      '    variants = {',
      '        string Physics = "PhysX"',
      '        string Robot = "Robot"',
      '        string Sensor = "Sensors"',
      '    }',
      '    prepend variantSets = ["Physics", "Sensor", "Robot"]',
      ')',
      '{',
      '    variantSet "Physics" = {',
      '        "None" (',
      `            prepend references = @configuration/${configStem}_base.${layerExtension}@`,
      '        ) {',
      '            over "joints" (',
      '                active = false',
      '            )',
      '            {',
      '            }',
      '',
      '        }',
      '        "PhysX" (',
      `            prepend payload = @configuration/${configStem}_physics.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '    variantSet "Sensor" = {',
      '        "None" {',
      '',
      '        }',
      '        "Sensors" (',
      `            prepend payload = @configuration/${configStem}_sensor.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '    variantSet "Robot" = {',
      '        "None" {',
      '',
      '        }',
      '        "Robot" (',
      `            prepend payload = @configuration/${configStem}_robot.${layerExtension}@`,
      '        ) {',
      '',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n');
  }

  return [
    '#usda 1.0',
    '(',
    '    customLayerData = {',
    '        string "urdfStudio:roundtripMetadata" = "1"',
    '    }',
    `    defaultPrim = "${rootPrimName}"`,
    '    upAxis = "Z"',
    '    metersPerUnit = 1',
    ')',
    '',
    ...buildUsdPhysicsSceneLines(rootPrimName, layoutProfile),
    `def Xform "${rootPrimName}" (`,
    '    variants = {',
    '        string Physics = "PhysX"',
    '        string Sensor = "Sensors"',
    '    }',
    '    prepend variantSets = ["Physics", "Sensor"]',
    ')',
    '{',
    '    quatd xformOp:orient = (1, 0, 0, 0)',
    '    double3 xformOp:scale = (1, 1, 1)',
    '    double3 xformOp:translate = (0, 0, 0)',
    '    uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient", "xformOp:scale"]',
    '    variantSet "Physics" = {',
    '        "None" (',
    `            prepend references = @configuration/${configStem}_base.${layerExtension}@`,
    '        ) {',
    '            over "joints" (',
    '                active = false',
    '            )',
    '            {',
    '            }',
    '',
    '        }',
    '        "PhysX" (',
    `            prepend payload = @configuration/${configStem}_physics.${layerExtension}@`,
    '        ) {',
    '',
    '        }',
    '    }',
    '    variantSet "Sensor" = {',
    '        "None" {',
    '',
    '        }',
    '        "Sensors" (',
    `            prepend payload = @configuration/${configStem}_sensor.${layerExtension}@`,
    '        ) {',
    '',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');
};

const serializeIsaacLinkOverride = (
  linkId: string,
  robot: RobotState,
  lines: string[],
  depth: number,
): void => {
  const link = robot.links[linkId];
  if (!link) {
    return;
  }

  const indent = makeUsdIndent(depth);
  const childIndent = makeUsdIndent(depth + 1);

  serializeUsdPrimSpecWithMetadata(lines, depth, `over "${sanitizeUsdIdentifier(linkId)}"`, [
    'prepend apiSchemas = ["IsaacLinkAPI"]',
  ]);
  lines.push(`${indent}{`);
  lines.push(`${childIndent}string isaac:nameOverride`);

  lines.push(`${indent}}`);
};

const serializeNestedIsaacLinkOverrides = (
  linkId: string,
  robot: RobotState,
  childIdsByParent: Map<string, string[]>,
  lines: string[],
  depth: number,
): void => {
  serializeIsaacLinkOverride(linkId, robot, lines, depth);

  (childIdsByParent.get(linkId) || []).forEach((childLinkId) => {
    serializeNestedIsaacLinkOverrides(childLinkId, robot, childIdsByParent, lines, depth + 1);
  });
};

export const buildUsdRobotLayerContent = (
  robot: RobotState,
  pathMaps: UsdLinkPathMaps,
  rootPrimName: string,
  options: UsdPackageLayoutOptions = {},
): string => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const omittedRootAnchor = resolveOmittedIsaacRootAnchor(robot, layoutProfile);
  const lines = [
    '#usda 1.0',
    '(',
    `    defaultPrim = "${rootPrimName}"`,
    '    metersPerUnit = 1',
    '    upAxis = "Z"',
    ')',
    '',
  ];

  const rootLinkPaths = Array.from(pathMaps.linkPaths.entries())
    .filter(([linkId]) => !omittedRootAnchor?.omittedLinkIds.has(linkId))
    .map(([, linkPath]) => `        <${linkPath}>,`);
  const jointPaths = Object.values(robot.joints)
    .filter((joint) => !omittedRootAnchor?.omittedJointIds.has(joint.id))
    .map(
      (joint) =>
        `        </${rootPrimName}/joints/${sanitizeUsdIdentifier(joint.id || joint.name || 'joint')}>,`,
    );

  serializeUsdPrimSpecWithMetadata(lines, 0, `def Xform "${rootPrimName}"`, [
    'prepend apiSchemas = ["IsaacRobotAPI"]',
  ]);
  lines.push('{');
  lines.push('    string isaac:description');
  lines.push('    string isaac:namespace');
  lines.push(`    ${jointPaths.length > 0 ? 'prepend ' : ''}rel isaac:physics:robotJoints = [`);
  jointPaths.forEach((jointPath) => lines.push(jointPath));
  lines.push('    ]');
  lines.push(`    ${rootLinkPaths.length > 0 ? 'prepend ' : ''}rel isaac:physics:robotLinks = [`);
  rootLinkPaths.forEach((linkPath) => lines.push(linkPath));
  lines.push('    ]');
  lines.push('');

  if (layoutProfile !== 'isaacsim') {
    serializeNestedIsaacLinkOverrides(robot.rootLinkId, robot, pathMaps.childIdsByParent, lines, 1);
  } else {
    Array.from(pathMaps.linkPaths.keys()).forEach((linkId) => {
      if (omittedRootAnchor?.omittedLinkIds.has(linkId)) {
        return;
      }
      serializeIsaacLinkOverride(linkId, robot, lines, 1);
    });
  }
  lines.push('');
  lines.push('    over "joints"');
  lines.push('    {');

  Object.values(robot.joints)
    .filter((joint) => !omittedRootAnchor?.omittedJointIds.has(joint.id))
    .forEach((joint, index) => {
      const jointName = sanitizeUsdIdentifier(joint.id || joint.name || 'joint');
      serializeUsdPrimSpecWithMetadata(lines, 2, `over "${jointName}"`, [
        'prepend apiSchemas = ["IsaacJointAPI"]',
      ]);
      lines.push('        {');
      lines.push('            string isaac:nameOverride');
      lines.push('            float[] isaac:physics:AccelerationLimit');
      lines.push(`            int isaac:physics:index = ${index}`);
      lines.push('            float[] isaac:physics:JerkLimit');
      lines.push('            int isaac:physics:Rot_X:DofOffset');
      lines.push('            int isaac:physics:Rot_Y:DofOffset');
      lines.push('            int isaac:physics:Rot_Z:DofOffset');
      lines.push('            int isaac:physics:Tr_X:DofOffset');
      lines.push('            int isaac:physics:Tr_Y:DofOffset');
      lines.push('            int isaac:physics:Tr_Z:DofOffset');
      lines.push('        }');
      lines.push('');
    });

  lines.push('    }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
};

export const createUsdArchivePackage = (
  exportName: string,
  layerContents: UsdPackageLayerContents,
  assetFiles: Map<string, Blob> = new Map(),
  options: UsdPackageLayoutOptions = {},
): UsdArchivePackage => {
  const layoutProfile = resolveUsdPackageLayoutProfile(options.layoutProfile);
  const layerExtension = getUsdLayerExtension(options.fileFormat);
  const packageRoot = sanitizeUsdIdentifier(exportName || 'robot');
  const configStemBase = resolveUsdConfigStem(packageRoot, options);
  const usdRoot = layoutProfile === 'isaacsim' ? packageRoot : `${packageRoot}/usd`;
  const configurationRoot = `${usdRoot}/configuration`;
  const rootLayerPath = `${usdRoot}/${packageRoot}.${layerExtension}`;

  const requiredLayers = [
    ['root', layerContents.rootLayerContent],
    ['base', layerContents.baseLayerContent],
    ['physics', layerContents.physicsLayerContent],
    ['sensor', layerContents.sensorLayerContent],
  ] as const;
  requiredLayers.forEach(([layerName, content]) => {
    if (!content.trim()) {
      throw new Error(`USD archives require non-empty ${layerName} layer content.`);
    }
  });

  if (layoutProfile === 'isaacsim' && !layerContents.robotLayerContent?.trim()) {
    throw new Error('IsaacSim USD archives require a robot metadata layer.');
  }

  const layerFiles: Array<[string, Blob]> = [
    [rootLayerPath, createIdentityBlob(layerContents.rootLayerContent)],
    [
      `${configurationRoot}/${configStemBase}_base.${layerExtension}`,
      createIdentityBlob(layerContents.baseLayerContent),
    ],
    [
      `${configurationRoot}/${configStemBase}_physics.${layerExtension}`,
      createIdentityBlob(layerContents.physicsLayerContent),
    ],
    [
      `${configurationRoot}/${configStemBase}_sensor.${layerExtension}`,
      createIdentityBlob(layerContents.sensorLayerContent),
    ],
  ];

  if (layerContents.robotLayerContent) {
    layerFiles.push([
      `${configurationRoot}/${configStemBase}_robot.${layerExtension}`,
      createIdentityBlob(layerContents.robotLayerContent),
    ]);
  }

  const reservedArchivePaths = new Set(layerFiles.map(([filePath]) => filePath));
  const packagedAssetPaths = new Set<string>();
  const packagedAssetFiles = Array.from(assetFiles.entries()).map(([relativePath, blob]) => {
    const normalizedRelativePath = relativePath.trim().replace(/\\/g, '/');
    const pathSegments = normalizedRelativePath.split('/');
    if (
      !normalizedRelativePath ||
      normalizedRelativePath.startsWith('/') ||
      /^[a-z]:\//i.test(normalizedRelativePath) ||
      pathSegments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new Error(`Invalid USD archive asset path: ${relativePath}`);
    }

    const archivePath = `${usdRoot}/${normalizedRelativePath}`;
    if (reservedArchivePaths.has(archivePath) || packagedAssetPaths.has(archivePath)) {
      throw new Error(`USD archive entry path collision: ${archivePath}`);
    }
    packagedAssetPaths.add(archivePath);
    return [archivePath, blob] as const;
  });

  return {
    archiveFileName: `${packageRoot}_${layerExtension}.zip`,
    rootLayerPath,
    archiveFiles: new Map<string, Blob>([...layerFiles, ...packagedAssetFiles]),
  };
};
