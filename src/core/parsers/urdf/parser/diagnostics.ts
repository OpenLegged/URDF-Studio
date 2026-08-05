import {
  JointType,
  type RobotSourceDiagnostic,
  type RobotSourceDiagnosticSeverity,
  type RobotUrdfInspectionContext,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';

interface BuildUrdfInspectionContextOptions {
  robotEl: Element;
  parsedLinks: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  rootLinkId: string;
}

interface JointDiagnosticContext {
  jointEl: Element;
  jointName: string | undefined;
  jointType: string;
  relatedIds: string[];
}

interface OriginDiagnosticContext {
  originEl: Element | undefined;
  codePrefix: string;
  category: RobotSourceDiagnostic['category'];
  label: string;
  relatedIds: string[];
  sourceTag: string;
  sourceName?: string;
}

const MAX_RETAINED_DIAGNOSTICS = 120;
const MOVABLE_JOINT_TYPES = new Set<string>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);
const AXIS_JOINT_TYPES = new Set<string>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);
const VALID_JOINT_TYPES = new Set<string>([
  JointType.FIXED,
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
  JointType.FLOATING,
  JointType.BALL,
]);

function getDirectChildElements(parent: Element, tagName?: string): Element[] {
  return Array.from(parent.children).filter(
    (child): child is Element => !tagName || child.tagName === tagName,
  );
}

function getNamedDirectChildren(parent: Element, tagName: string): Element[] {
  return getDirectChildElements(parent, tagName).filter((element) =>
    Boolean(element.getAttribute('name')?.trim()),
  );
}

function pushDiagnostic(
  diagnostics: RobotSourceDiagnostic[],
  diagnostic: RobotSourceDiagnostic,
): void {
  diagnostics.push(diagnostic);
}

