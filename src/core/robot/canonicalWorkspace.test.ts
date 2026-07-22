import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  areEntityRefsEqual,
  entityRefKey,
  type AssemblyTransform,
  type EntityRef,
  type RobotData,
  type WorkspaceHistory,
  type WorkspaceSelection,
} from '@/types';

import {
  assertCanonicalWorkspace,
  createDefaultWorkspace,
  createSingleComponentWorkspace,
  validateCanonicalWorkspace,
  type CanonicalAssemblyState,
} from './canonicalWorkspace.ts';

const IDENTITY_TRANSFORM: AssemblyTransform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { r: 0, p: 0, y: 0 },
};

function createRobot(name: string, rootLinkId = 'base_link'): RobotData {
  const childLinkId = 'tool_link';
  return {
    name,
    rootLinkId,
    links: {
      [rootLinkId]: {
        ...DEFAULT_LINK,
        id: rootLinkId,
        name: rootLinkId,
      },
      [childLinkId]: {
        ...DEFAULT_LINK,
        id: childLinkId,
        name: childLinkId,
      },
    },
    joints: {
      wrist: {
        ...DEFAULT_JOINT,
        id: 'wrist',
        name: 'wrist',
        type: JointType.FIXED,
        parentLinkId: rootLinkId,
        childLinkId,
      },
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function getFirstComponent(workspace: unknown): Record<string, unknown> {
  const components = asRecord(asRecord(workspace).components);
  const component = Object.values(components)[0];
  assert.ok(component);
  return asRecord(component);
}

function assertInvalid(workspace: unknown, expectedPath: string): void {
  const result = validateCanonicalWorkspace(workspace);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.path === expectedPath),
    `expected issue at ${expectedPath}, got ${JSON.stringify(result.issues)}`,
  );
  assert.throws(
    () => assertCanonicalWorkspace(workspace),
    new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
}

test('createDefaultWorkspace creates one complete source-less component', () => {
  const workspace = createDefaultWorkspace('blank_robot');
  const component = workspace.components.component_1;

  assert.equal(workspace.name, 'blank_robot');
  assert.deepEqual(workspace.transform, IDENTITY_TRANSFORM);
  assert.deepEqual(Object.keys(workspace.components), ['component_1']);
  assert.deepEqual(workspace.bridges, {});
  assert.ok(component);
  assert.equal(component.id, 'component_1');
  assert.equal(component.name, 'blank_robot');
  assert.equal(component.sourceFile, null);
  assert.equal(component.visible, true);
  assert.deepEqual(component.transform, IDENTITY_TRANSFORM);
  assert.equal(component.robot.rootLinkId, 'base_link');
  assert.equal(component.robot.links.base_link?.id, 'base_link');
  assert.equal(validateCanonicalWorkspace(workspace).valid, true);
  assert.doesNotThrow(() => assertCanonicalWorkspace(workspace));
});

test('createSingleComponentWorkspace preserves source-local IDs and applies explicit metadata', () => {
  const sourceRobot = createRobot('source_robot');
  const workspace = createSingleComponentWorkspace(sourceRobot, {
    workspaceName: 'workspace_name',
    workspaceTransform: {
      position: { x: 1, y: 2, z: 3 },
      rotation: { r: 0.1, p: 0.2, y: 0.3 },
    },
    componentId: 'left_arm',
    componentName: 'Left Arm',
    componentTransform: {
      position: { x: -1, y: 0, z: 0.5 },
      rotation: { r: 0, p: 0, y: 1 },
    },
    sourceFile: 'robots/left.urdf',
    visible: false,
  });
  const component = workspace.components.left_arm;

  assert.ok(component);
  assert.equal(component.robot.rootLinkId, 'base_link');
  assert.deepEqual(Object.keys(component.robot.links), ['base_link', 'tool_link']);
  assert.deepEqual(Object.keys(component.robot.joints), ['wrist']);
  assert.equal(component.robot.joints.wrist?.parentLinkId, 'base_link');
  assert.equal(component.name, 'Left Arm');
  assert.equal(component.robot.name, 'source_robot');
  assert.equal(component.sourceFile, 'robots/left.urdf');
  assert.equal(component.visible, false);
  assert.notEqual(component.robot, sourceRobot);
  assert.doesNotThrow(() => assertCanonicalWorkspace(workspace));
});

test('createSingleComponentWorkspace rejects workspace mirrors instead of normalizing them', () => {
  const robotWithWorkspaceMirrors = {
    ...createRobot('source_robot'),
    components: {},
    bridges: {},
    workspaceTransform: IDENTITY_TRANSFORM,
    activeComponentId: null,
  };

  assert.throws(
    () => createSingleComponentWorkspace(robotWithWorkspaceMirrors),
    /components\.component_1\.robot\.components/,
  );
});

test('EntityRef helpers preserve explicit ownership and null is the only empty selection', () => {
  const first: EntityRef = {
    type: 'link',
    componentId: 'arm_left',
    entityId: 'wrist',
  };
  const same: EntityRef = {
    type: 'link',
    componentId: 'arm_left',
    entityId: 'wrist',
  };
  const separatorCollisionCandidate: EntityRef = {
    type: 'link',
    componentId: 'arm',
    entityId: 'left_wrist',
  };
  const selection: WorkspaceSelection = {
    entity: first,
    subType: 'collision',
    objectIndex: 2,
  };
  const emptySelection: WorkspaceSelection = null;

  assert.equal(areEntityRefsEqual(first, same), true);
  assert.equal(areEntityRefsEqual(first, separatorCollisionCandidate), false);
  assert.equal(areEntityRefsEqual(first, null), false);
  assert.equal(areEntityRefsEqual(null, null), true);
  assert.notEqual(entityRefKey(first), entityRefKey(separatorCollisionCandidate));
  assert.deepEqual(selection.entity, first);
  assert.equal(emptySelection, null);
});

test('WorkspaceHistory stores only canonical workspace snapshots and activity', () => {
  const workspace = createDefaultWorkspace('history_robot');
  const history = {
    past: [structuredClone(workspace)],
    future: [],
    activity: [
      {
        id: 'activity_1',
        timestamp: '2026-07-09T00:00:00.000Z',
        label: 'Create workspace',
      },
    ],
  } satisfies WorkspaceHistory;

  assert.equal(history.past[0]?.name, 'history_robot');
  assert.equal(history.activity[0]?.label, 'Create workspace');
});

test('assertCanonicalWorkspace accepts a multi-component workspace with source-local bridge endpoints', () => {
  const workspace = createSingleComponentWorkspace(createRobot('left'), {
    componentId: 'left',
  });
  const right = createSingleComponentWorkspace(createRobot('right'), {
    componentId: 'right',
  }).components.right;
  assert.ok(right);
  workspace.components.right = right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'tool_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount_joint',
      type: JointType.FIXED,
      parentLinkId: 'tool_link',
      childLinkId: 'base_link',
    },
  };

  assert.doesNotThrow(() => assertCanonicalWorkspace(workspace));
});

