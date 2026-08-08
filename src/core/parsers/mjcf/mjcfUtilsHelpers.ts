import * as THREE from 'three';
import { convertMjcfAngle } from './mjcfMath';

export interface MJCFCompilerSettings {
  angleUnit: 'radian' | 'degree';
  assetdir: string;
  meshdir: string;
  texturedir: string;
  eulerSequence: string;
  autolimits: boolean;
  fitaabb: boolean;
  inertiafromgeom: 'false' | 'true' | 'auto';
  inertiagrouprange?: [number, number];
  boundinertia?: number;
}

export interface MJCFDefaultsRegistry {
  root: MJCFElementDefaults;
  classesByQName: Map<string, MJCFDefaultClassEntry>;
  qnamesByClassName: Map<string, string[]>;
}

export type MJCFElementType =
  | 'body'
  | 'geom'
  | 'joint'
  | 'inertial'
  | 'mesh'
  | 'material'
  | 'texture'
  | 'site'
  | 'tendon'
  | 'motor'
  | 'position'
  | 'velocity'
  | 'intvelocity'
  | 'general'
  | 'damper'
  | 'muscle'
  | 'adhesion';

export type MJCFAttributeMap = Record<string, string>;

export interface MJCFElementDefaults {
  body: MJCFAttributeMap;
  geom: MJCFAttributeMap;
  joint: MJCFAttributeMap;
  inertial: MJCFAttributeMap;
  mesh: MJCFAttributeMap;
  material: MJCFAttributeMap;
  texture: MJCFAttributeMap;
  site: MJCFAttributeMap;
  tendon: MJCFAttributeMap;
  motor: MJCFAttributeMap;
  position: MJCFAttributeMap;
  velocity: MJCFAttributeMap;
  intvelocity: MJCFAttributeMap;
  general: MJCFAttributeMap;
  damper: MJCFAttributeMap;
  muscle: MJCFAttributeMap;
  adhesion: MJCFAttributeMap;
}

export interface MJCFDefaultClassEntry {
  qname: string;
  className: string;
  parentQName?: string;
  defaults: MJCFElementDefaults;
  children: string[];
}

export const MJCF_ROOT_PATTERN =
  /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[\s\S]*?>\s*)*<(?:mujoco|mujocoinclude)\b/i;

export function repairMissingAttributeWhitespace(content: string): string {
  return content
    .replace(/"(?=[A-Za-z_][\w:.-]*=)/g, '" ')
    .replace(/'(?=[A-Za-z_][\w:.-]*=)/g, "' ");
}

export function parseXmlDocument(content: string): {
  doc: Document | null;
  parseErrorText: string | null;
} {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      return {
        doc: null,
        parseErrorText: parseError.textContent?.trim() || 'unknown parse error',
      };
    }

    return {
      doc,
      parseErrorText: null,
    };
  } catch (error) {
    return {
      doc: null,
      parseErrorText: error instanceof Error ? error.message : 'unknown parse error',
    };
  }
}

export function normalizeAngleUnit(value: string | null | undefined): 'radian' | 'degree' | null {
  if (!value) {
    return null;
  }

  return value.trim().toLowerCase() === 'degree' ? 'degree' : 'radian';
}

export function normalizeEulerSequence(sequence: string | undefined): string {
  const normalized = (sequence || 'xyz').trim();
  if (normalized.length !== 3) {
    return 'xyz';
  }

  if (
    [...normalized]
      .map((axis) => axis.toLowerCase())
      .sort()
      .join('') !== 'xyz'
  ) {
    return 'xyz';
  }

  return normalized;
}

export function pickOrthogonalUnitVector(input: THREE.Vector3): THREE.Vector3 {
  const absolute = {
    x: Math.abs(input.x),
    y: Math.abs(input.y),
    z: Math.abs(input.z),
  };

  const basis =
    absolute.x <= absolute.y && absolute.x <= absolute.z
      ? new THREE.Vector3(1, 0, 0)
      : absolute.y <= absolute.z
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);

  return basis.sub(input.clone().multiplyScalar(basis.dot(input))).normalize();
}

export function convertAngle(value: number, angleUnit: 'radian' | 'degree'): number {
  return convertMjcfAngle(value, angleUnit);
}

export function makeQuaternionFromBasis(
  xAxis: { x: number; y: number; z: number },
  yAxis: { x: number; y: number; z: number },
  zAxis: { x: number; y: number; z: number },
): [number, number, number, number] {
  const basis = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(xAxis.x, xAxis.y, xAxis.z),
    new THREE.Vector3(yAxis.x, yAxis.y, yAxis.z),
    new THREE.Vector3(zAxis.x, zAxis.y, zAxis.z),
  );
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(basis).normalize();
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

export function normalizeVector3OrNull(values: number[] | null): THREE.Vector3 | null {
  if (!values || values.length < 3) {
    return null;
  }

  const vector = new THREE.Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
  if (vector.lengthSq() <= 1e-12) {
    return null;
  }

  return vector.normalize();
}