function countByName(elements: Element[]): Map<string, number> {
  const counts = new Map<string, number>();
  elements.forEach((element) => {
    const name = element.getAttribute('name')?.trim();
    if (!name) {
      return;
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return counts;
}

function addDuplicateNameDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  elements: Element[],
  tagName: 'link' | 'joint' | 'material',
): void {
  countByName(elements).forEach((count, name) => {
    if (count <= 1) {
      return;
    }

    pushDiagnostic(diagnostics, {
      code: `duplicate_${tagName}_name`,
      severity: 'error',
      category: tagName === 'material' ? 'material' : 'topology',
      message: `URDF contains ${count} <${tagName}> elements named "${name}".`,
      relatedIds: [name],
      source: { tag: tagName, name, attribute: 'name' },
    });
  });
}

function addMissingNameDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  elements: Element[],
  tagName: 'link' | 'joint',
): void {
  elements.forEach((element) => {
    if (element.getAttribute('name')?.trim()) {
      return;
    }

    pushDiagnostic(diagnostics, {
      code: `${tagName}_missing_name`,
      severity: 'error',
      category: 'topology',
      message: `A <${tagName}> element is missing its required name attribute.`,
      source: { tag: tagName, attribute: 'name' },
    });
  });
}

function parseFiniteNumber(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumberList(value: string | null): number[] {
  if (!value) {
    return [];
  }
  return value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
}

function hasInvalidNumber(values: number[]): boolean {
  return values.some((value) => !Number.isFinite(value));
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}

function vectorMagnitude(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function addOriginDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  {
    originEl,
    codePrefix,
    category,
    label,
    relatedIds,
    sourceTag,
    sourceName,
  }: OriginDiagnosticContext,
): void {
  if (!originEl) {
    return;
  }

  for (const attribute of ['xyz', 'rpy']) {
    if (!originEl.hasAttribute(attribute)) {
      continue;
    }

    const values = parseNumberList(originEl.getAttribute(attribute));
    if (values.length === 3 && !hasInvalidNumber(values)) {
      continue;
    }

    pushDiagnostic(diagnostics, {
      code: `${codePrefix}_origin_${attribute}_invalid`,
      severity: 'warning',
      category,
      message: `${label} has an invalid origin ${attribute} vector.`,
      relatedIds,
      source: { tag: sourceTag, name: sourceName, attribute },
    });
  }
}

function addJointDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  robotEl: Element,
  parsedLinks: Record<string, UrdfLink>,
  joints: Record<string, UrdfJoint>,
): void {
  const childLinkUsage = new Map<string, string[]>();

  getDirectChildElements(robotEl, 'joint').forEach((jointEl) => {
    const jointName = jointEl.getAttribute('name')?.trim();
    const jointType = jointEl.getAttribute('type')?.trim() || JointType.REVOLUTE;
    const parentLink = jointEl.querySelector('parent')?.getAttribute('link')?.trim() || '';
    const childLink = jointEl.querySelector('child')?.getAttribute('link')?.trim() || '';
    const relatedIds = [jointName, parentLink, childLink].filter(isNonEmptyString);
    addOriginDiagnostics(diagnostics, {
      originEl: getDirectChildElements(jointEl, 'origin')[0],
      codePrefix: 'joint',
      category: 'joint',
      label: `Joint "${jointName || '<unnamed>'}"`,
      relatedIds,
      sourceTag: 'origin',
      sourceName: jointName,
    });

    if (jointType && !VALID_JOINT_TYPES.has(jointType)) {
      pushDiagnostic(diagnostics, {
        code: 'unknown_joint_type',
        severity: 'error',
        category: 'joint',
        message: `Joint "${jointName || '<unnamed>'}" uses unknown type "${jointType}".`,
        relatedIds,
        source: { tag: 'joint', name: jointName, attribute: 'type' },
      });
    }

    if (!parentLink) {
      pushDiagnostic(diagnostics, {
        code: 'joint_missing_parent',
        severity: 'error',
        category: 'topology',
        message: `Joint "${jointName || '<unnamed>'}" is missing a parent link reference.`,
        relatedIds,
        source: { tag: 'parent', name: jointName, attribute: 'link' },
      });
    } else if (!parsedLinks[parentLink]) {
      pushDiagnostic(diagnostics, {
        code: 'joint_parent_link_missing',
        severity: 'warning',
        category: 'topology',
        message: `Joint "${jointName || '<unnamed>'}" references missing parent link "${parentLink}".`,
        relatedIds,
        source: { tag: 'parent', name: jointName, attribute: 'link' },
      });
    }

    if (!childLink) {
      pushDiagnostic(diagnostics, {
        code: 'joint_missing_child',
        severity: 'error',
        category: 'topology',
        message: `Joint "${jointName || '<unnamed>'}" is missing a child link reference.`,
        relatedIds,
        source: { tag: 'child', name: jointName, attribute: 'link' },
      });
    } else if (!parsedLinks[childLink]) {
      pushDiagnostic(diagnostics, {
        code: 'joint_child_link_missing',
        severity: 'error',
        category: 'topology',
        message: `Joint "${jointName || '<unnamed>'}" references missing child link "${childLink}".`,
        relatedIds,
        source: { tag: 'child', name: jointName, attribute: 'link' },
      });
    }

    if (childLink && jointName) {
      childLinkUsage.set(childLink, [...(childLinkUsage.get(childLink) ?? []), jointName]);
    }

    const jointContext = {
      jointEl,
      jointName,
      jointType,
      relatedIds,
    };
    addJointLimitDiagnostics(diagnostics, jointContext);
    addJointAxisDiagnostics(diagnostics, jointContext);
  });

  childLinkUsage.forEach((jointNames, childLink) => {
    if (jointNames.length <= 1) {
      return;
    }

    pushDiagnostic(diagnostics, {
      code: 'link_has_multiple_parent_joints',
      severity: 'error',
      category: 'topology',
      message: `Link "${childLink}" is the child of multiple joints: ${jointNames.join(', ')}.`,
      relatedIds: [childLink, ...jointNames],
      source: { tag: 'joint', name: childLink, attribute: 'child' },
    });
  });

  Object.values(joints).forEach((joint) => {
    if (joint.mimic?.joint && !joints[joint.mimic.joint]) {
      pushDiagnostic(diagnostics, {
        code: 'mimic_joint_missing_target',
        severity: 'warning',
        category: 'joint',
        message: `Joint "${joint.name}" mimics missing joint "${joint.mimic.joint}".`,
        relatedIds: [joint.id, joint.mimic.joint],
        source: { tag: 'mimic', name: joint.name, attribute: 'joint' },
      });
    }
  });
}

function addJointLimitDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  { jointEl, jointName, jointType, relatedIds }: JointDiagnosticContext,
): void {
  if (!MOVABLE_JOINT_TYPES.has(jointType)) {
    return;
  }

  const limitEl = jointEl.querySelector('limit');
  if (!limitEl) {
    // URDF spec makes <limit> required only for revolute and prismatic joints.
    // Wheels and passive continuous joints legitimately spin unbounded, so an
    // absent <limit> is not a defect worth reporting for them.
    if (jointType === JointType.CONTINUOUS) {
      return;
    }

    pushDiagnostic(diagnostics, {
      code: 'movable_joint_missing_limit',
      severity: 'error',
      category: 'joint',
      message: `Movable joint "${jointName || '<unnamed>'}" has no <limit> element.`,
      relatedIds,
      source: { tag: 'joint', name: jointName, attribute: 'limit' },
    });
    return;
  }

  const requiredAttributes =
    jointType === JointType.CONTINUOUS ? ['effort', 'velocity'] : ['lower', 'upper', 'effort', 'velocity'];
  requiredAttributes.forEach((attribute) => {
    const value = parseFiniteNumber(limitEl.getAttribute(attribute));
    if (value === null) {
      pushDiagnostic(diagnostics, {
        code: `joint_limit_missing_${attribute}`,
        severity: 'error',
        category: 'joint',
        message: `Joint "${jointName || '<unnamed>'}" has no finite limit ${attribute}.`,
        relatedIds,
        source: { tag: 'limit', name: jointName, attribute },
      });
    }
  });

  const lower = parseFiniteNumber(limitEl.getAttribute('lower'));
  const upper = parseFiniteNumber(limitEl.getAttribute('upper'));
  if (lower !== null && upper !== null && lower > upper) {
    pushDiagnostic(diagnostics, {
      code: 'joint_limit_lower_greater_than_upper',
      severity: 'error',
      category: 'joint',
      message: `Joint "${jointName || '<unnamed>'}" has lower limit greater than upper limit.`,
      relatedIds,
      source: { tag: 'limit', name: jointName },
    });
  }

  ['effort', 'velocity'].forEach((attribute) => {
    const value = parseFiniteNumber(limitEl.getAttribute(attribute));
    if (value !== null && value <= 0) {
      pushDiagnostic(diagnostics, {
        code: `joint_limit_nonpositive_${attribute}`,
        severity: 'warning',
        category: 'simulation',
        message: `Joint "${jointName || '<unnamed>'}" has non-positive limit ${attribute}.`,
        relatedIds,
        source: { tag: 'limit', name: jointName, attribute },
      });
    }
  });
}

function addJointAxisDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  { jointEl, jointName, jointType, relatedIds }: JointDiagnosticContext,
): void {
  if (!AXIS_JOINT_TYPES.has(jointType)) {
    return;
  }

  const axisEl = jointEl.querySelector('axis');
  if (!axisEl) {
    return;
  }

  const values = parseNumberList(axisEl.getAttribute('xyz'));
  if (values.length !== 3 || hasInvalidNumber(values) || vectorMagnitude(values) <= 1e-12) {
    pushDiagnostic(diagnostics, {
      code: 'joint_axis_invalid',
      severity: 'error',
      category: 'joint',
      message: `Joint "${jointName || '<unnamed>'}" has an invalid or zero axis vector.`,
      relatedIds,
      source: { tag: 'axis', name: jointName, attribute: 'xyz' },
    });
  }
}

function addTopologyDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  parsedLinks: Record<string, UrdfLink>,
  joints: Record<string, UrdfJoint>,
  rootLinkId: string,
): { disconnectedRootCount: number; syntheticParentLinkCount: number } {
  const internalJoints = Object.values(joints).filter(
    (joint) => Boolean(parsedLinks[joint.parentLinkId]) && Boolean(parsedLinks[joint.childLinkId]),
  );
  const childLinkIds = new Set(internalJoints.map((joint) => joint.childLinkId));
  const rootCandidates = Object.keys(parsedLinks).filter((linkId) => !childLinkIds.has(linkId));
  const syntheticParentLinkIds = Object.values(joints)
    .filter((joint) => !parsedLinks[joint.parentLinkId] && parsedLinks[joint.childLinkId])
    .map((joint) => joint.parentLinkId)
    .filter(isNonEmptyString);

  if (rootCandidates.length > 1) {
    pushDiagnostic(diagnostics, {
      code: 'multiple_root_links',
      severity: 'warning',
      category: 'topology',
      message: `URDF has multiple root candidates; "${rootLinkId}" was selected for display.`,
      relatedIds: rootCandidates,
      source: { tag: 'robot' },
    });
  }

  addCycleDiagnostics(diagnostics, internalJoints);

  return {
    disconnectedRootCount: rootCandidates.length,
    syntheticParentLinkCount: new Set(syntheticParentLinkIds).size,
  };
}

function addCycleDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  internalJoints: UrdfJoint[],
): void {
  const parentByChild = new Map<string, string>();
  internalJoints.forEach((joint) => parentByChild.set(joint.childLinkId, joint.parentLinkId));

  for (const childLinkId of parentByChild.keys()) {
    const visited = new Set<string>();
    let cursor: string | undefined = childLinkId;
    while (cursor) {
      if (visited.has(cursor)) {
        pushDiagnostic(diagnostics, {
          code: 'topology_cycle_detected',
          severity: 'error',
          category: 'topology',
          message: `URDF topology contains a cycle involving link "${cursor}".`,
          relatedIds: [...visited],
          source: { tag: 'joint', name: cursor },
        });
        return;
      }
      visited.add(cursor);
      cursor = parentByChild.get(cursor);
    }
  }
}

function addInertialDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  linkEls: Element[],
): void {
  linkEls.forEach((linkEl) => {
    const linkName = linkEl.getAttribute('name')?.trim();
    const inertialEl = getDirectChildElements(linkEl, 'inertial')[0];
    if (!inertialEl || !linkName) {
      return;
    }

    addOriginDiagnostics(diagnostics, {
      originEl: getDirectChildElements(inertialEl, 'origin')[0],
      codePrefix: 'inertial',
      category: 'physical',
      label: `Link "${linkName}" inertial`,
      relatedIds: [linkName],
      sourceTag: 'origin',
      sourceName: linkName,
    });

    const mass = parseFiniteNumber(inertialEl.querySelector('mass')?.getAttribute('value') ?? null);
    if (mass === null || mass <= 0) {
      pushDiagnostic(diagnostics, {
        code: 'inertial_mass_nonpositive',
        severity: 'warning',
        category: 'physical',
        message: `Link "${linkName}" has missing or non-positive inertial mass.`,
        relatedIds: [linkName],
        source: { tag: 'mass', name: linkName, attribute: 'value' },
      });
    }

    const inertiaEl = inertialEl.querySelector('inertia');
    if (!inertiaEl) {
      pushDiagnostic(diagnostics, {
        code: 'inertia_missing',
        severity: 'warning',
        category: 'physical',
        message: `Link "${linkName}" has inertial data without an <inertia> matrix.`,
        relatedIds: [linkName],
        source: { tag: 'inertia', name: linkName },
      });
      return;
    }

    const ixx = parseFiniteNumber(inertiaEl.getAttribute('ixx'));
    const iyy = parseFiniteNumber(inertiaEl.getAttribute('iyy'));
    const izz = parseFiniteNumber(inertiaEl.getAttribute('izz'));
    if (ixx === null || iyy === null || izz === null || ixx <= 0 || iyy <= 0 || izz <= 0) {
      pushDiagnostic(diagnostics, {
        code: 'inertia_diagonal_nonpositive',
        severity: 'warning',
        category: 'physical',
        message: `Link "${linkName}" has missing or non-positive inertia diagonal values.`,
        relatedIds: [linkName],
        source: { tag: 'inertia', name: linkName },
      });
      return;
    }

    if (ixx + iyy < izz || ixx + izz < iyy || iyy + izz < ixx) {
      pushDiagnostic(diagnostics, {
        code: 'inertia_triangle_inequality',
        severity: 'warning',
        category: 'physical',
        message: `Link "${linkName}" inertia violates the principal-moment triangle inequality.`,
        relatedIds: [linkName],
        source: { tag: 'inertia', name: linkName },
      });
    }
  });
}

function addGeometryDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  linkEls: Element[],
): void {
  linkEls.forEach((linkEl) => {
    const linkName = linkEl.getAttribute('name')?.trim();
    if (!linkName) {
      return;
    }

    for (const section of ['visual', 'collision'] as const) {
      getDirectChildElements(linkEl, section).forEach((geometryOwnerEl) => {
        addOriginDiagnostics(diagnostics, {
          originEl: getDirectChildElements(geometryOwnerEl, 'origin')[0],
          codePrefix: section,
          category: 'geometry',
          label: `Link "${linkName}" ${section}`,
          relatedIds: [linkName],
          sourceTag: section,
          sourceName: linkName,
        });

        const geometryEl = getDirectChildElements(geometryOwnerEl, 'geometry')[0];
        if (!geometryEl) {
          pushDiagnostic(diagnostics, {
            code: `${section}_missing_geometry`,
            severity: 'warning',
            category: 'geometry',
            message: `Link "${linkName}" has a <${section}> element without geometry.`,
            relatedIds: [linkName],
            source: { tag: section, name: linkName },
          });
          return;
        }

        addPrimitiveGeometryDiagnostics(diagnostics, geometryEl, linkName, section);
        addMeshGeometryDiagnostics(diagnostics, geometryEl, linkName, section);
      });
    }
  });
}

function addPrimitiveGeometryDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  geometryEl: Element,
  linkName: string,
  section: 'visual' | 'collision',
): void {
  const boxEl = geometryEl.querySelector('box');
  if (boxEl) {
    const size = parseNumberList(boxEl.getAttribute('size'));
    if (size.length !== 3 || hasInvalidNumber(size) || size.some((value) => value <= 0)) {
      pushDiagnostic(diagnostics, {
        code: `${section}_box_size_invalid`,
        severity: 'warning',
        category: 'geometry',
        message: `Link "${linkName}" has a ${section} box with non-positive or invalid size.`,
        relatedIds: [linkName],
        source: { tag: 'box', name: linkName, attribute: 'size' },
      });
    }
  }

  for (const tagName of ['cylinder', 'capsule']) {
    const element = geometryEl.querySelector(tagName);
    if (!element) {
      continue;
    }
    const radius = parseFiniteNumber(element.getAttribute('radius'));
    const length = parseFiniteNumber(element.getAttribute('length'));
    if (radius === null || radius <= 0 || length === null || length <= 0) {
      pushDiagnostic(diagnostics, {
        code: `${section}_${tagName}_dimensions_invalid`,
        severity: 'warning',
        category: 'geometry',
        message: `Link "${linkName}" has a ${section} ${tagName} with invalid radius or length.`,
        relatedIds: [linkName],
        source: { tag: tagName, name: linkName },
      });
    }
  }

  const sphereEl = geometryEl.querySelector('sphere');
  if (sphereEl) {
    const radius = parseFiniteNumber(sphereEl.getAttribute('radius'));
    if (radius === null || radius <= 0) {
      pushDiagnostic(diagnostics, {
        code: `${section}_sphere_radius_invalid`,
        severity: 'warning',
        category: 'geometry',
        message: `Link "${linkName}" has a ${section} sphere with invalid radius.`,
        relatedIds: [linkName],
        source: { tag: 'sphere', name: linkName, attribute: 'radius' },
      });
    }
  }
}

function addMeshGeometryDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  geometryEl: Element,
  linkName: string,
  section: 'visual' | 'collision',
): void {
  const meshEl = geometryEl.querySelector('mesh');
  if (!meshEl) {
    return;
  }

  const filename = meshEl.getAttribute('filename')?.trim();
  if (!filename) {
    pushDiagnostic(diagnostics, {
      code: `${section}_mesh_filename_missing`,
      severity: 'warning',
      category: 'geometry',
      message: `Link "${linkName}" has a ${section} mesh without a filename.`,
      relatedIds: [linkName],
      source: { tag: 'mesh', name: linkName, attribute: 'filename' },
    });
  }

  const scaleAttr = meshEl.getAttribute('scale');
  if (!scaleAttr) {
    return;
  }
  const scale = parseNumberList(scaleAttr);
  const validScaleLength = scale.length === 1 || scale.length === 3;
  if (!validScaleLength || hasInvalidNumber(scale) || scale.some((value) => value === 0)) {
    pushDiagnostic(diagnostics, {
      code: `${section}_mesh_scale_invalid`,
      severity: 'warning',
      category: 'geometry',
      message: `Link "${linkName}" has a ${section} mesh with invalid or zero scale.`,
      relatedIds: [linkName],
      source: { tag: 'mesh', name: linkName, attribute: 'scale' },
    });
  }
}

function addMaterialDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  robotEl: Element,
): void {
  addDuplicateNameDiagnostics(diagnostics, getNamedDirectChildren(robotEl, 'material'), 'material');

  getDirectChildElements(robotEl, 'link').forEach((linkEl) => {
    const linkName = linkEl.getAttribute('name')?.trim();
    getDirectChildElements(linkEl, 'visual').forEach((visualEl) => {
      const materialEls = getDirectChildElements(visualEl, 'material');
      if (materialEls.length <= 1) {
        return;
      }

      pushDiagnostic(diagnostics, {
        code: 'visual_has_multiple_materials',
        severity: 'info',
        category: 'material',
        message: `Link "${linkName || '<unnamed>'}" has a visual with multiple material elements.`,
        relatedIds: linkName ? [linkName] : undefined,
        source: { tag: 'visual', name: linkName },
      });
    });
  });
}