test('canonical validation uses exact source-local IDs without prefix ownership guesses', () => {
  const workspace = createSingleComponentWorkspace(createRobot('left', 'left_base'), {
    componentId: 'left',
  });
  const right = createSingleComponentWorkspace(createRobot('right', 'right_base'), {
    componentId: 'right',
  }).components.right;
  assert.ok(right);
  workspace.components.right = right;
  workspace.bridges.mount = {
    id: 'mount',
    name: 'mount',
    parentComponentId: 'left',
    parentLinkId: 'left_base',
    childComponentId: 'right',
    childLinkId: 'right_base',
    joint: {
      ...DEFAULT_JOINT,
      id: 'mount',
      name: 'mount',
      type: JointType.FIXED,
      parentLinkId: 'left_base',
      childLinkId: 'right_base',
    },
  };

  assert.doesNotThrow(() => assertCanonicalWorkspace(workspace));

  workspace.bridges.mount.parentLinkId = 'left_left_base';
  workspace.bridges.mount.joint.parentLinkId = 'left_left_base';
  assertInvalid(workspace, 'bridges.mount.parentLinkId');
});

test('canonical validation fails fast for an empty workspace and component key mismatch', () => {
  const empty = structuredClone(createDefaultWorkspace());
  empty.components = {};
  assertInvalid(empty, 'components');

  const mismatched = structuredClone(createDefaultWorkspace());
  mismatched.components.component_1.id = 'different_component';
  assertInvalid(mismatched, 'components.component_1.id');
});