export function quaternionFromAxisAngle(
  values: number[] | null,
  angleUnit: 'radian' | 'degree',
): [number, number, number, number] | undefined {
  if (!values || values.length < 4) {
    return undefined;
  }

  const axis = normalizeVector3OrNull(values);
  if (!axis) {
    return [1, 0, 0, 0];
  }

  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    axis,
    convertAngle(values[3] ?? 0, angleUnit),
  );
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

export function quaternionFromEuler(
  values: number[] | null,
  settings: MJCFCompilerSettings,
): [number, number, number, number] | undefined {
  if (!values || values.length < 3) {
    return undefined;
  }

  const rawSequence = normalizeEulerSequence(settings.eulerSequence);
  const isExtrinsic = rawSequence === rawSequence.toUpperCase();
  const sequence = isExtrinsic
    ? rawSequence.toLowerCase().split('').reverse().join('')
    : rawSequence.toLowerCase();
  const orderedValues = isExtrinsic ? [...values].slice(0, 3).reverse() : values;
  const angleByAxis = { x: 0, y: 0, z: 0 };
  for (let index = 0; index < 3; index += 1) {
    const axis = sequence[index]?.toLowerCase() as 'x' | 'y' | 'z';
    angleByAxis[axis] = convertAngle(orderedValues[index] ?? 0, settings.angleUnit);
  }

  const euler = new THREE.Euler(
    angleByAxis.x,
    angleByAxis.y,
    angleByAxis.z,
    sequence.toUpperCase() as THREE.EulerOrder,
  );
  const quaternion = new THREE.Quaternion().setFromEuler(euler).normalize();
  return [quaternion.w, quaternion.x, quaternion.y, quaternion.z];
}

export function quaternionFromXYAxes(
  values: number[] | null,
): [number, number, number, number] | undefined {
  if (!values || values.length < 6) {
    return undefined;
  }

  const xAxis = normalizeVector3OrNull(values.slice(0, 3));
  if (!xAxis) {
    return undefined;
  }

  const ySeed = new THREE.Vector3(values[3] ?? 0, values[4] ?? 0, values[5] ?? 0);
  const orthogonalY = ySeed.sub(xAxis.clone().multiplyScalar(ySeed.dot(xAxis)));
  const yAxis =
    orthogonalY.lengthSq() > 1e-12 ? orthogonalY.normalize() : pickOrthogonalUnitVector(xAxis);
  const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis).normalize();
  const correctedY = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  return makeQuaternionFromBasis(xAxis, correctedY, zAxis);
}

export function quaternionFromZAxis(
  values: number[] | null,
): [number, number, number, number] | undefined {
  const zAxis = normalizeVector3OrNull(values);
  if (!zAxis) {
    return undefined;
  }

  const helper =
    Math.abs(zAxis.z) < 0.999 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(helper, zAxis).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  return makeQuaternionFromBasis(xAxis, yAxis, zAxis);
}

export function createEmptyDefaults(): MJCFElementDefaults {
  return {
    body: {},
    geom: {},
    joint: {},
    inertial: {},
    mesh: {},
    material: {},
    texture: {},
    site: {},
    tendon: {},
    motor: {},
    position: {},
    velocity: {},
    intvelocity: {},
    general: {},
    damper: {},
    muscle: {},
    adhesion: {},
  };
}

export function cloneDefaults(defaults: MJCFElementDefaults): MJCFElementDefaults {
  return {
    body: { ...defaults.body },
    geom: { ...defaults.geom },
    joint: { ...defaults.joint },
    inertial: { ...defaults.inertial },
    mesh: { ...defaults.mesh },
    material: { ...defaults.material },
    texture: { ...defaults.texture },
    site: { ...defaults.site },
    tendon: { ...defaults.tendon },
    motor: { ...defaults.motor },
    position: { ...defaults.position },
    velocity: { ...defaults.velocity },
    intvelocity: { ...defaults.intvelocity },
    general: { ...defaults.general },
    damper: { ...defaults.damper },
    muscle: { ...defaults.muscle },
    adhesion: { ...defaults.adhesion },
  };
}

export function mergeDefaults(
  base: MJCFElementDefaults,
  override: Partial<MJCFElementDefaults>,
): MJCFElementDefaults {
  return {
    body: { ...base.body, ...(override.body || {}) },
    geom: { ...base.geom, ...(override.geom || {}) },
    joint: { ...base.joint, ...(override.joint || {}) },
    inertial: { ...base.inertial, ...(override.inertial || {}) },
    mesh: { ...base.mesh, ...(override.mesh || {}) },
    material: { ...base.material, ...(override.material || {}) },
    texture: { ...base.texture, ...(override.texture || {}) },
    site: { ...base.site, ...(override.site || {}) },
    tendon: { ...base.tendon, ...(override.tendon || {}) },
    motor: { ...base.motor, ...(override.motor || {}) },
    position: { ...base.position, ...(override.position || {}) },
    velocity: { ...base.velocity, ...(override.velocity || {}) },
    intvelocity: { ...base.intvelocity, ...(override.intvelocity || {}) },
    general: { ...base.general, ...(override.general || {}) },
    damper: { ...base.damper, ...(override.damper || {}) },
    muscle: { ...base.muscle, ...(override.muscle || {}) },
    adhesion: { ...base.adhesion, ...(override.adhesion || {}) },
  };
}