function addSourceExtensionDiagnostics(
  diagnostics: RobotSourceDiagnostic[],
  robotEl: Element,
): void {
  const unresolvedXacroTags = getDirectChildElements(robotEl).filter((child) =>
    child.tagName.startsWith('xacro:'),
  );
  if (unresolvedXacroTags.length === 0) {
    return;
  }

  pushDiagnostic(diagnostics, {
    code: 'unresolved_xacro_tags',
    severity: 'warning',
    category: 'source',
    message: `URDF still contains ${unresolvedXacroTags.length} unresolved xacro extension tags.`,
    source: { tag: 'xacro' },
  });
}

function countDiagnosticsBySeverity(
  diagnostics: RobotSourceDiagnostic[],
): Record<RobotSourceDiagnosticSeverity, number> {
  return diagnostics.reduce<Record<RobotSourceDiagnosticSeverity, number>>(
    (counts, diagnostic) => {
      counts[diagnostic.severity] += 1;
      return counts;
    },
    { error: 0, warning: 0, info: 0 },
  );
}

export function buildUrdfInspectionContext({
  robotEl,
  parsedLinks,
  joints,
  rootLinkId,
}: BuildUrdfInspectionContextOptions): RobotUrdfInspectionContext {
  const diagnostics: RobotSourceDiagnostic[] = [];
  const linkEls = getDirectChildElements(robotEl, 'link');
  const jointEls = getDirectChildElements(robotEl, 'joint');
  const visualCount = linkEls.reduce(
    (sum, linkEl) => sum + getDirectChildElements(linkEl, 'visual').length,
    0,
  );
  const collisionCount = linkEls.reduce(
    (sum, linkEl) => sum + getDirectChildElements(linkEl, 'collision').length,
    0,
  );
  const inertialCount = linkEls.reduce(
    (sum, linkEl) => sum + getDirectChildElements(linkEl, 'inertial').length,
    0,
  );
  const meshCount = linkEls.reduce(
    (sum, linkEl) => sum + Array.from(linkEl.querySelectorAll('mesh')).length,
    0,
  );

  if (!robotEl.getAttribute('name')?.trim()) {
    pushDiagnostic(diagnostics, {
      code: 'robot_missing_name',
      severity: 'warning',
      category: 'source',
      message: 'URDF robot tag has no name attribute.',
      source: { tag: 'robot', attribute: 'name' },
    });
  }

  addMissingNameDiagnostics(diagnostics, linkEls, 'link');
  addMissingNameDiagnostics(diagnostics, jointEls, 'joint');
  addDuplicateNameDiagnostics(diagnostics, getNamedDirectChildren(robotEl, 'link'), 'link');
  addDuplicateNameDiagnostics(diagnostics, getNamedDirectChildren(robotEl, 'joint'), 'joint');
  addMaterialDiagnostics(diagnostics, robotEl);
  addSourceExtensionDiagnostics(diagnostics, robotEl);
  addJointDiagnostics(diagnostics, robotEl, parsedLinks, joints);
  const topologyFacts = addTopologyDiagnostics(diagnostics, parsedLinks, joints, rootLinkId);
  addInertialDiagnostics(diagnostics, linkEls);
  addGeometryDiagnostics(diagnostics, linkEls);

  const retainedDiagnostics = diagnostics.slice(0, MAX_RETAINED_DIAGNOSTICS);
  const omittedDiagnosticCount = Math.max(0, diagnostics.length - retainedDiagnostics.length);

  return {
    diagnostics: retainedDiagnostics,
    diagnosticCounts: countDiagnosticsBySeverity(diagnostics),
    facts: {
      linkCount: Object.keys(parsedLinks).length,
      jointCount: Object.keys(joints).length,
      visualCount,
      collisionCount,
      inertialCount,
      materialCount: getDirectChildElements(robotEl, 'material').length,
      meshCount,
      ...topologyFacts,
    },
    ...(omittedDiagnosticCount > 0 ? { omittedDiagnosticCount } : {}),
  };
}