test('canonical validation requires sourceFile, visibility, and complete finite transforms', () => {
  const missingSource = structuredClone(createDefaultWorkspace()) as unknown;
  delete getFirstComponent(missingSource).sourceFile;
  assertInvalid(missingSource, 'components.component_1.sourceFile');

  const emptySource = structuredClone(createDefaultWorkspace()) as unknown;
  getFirstComponent(emptySource).sourceFile = '   ';
  assertInvalid(emptySource, 'components.component_1.sourceFile');

  const invalidVisible = structuredClone(createDefaultWorkspace()) as unknown;
  getFirstComponent(invalidVisible).visible = 'yes';
  assertInvalid(invalidVisible, 'components.component_1.visible');

  const incompleteTransform = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(getFirstComponent(incompleteTransform).transform).position = { x: 0, y: 0 };
  assertInvalid(incompleteTransform, 'components.component_1.transform.position.z');

  const invalidWorkspaceTransform = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(asRecord(invalidWorkspaceTransform).transform).rotation = {
    r: 0,
    p: Number.NaN,
    y: 0,
  };
  assertInvalid(invalidWorkspaceTransform, 'transform.rotation.p');

  assert.throws(
    () =>
      createSingleComponentWorkspace(createRobot('invalid_transform'), {
        workspaceTransform: {
          position: { x: Number.NaN, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
      }),
    /transform\.position\.x/,
  );
});

test('canonical validation rejects invalid robot map identities and link references', () => {
  const linkKeyMismatch = structuredClone(createDefaultWorkspace()) as unknown;
  const robot = asRecord(getFirstComponent(linkKeyMismatch).robot);
  asRecord(asRecord(robot.links).base_link).id = 'different_link';
  assertInvalid(linkKeyMismatch, 'components.component_1.robot.links.base_link.id');

  const jointKeyMismatch = createSingleComponentWorkspace(createRobot('robot')) as unknown;
  const jointRobot = asRecord(getFirstComponent(jointKeyMismatch).robot);
  asRecord(asRecord(jointRobot.joints).wrist).id = 'different_joint';
  assertInvalid(jointKeyMismatch, 'components.component_1.robot.joints.wrist.id');

  const missingJointLink = createSingleComponentWorkspace(createRobot('robot')) as unknown;
  const missingJointLinkRobot = asRecord(getFirstComponent(missingJointLink).robot);
  asRecord(asRecord(missingJointLinkRobot.joints).wrist).childLinkId = 'missing_link';
  assertInvalid(
    missingJointLink,
    'components.component_1.robot.joints.wrist.childLinkId',
  );

  const missingRoot = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(getFirstComponent(missingRoot).robot).rootLinkId = 'missing_link';
  assertInvalid(missingRoot, 'components.component_1.robot.rootLinkId');
});

test('canonical validation rejects incomplete geometry and joint runtime shapes', () => {
  const missingVisual = structuredClone(createDefaultWorkspace()) as unknown;
  delete asRecord(
    asRecord(asRecord(getFirstComponent(missingVisual).robot).links).base_link,
  ).visual;
  assertInvalid(missingVisual, 'components.component_1.robot.links.base_link.visual');

  const invalidGeometryType = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(
    asRecord(asRecord(asRecord(getFirstComponent(invalidGeometryType).robot).links).base_link)
      .collision,
  ).type = 'unknown-shape';
  assertInvalid(
    invalidGeometryType,
    'components.component_1.robot.links.base_link.collision.type',
  );

  const missingGeometryOrigin = structuredClone(createDefaultWorkspace()) as unknown;
  delete asRecord(
    asRecord(asRecord(asRecord(getFirstComponent(missingGeometryOrigin).robot).links).base_link)
      .visual,
  ).origin;
  assertInvalid(
    missingGeometryOrigin,
    'components.component_1.robot.links.base_link.visual.origin',
  );

  const nonFiniteGeometry = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(
    asRecord(
      asRecord(asRecord(asRecord(getFirstComponent(nonFiniteGeometry).robot).links).base_link)
        .visual,
    ).dimensions,
  ).x = Number.POSITIVE_INFINITY;
  assertInvalid(
    nonFiniteGeometry,
    'components.component_1.robot.links.base_link.visual.dimensions.x',
  );

  for (const field of ['type', 'origin', 'dynamics', 'hardware'] as const) {
    const workspace = createSingleComponentWorkspace(createRobot(`missing_${field}`)) as unknown;
    const joint = asRecord(asRecord(asRecord(getFirstComponent(workspace).robot).joints).wrist);
    delete joint[field];
    assertInvalid(workspace, `components.component_1.robot.joints.wrist.${field}`);
  }

  const invalidJointType = createSingleComponentWorkspace(createRobot('invalid_joint')) as unknown;
  asRecord(
    asRecord(asRecord(getFirstComponent(invalidJointType).robot).joints).wrist,
  ).type = 'hinge';
  assertInvalid(invalidJointType, 'components.component_1.robot.joints.wrist.type');

  const nonFiniteDynamics = createSingleComponentWorkspace(createRobot('invalid_dynamics')) as unknown;
  asRecord(
    asRecord(
      asRecord(asRecord(getFirstComponent(nonFiniteDynamics).robot).joints).wrist,
    ).dynamics,
  ).damping = Number.NaN;
  assertInvalid(
    nonFiniteDynamics,
    'components.component_1.robot.joints.wrist.dynamics.damping',
  );
});

test('canonical validation rejects malformed nested geometry and material collections', () => {
  const invalidAuthoredMaterials = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(
    asRecord(asRecord(asRecord(getFirstComponent(invalidAuthoredMaterials).robot).links).base_link)
      .visual,
  ).authoredMaterials = {};
  assertInvalid(
    invalidAuthoredMaterials,
    'components.component_1.robot.links.base_link.visual.authoredMaterials',
  );

  const invalidMaterialPasses = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(
    asRecord(asRecord(asRecord(getFirstComponent(invalidMaterialPasses).robot).links).base_link)
      .visual,
  ).authoredMaterials = [{ name: 'paint', passes: {} }];
  assertInvalid(
    invalidMaterialPasses,
    'components.component_1.robot.links.base_link.visual.authoredMaterials.0.passes',
  );

  const invalidMeshGroups = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(
    asRecord(asRecord(asRecord(getFirstComponent(invalidMeshGroups).robot).links).base_link)
      .visual,
  ).meshMaterialGroups = [{ meshKey: 'body', start: 0, count: 'three', materialIndex: 0 }];
  assertInvalid(
    invalidMeshGroups,
    'components.component_1.robot.links.base_link.visual.meshMaterialGroups.0.count',
  );

  const invalidMaterialsMap = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(getFirstComponent(invalidMaterialsMap).robot).materials = [];
  assertInvalid(invalidMaterialsMap, 'components.component_1.robot.materials');

  const invalidMaterialEntry = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(getFirstComponent(invalidMaterialEntry).robot).materials = {
    paint: { colorRgba: [1, 0, 'blue', 1] },
  };
  assertInvalid(
    invalidMaterialEntry,
    'components.component_1.robot.materials.paint.colorRgba.2',
  );
});

test('canonical validation accepts stage-scoped USD material metadata', () => {
  const workspace = createSingleComponentWorkspace(createRobot('unitree_usd')) as unknown;
  asRecord(getFirstComponent(workspace).robot).materials = {
    FL_foot: {
      color: '#111111',
      usdMaterial: {
        materialId: '/World/Looks/FL_foot',
        stageSourcePath: '/unitree_model/Go2/usd/go2.viewer_roundtrip.usd',
      },
    },
  };

  assert.equal(validateCanonicalWorkspace(workspace).valid, true);
  assert.doesNotThrow(() => assertCanonicalWorkspace(workspace));
});

test('canonical validation rejects malformed URDF inspection collections before runtime use', () => {
  const invalidDiagnostics = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(getFirstComponent(invalidDiagnostics).robot).inspectionContext = {
    sourceFormat: 'urdf',
    urdf: {
      diagnostics: {},
      diagnosticCounts: { info: 0, warning: 0, error: 0 },
      facts: {
        linkCount: 1,
        jointCount: 0,
        visualCount: 0,
        collisionCount: 0,
        inertialCount: 0,
        materialCount: 0,
        meshCount: 0,
        syntheticParentLinkCount: 0,
        disconnectedRootCount: 0,
      },
    },
  };
  assertInvalid(
    invalidDiagnostics,
    'components.component_1.robot.inspectionContext.urdf.diagnostics',
  );

  const invalidFacts = structuredClone(invalidDiagnostics) as unknown;
  const urdf = asRecord(
    asRecord(asRecord(getFirstComponent(invalidFacts).robot).inspectionContext).urdf,
  );
  urdf.diagnostics = [];
  asRecord(urdf.facts).meshCount = Number.NaN;
  assertInvalid(
    invalidFacts,
    'components.component_1.robot.inspectionContext.urdf.facts.meshCount',
  );
});

test('canonical validation requires complete finite closed-loop constraints', () => {
  const createLoopWorkspace = () => {
    const robot = createRobot('closed_loop');
    robot.closedLoopConstraints = [{
      id: 'loop',
      type: 'distance',
      linkAId: 'base_link',
      linkBId: 'tool_link',
      anchorWorld: { x: 0, y: 0, z: 0 },
      anchorLocalA: { x: 0, y: 0, z: 0 },
      anchorLocalB: { x: 0, y: 0, z: 0 },
      restDistance: 1,
    }];
    return createSingleComponentWorkspace(robot);
  };

  const invalidType = createLoopWorkspace() as unknown;
  const invalidTypeConstraints = asRecord(getFirstComponent(invalidType).robot)
    .closedLoopConstraints as Array<Record<string, unknown>>;
  invalidTypeConstraints[0]!.type = 'hinge';
  assertInvalid(
    invalidType,
    'components.component_1.robot.closedLoopConstraints.0.type',
  );

  const missingAnchor = createLoopWorkspace() as unknown;
  const missingAnchorConstraints = asRecord(getFirstComponent(missingAnchor).robot)
    .closedLoopConstraints as Array<Record<string, unknown>>;
  delete missingAnchorConstraints[0]!.anchorLocalB;
  assertInvalid(
    missingAnchor,
    'components.component_1.robot.closedLoopConstraints.0.anchorLocalB',
  );

  const invalidDistance = createLoopWorkspace() as unknown;
  const invalidDistanceConstraints = asRecord(getFirstComponent(invalidDistance).robot)
    .closedLoopConstraints as Array<Record<string, unknown>>;
  invalidDistanceConstraints[0]!.restDistance = Number.NaN;
  assertInvalid(
    invalidDistance,
    'components.component_1.robot.closedLoopConstraints.0.restDistance',
  );

  const unexpectedField = createLoopWorkspace() as unknown;
  const unexpectedConstraints = asRecord(getFirstComponent(unexpectedField).robot)
    .closedLoopConstraints as Array<Record<string, unknown>>;
  unexpectedConstraints[0]!.runtimeOnly = true;
  assertInvalid(
    unexpectedField,
    'components.component_1.robot.closedLoopConstraints.0.runtimeOnly',
  );

  const invalidSource = createLoopWorkspace() as unknown;
  const sourceConstraints = asRecord(getFirstComponent(invalidSource).robot)
    .closedLoopConstraints as Array<Record<string, unknown>>;
  sourceConstraints[0]!.source = { format: 'urdf', body1Name: '', body2Name: 'tool_link' };
  assertInvalid(
    invalidSource,
    'components.component_1.robot.closedLoopConstraints.0.source.format',
  );
});

test('canonical validation rejects malformed MJCF site and inspection metadata', () => {
  const invalidSites = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(asRecord(asRecord(getFirstComponent(invalidSites).robot).links).base_link)
    .mjcfSites = {};
  assertInvalid(invalidSites, 'components.component_1.robot.links.base_link.mjcfSites');

  const invalidSiteName = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(asRecord(asRecord(getFirstComponent(invalidSiteName).robot).links).base_link)
    .mjcfSites = [{ name: '', type: 'sphere' }];
  assertInvalid(
    invalidSiteName,
    'components.component_1.robot.links.base_link.mjcfSites.0.name',
  );

  const invalidInspection = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(getFirstComponent(invalidInspection).robot).inspectionContext = 'mjcf';
  assertInvalid(invalidInspection, 'components.component_1.robot.inspectionContext');

  const invalidMjcfArrays = createSingleComponentWorkspace(createRobot('mjcf')) as unknown;
  asRecord(getFirstComponent(invalidMjcfArrays).robot).inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 0,
      tendonCount: 0,
      tendonActuatorCount: 0,
      bodiesWithSites: {},
      tendons: {},
    },
  };
  assertInvalid(
    invalidMjcfArrays,
    'components.component_1.robot.inspectionContext.mjcf.bodiesWithSites',
  );
  assertInvalid(
    invalidMjcfArrays,
    'components.component_1.robot.inspectionContext.mjcf.tendons',
  );

  const validMjcf = createSingleComponentWorkspace(createRobot('valid_mjcf'));
  validMjcf.components.component_1.robot.links.base_link!.mjcfSites = [{
    name: 'attachment_site',
    sourceName: 'authored_attachment_site',
    type: 'sphere',
    size: [0.01],
    rgba: [1, 0, 0, 1],
    pos: [0, 0, 0],
    quat: [1, 0, 0, 0],
    group: 1,
  }];
  validMjcf.components.component_1.robot.inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 1,
      tendonCount: 1,
      tendonActuatorCount: 1,
      bodiesWithSites: [{
        bodyId: 'base_link',
        siteCount: 1,
        siteNames: ['attachment_site'],
      }],
      tendons: [{
        name: 'cable',
        type: 'spatial',
        attachmentRefs: ['authored_attachment_site'],
        attachments: [{ type: 'site', ref: 'authored_attachment_site' }],
        actuatorNames: ['cable_motor'],
      }],
    },
  };
  assert.doesNotThrow(() => assertCanonicalWorkspace(validMjcf));

  const missingAttachments = structuredClone(validMjcf) as unknown;
  const missingAttachmentTendon = (
    asRecord(asRecord(asRecord(getFirstComponent(missingAttachments).robot).inspectionContext).mjcf)
      .tendons as Array<Record<string, unknown>>
  )[0]!;
  delete missingAttachmentTendon.attachments;
  assertInvalid(
    missingAttachments,
    'components.component_1.robot.inspectionContext.mjcf.tendons.0.attachments',
  );

  const sourceOnlySiteRef = structuredClone(validMjcf) as unknown;
  const sourceOnlyAttachment = (
    (
      asRecord(asRecord(asRecord(getFirstComponent(sourceOnlySiteRef).robot).inspectionContext).mjcf)
        .tendons as Array<Record<string, unknown>>
    )[0]!.attachments as Array<Record<string, unknown>>
  )[0]!;
  sourceOnlyAttachment.ref = 'source_only_helper_site';
  (
    asRecord(asRecord(asRecord(getFirstComponent(sourceOnlySiteRef).robot).inspectionContext).mjcf)
      .tendons as Array<Record<string, unknown>>
  )[0]!.attachmentRefs = ['source_only_helper_site'];
  assert.doesNotThrow(() => assertCanonicalWorkspace(sourceOnlySiteRef));

  const emptySiteRef = structuredClone(validMjcf) as unknown;
  const emptyAttachment = (
    (
      asRecord(asRecord(asRecord(getFirstComponent(emptySiteRef).robot).inspectionContext).mjcf)
        .tendons as Array<Record<string, unknown>>
    )[0]!.attachments as Array<Record<string, unknown>>
  )[0]!;
  emptyAttachment.ref = '';
  assertInvalid(
    emptySiteRef,
    'components.component_1.robot.inspectionContext.mjcf.tendons.0.attachments.0.ref',
  );

  const staleCounts = structuredClone(validMjcf) as unknown;
  asRecord(asRecord(asRecord(getFirstComponent(staleCounts).robot).inspectionContext).mjcf)
    .tendonCount = 2;
  assertInvalid(
    staleCounts,
    'components.component_1.robot.inspectionContext.mjcf.tendonCount',
  );
});