export function collectDirectAttributes(
  element: Element,
  selector: MJCFElementType,
): MJCFAttributeMap {
  const directChild = element.querySelector(`:scope > ${selector}`);
  if (!directChild) {
    return {};
  }

  const attributes: MJCFAttributeMap = {};
  for (const attribute of Array.from(directChild.attributes)) {
    attributes[attribute.name] = attribute.value;
  }

  return attributes;
}

export function collectDefaultAttributes(defaultEl: Element): Partial<MJCFElementDefaults> {
  return {
    body: collectDirectAttributes(defaultEl, 'body'),
    geom: collectDirectAttributes(defaultEl, 'geom'),
    joint: collectDirectAttributes(defaultEl, 'joint'),
    inertial: collectDirectAttributes(defaultEl, 'inertial'),
    mesh: collectDirectAttributes(defaultEl, 'mesh'),
    material: collectDirectAttributes(defaultEl, 'material'),
    texture: collectDirectAttributes(defaultEl, 'texture'),
    site: collectDirectAttributes(defaultEl, 'site'),
    tendon: collectDirectAttributes(defaultEl, 'tendon'),
    motor: collectDirectAttributes(defaultEl, 'motor'),
    position: collectDirectAttributes(defaultEl, 'position'),
    velocity: collectDirectAttributes(defaultEl, 'velocity'),
    intvelocity: collectDirectAttributes(defaultEl, 'intvelocity'),
    general: collectDirectAttributes(defaultEl, 'general'),
    damper: collectDirectAttributes(defaultEl, 'damper'),
    muscle: collectDirectAttributes(defaultEl, 'muscle'),
    adhesion: collectDirectAttributes(defaultEl, 'adhesion'),
  };
}

export function registerDefaultClass(
  registry: MJCFDefaultsRegistry,
  className: string,
  qname: string,
  parentQName: string | undefined,
  defaults: MJCFElementDefaults,
): void {
  const entry: MJCFDefaultClassEntry = {
    qname,
    className,
    parentQName,
    defaults,
    children: [],
  };

  registry.classesByQName.set(qname, entry);

  const qnames = registry.qnamesByClassName.get(className) || [];
  qnames.push(qname);
  registry.qnamesByClassName.set(className, qnames);

  if (parentQName) {
    const parent = registry.classesByQName.get(parentQName);
    if (parent) {
      parent.children.push(qname);
    }
  }
}

export function visitDefaultElement(
  defaultEl: Element,
  registry: MJCFDefaultsRegistry,
  scopeDefaults: MJCFElementDefaults,
  activeNamedQName?: string,
): MJCFElementDefaults {
  const mergedDefaults = mergeDefaults(scopeDefaults, collectDefaultAttributes(defaultEl));
  const className = defaultEl.getAttribute('class')?.trim();

  let nextNamedQName = activeNamedQName;
  if (className) {
    nextNamedQName = activeNamedQName ? `${activeNamedQName}/${className}` : className;
    registerDefaultClass(
      registry,
      className,
      nextNamedQName,
      activeNamedQName,
      cloneDefaults(mergedDefaults),
    );
  }

  const childDefaults = cloneDefaults(mergedDefaults);
  const childDefaultElements = defaultEl.querySelectorAll(':scope > default');
  childDefaultElements.forEach((childDefaultEl) => {
    visitDefaultElement(childDefaultEl, registry, childDefaults, nextNamedQName);
  });

  return mergedDefaults;
}

export function findDescendantClassQName(
  registry: MJCFDefaultsRegistry,
  rootQName: string,
  className: string,
): string | undefined {
  const root = registry.classesByQName.get(rootQName);
  if (!root) {
    return undefined;
  }

  for (const childQName of root.children) {
    const child = registry.classesByQName.get(childQName);
    if (!child) {
      continue;
    }

    if (child.className === className) {
      return child.qname;
    }

    const nestedMatch = findDescendantClassQName(registry, childQName, className);
    if (nestedMatch) {
      return nestedMatch;
    }
  }

  return undefined;
}

export function deriveAssetName(
  filePath: string,
  fallbackPrefix: string,
  assetIndex: number,
): string {
  const fileName = filePath.split('/').pop()?.split('\\').pop() || '';
  const lastDotIndex = fileName.lastIndexOf('.');
  return (
    (lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName) ||
    `${fallbackPrefix}_${assetIndex}`
  );
}