test('canonical validation rejects multi-parent and cyclic robot joint graphs', () => {
  const multiParent = createSingleComponentWorkspace(createRobot('multi_parent'));
  multiParent.components.component_1.robot.joints.duplicate = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'duplicate',
    name: 'duplicate',
    parentLinkId: 'base_link',
    childLinkId: 'tool_link',
  };
  assertInvalid(
    multiParent,
    'components.component_1.robot.joints.duplicate.childLinkId',
  );

  const cyclic = createSingleComponentWorkspace(createRobot('cyclic'));
  cyclic.components.component_1.robot.joints.back = {
    ...structuredClone(DEFAULT_JOINT),
    id: 'back',
    name: 'back',
    parentLinkId: 'tool_link',
    childLinkId: 'base_link',
  };
  assertInvalid(cyclic, 'components.component_1.robot.joints.back.childLinkId');
});

test('canonical validation rejects legacy robot workspace mirrors', () => {
  const workspace = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(getFirstComponent(workspace).robot).components = {};
  assertInvalid(workspace, 'components.component_1.robot.components');
});

test('canonical validation rejects workspace session state', () => {
  const workspace = structuredClone(createDefaultWorkspace()) as unknown;
  asRecord(workspace).activeComponentId = 'component_1';
  assertInvalid(workspace, 'activeComponentId');
});

test('canonical validation rejects invalid bridge keys, endpoints, and joint endpoint mirrors', () => {
  const createBridgedWorkspace = (): CanonicalAssemblyState => {
    const workspace = createSingleComponentWorkspace(createRobot('left'), {
      componentId: 'left',
    });
    const right = createSingleComponentWorkspace(createRobot('right'), {
      componentId: 'right',
    }).components.right;
    assert.ok(right);
    workspace.components.right = right;
    workspace.bridges.mount = {
      id: 'mount',
      name: 'mount',
      parentComponentId: 'left',
      parentLinkId: 'tool_link',
      childComponentId: 'right',
      childLinkId: 'base_link',
      joint: {
        ...DEFAULT_JOINT,
        id: 'mount',
        name: 'mount_joint',
        type: JointType.FIXED,
        parentLinkId: 'tool_link',
        childLinkId: 'base_link',
      },
    };
    return workspace;
  };

  const keyMismatch = createBridgedWorkspace();
  keyMismatch.bridges.mount.id = 'different_bridge';
  assertInvalid(keyMismatch, 'bridges.mount.id');

  const jointIdMismatch = createBridgedWorkspace();
  jointIdMismatch.bridges.mount.joint.id = 'different_joint';
  assertInvalid(jointIdMismatch, 'bridges.mount.joint.id');

  const missingComponent = createBridgedWorkspace();
  missingComponent.bridges.mount.childComponentId = 'missing_component';
  assertInvalid(missingComponent, 'bridges.mount.childComponentId');

  const missingLink = createBridgedWorkspace();
  missingLink.bridges.mount.parentLinkId = 'missing_link';
  missingLink.bridges.mount.joint.parentLinkId = 'missing_link';
  assertInvalid(missingLink, 'bridges.mount.parentLinkId');

  const mismatchedJointEndpoint = createBridgedWorkspace();
  mismatchedJointEndpoint.bridges.mount.joint.childLinkId = 'tool_link';
  assertInvalid(mismatchedJointEndpoint, 'bridges.mount.joint.childLinkId');

  const selfBridge = createBridgedWorkspace();
  selfBridge.bridges.mount.childComponentId = 'left';
  selfBridge.bridges.mount.childLinkId = 'base_link';
  selfBridge.bridges.mount.joint.childLinkId = 'base_link';
  assertInvalid(selfBridge, 'bridges.mount.childComponentId');

  const duplicateIncoming = createBridgedWorkspace();
  const third = createSingleComponentWorkspace(createRobot('third'), {
    componentId: 'third',
  }).components.third!;
  duplicateIncoming.components.third = third;
  duplicateIncoming.bridges.second_mount = {
    id: 'second_mount',
    name: 'second_mount',
    parentComponentId: 'third',
    parentLinkId: 'tool_link',
    childComponentId: 'right',
    childLinkId: 'base_link',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'second_mount',
      name: 'second_mount',
      parentLinkId: 'tool_link',
      childLinkId: 'base_link',
    },
  };
  assertInvalid(duplicateIncoming, 'bridges.second_mount.childComponentId');

  const nonFixedCycle = createBridgedWorkspace();
  nonFixedCycle.bridges.return_mount = {
    id: 'return_mount',
    name: 'return_mount',
    parentComponentId: 'right',
    parentLinkId: 'tool_link',
    childComponentId: 'left',
    childLinkId: 'base_link',
    joint: {
      ...structuredClone(DEFAULT_JOINT),
      id: 'return_mount',
      name: 'return_mount',
      type: JointType.REVOLUTE,
      parentLinkId: 'tool_link',
      childLinkId: 'base_link',
    },
  };
  assertInvalid(nonFixedCycle, 'bridges.return_mount.joint.type');

  const fixedCycle = createBridgedWorkspace();
  fixedCycle.bridges.return_mount = {
    ...structuredClone(nonFixedCycle.bridges.return_mount),
    joint: {
      ...structuredClone(nonFixedCycle.bridges.return_mount.joint),
      type: JointType.FIXED,
    },
  };
  assert.doesNotThrow(() => assertCanonicalWorkspace(fixedCycle));
});
