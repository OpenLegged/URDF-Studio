import * as THREE from 'three';

import { resolveObjAuthoredMaterialsFromAssets } from '@/core/loaders/objMaterialMetadata';
import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotClosedLoopConstraint,
  type Euler,
  type RobotMaterialState,
  type RobotState,
  type UrdfJoint,
  type UrdfLink,
  type UrdfVisual,
  type UrdfVisualMaterial,
  type RobotFile,
  type Vector3,
  type SdfHeightmap,
} from '@/types';
import { resolveGazeboScriptMaterial } from './gazeboMaterialScripts';
import {
  createSdfIncludeResolutionContext,
  type SdfIncludeResolutionContext,
} from './sdfIncludeResolution';

type Pose = { xyz: Vector3; rpy: Euler };
type ParsedPose = { pose: Pose; relativeTo: string | null; specified: boolean };

const ZERO_VECTOR: Vector3 = { x: 0, y: 0, z: 0 };
const ZERO_EULER: Euler = { r: 0, p: 0, y: 0 };
const IDENTITY_POSE: Pose = { xyz: ZERO_VECTOR, rpy: ZERO_EULER };
const IDENTITY_SCALE = new THREE.Vector3(1, 1, 1);
const MODEL_FRAME = '__model__';
const WORLD_FRAME = 'world';
const XML_DECLARATION_PATTERN = /<\?xml[^>]*\?>/gi;
const XML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const BARE_XML_ATTRIBUTE_PATTERN = /(\s[\w:.-]+)=([^\s"'=<>`]+)/g;

const GAZEBO_COLORS: Record<string, string> = {
  'Gazebo/Black': '#000000',
  'Gazebo/Blue': '#0000FF',
  'Gazebo/Green': '#00FF00',
  'Gazebo/Red': '#FF0000',
  'Gazebo/White': '#FFFFFF',
  'Gazebo/Yellow': '#FFFF00',
  'Gazebo/Grey': '#808080',
  'Gazebo/DarkGrey': '#333333',
  'Gazebo/LightGrey': '#CCCCCC',
  'Gazebo/Orange': '#FFA500',
  'Gazebo/Purple': '#800080',
  'Gazebo/Turquoise': '#40E0D0',
  'Gazebo/Gold': '#FFD700',
  'Gazebo/Indigo': '#4B0082',
  'Gazebo/SkyBlue': '#87CEEB',
  'Gazebo/Wood': '#8B4513',
  'Gazebo/FlatBlack': '#000000',
  'Gazebo/ZincYellow': '#9B9B00',
};

interface ParsedMaterialDefinition {
  color?: string;
  texture?: string;
  materialSource?: UrdfVisual['materialSource'];
  authoredMaterials?: UrdfVisualMaterial[];
}

interface ParsedSdfGeometry {
  type: GeometryType;
  dimensions: Vector3;
  meshPath?: string;
  submeshName?: string;
  submeshCenter?: boolean;
  sdfHeightmap?: SdfHeightmap;
  polylinePoints?: { x: number; y: number }[];
  polylineHeight?: number;
}

interface ParsedSdfVisual {
  name: string;
  geometry: ParsedSdfGeometry;
  pose: Pose;
  color?: string;
  texture?: string;
  materialSource?: UrdfVisual['materialSource'];
  authoredMaterials?: UrdfVisualMaterial[];
}

interface ParsedSdfCollision {
  geometry: ParsedSdfGeometry;
  pose: Pose;
}

interface ParsedSdfLinkRecord {
  parsedPose: ParsedPose;
  pose: Pose;
  worldMatrix: THREE.Matrix4;
}

interface ParsedSdfJointRecord {
  joint: UrdfJoint;
  worldMatrix: THREE.Matrix4;
}

interface ParsedSdfGraph {
  links: Record<string, UrdfLink>;
  joints: Record<string, UrdfJoint>;
  materials: Record<string, RobotMaterialState>;
  linkRecords: Map<string, ParsedSdfLinkRecord>;
  jointRecords: Map<string, ParsedSdfJointRecord>;
}

export interface ParseSDFOptions {
  allFileContents?: Record<string, string>;
  availableFiles?: readonly Pick<RobotFile, 'name'>[];
  sourcePath?: string | null;
  /** SDF spec version (e.g. "1.5", "1.6"). Affects axis-frame defaults. */
  sdfVersion?: string;
}

interface ParseSdfModelOptions extends ParseSDFOptions {
  parentMatrix?: THREE.Matrix4;
  namespacePrefix?: string;
  includeStack?: Set<string>;
  includeResolutionContext?: SdfIncludeResolutionContext;
  /** SDF spec version string (e.g. "1.5"). Affects axis-frame defaults. */
  sdfVersion?: string;
}

const AXIS_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const LIMIT_IMPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

function isElementNode(node: Node | null | undefined): node is Element {
  return !!node && node.nodeType === 1;
}

function normalizeSdfXmlForBrowserParser(xmlString: string): string {
  return xmlString
    .replace(XML_DECLARATION_PATTERN, '')
    .replace(XML_COMMENT_PATTERN, '')
    .replace(/<[^!?][^>]*>/g, (tag) => tag.replace(BARE_XML_ATTRIBUTE_PATTERN, '$1="$2"'))
    .trim();
}

function parseSdfXmlDocument(xmlString: string): Document | null {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(normalizeSdfXmlForBrowserParser(xmlString), 'text/xml');
  return xmlDoc.querySelector('parsererror') ? null : xmlDoc;
}

function getDirectChildElements(parent: Element, tagName?: string): Element[] {
  return Array.from(parent.childNodes)
    .filter(isElementNode)
    .filter((child) => !tagName || child.tagName === tagName);
}

function getFirstDirectChild(parent: Element, tagName: string): Element | null {
  return getDirectChildElements(parent, tagName)[0] ?? null;
}

function parseFloatSafe(value: string | null | undefined, fallback = 0): number {
  if (value == null) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseNumberTuple(text: string | null | undefined): number[] {
  return (text ?? '')
    .trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value))
    .filter((value) => Number.isFinite(value));
}

function parseVec3(text: string | null | undefined): Vector3 {
  const [x = 0, y = 0, z = 0] = parseNumberTuple(text);
  return { x, y, z };
}

function parseRPY(text: string | null | undefined): Euler {
  const [r = 0, p = 0, y = 0] = parseNumberTuple(text);
  return { r, p, y };
}

function parsePoseText(text: string | null | undefined): Pose {
  const [x = 0, y = 0, z = 0, r = 0, p = 0, yaw = 0] = parseNumberTuple(text);
  return {
    xyz: { x, y, z },
    rpy: { r, p, y: yaw },
  };
}

function parsePoseElement(parent: Element): ParsedPose {
  const poseEl = getFirstDirectChild(parent, 'pose');
  if (!poseEl) {
    return {
      pose: IDENTITY_POSE,
      relativeTo: null,
      specified: false,
    };
  }

  return {
    pose: parsePoseText(poseEl.textContent),
    relativeTo: poseEl.getAttribute('relative_to')?.trim() || null,
    specified: true,
  };
}

function poseToMatrix(pose: Pose): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3(pose.xyz.x, pose.xyz.y, pose.xyz.z);
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(pose.rpy.r, pose.rpy.p, pose.rpy.y, 'ZYX'),
  );
  matrix.compose(position, quaternion, IDENTITY_SCALE);
  return matrix;
}

function matrixToPose(matrix: THREE.Matrix4): Pose {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(quaternion);

  return {
    xyz: { x: position.x, y: position.y, z: position.z },
    rpy: { r: euler.x, p: euler.y, y: euler.z },
  };
}

function isIdentityPose(pose: Pose, epsilon = 1e-9): boolean {
  return (
    Math.abs(pose.xyz.x) <= epsilon &&
    Math.abs(pose.xyz.y) <= epsilon &&
    Math.abs(pose.xyz.z) <= epsilon &&
    Math.abs(pose.rpy.r) <= epsilon &&
    Math.abs(pose.rpy.p) <= epsilon &&
    Math.abs(pose.rpy.y) <= epsilon
  );
}

function rgbaTextToHex(text: string | null | undefined): string | undefined {
  const [r, g, b] = parseNumberTuple(text);
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return undefined;
  }

  const toByte = (value: number) => Math.max(0, Math.min(255, Math.round(value * 255)));
  return `#${[toByte(r), toByte(g), toByte(b)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

function parseSdfMaterial(
  visualEl: Element,
  { allFileContents = {}, sourcePath }: ParseSDFOptions = {},
): ParsedMaterialDefinition {
  const materialEl = getFirstDirectChild(visualEl, 'material');
  if (!materialEl) {
    return {};
  }

  const scriptEl = getFirstDirectChild(materialEl, 'script');
  const scriptName = getFirstDirectChild(scriptEl ?? materialEl, 'name')?.textContent?.trim() || '';
  const scriptUris = getDirectChildElements(scriptEl ?? materialEl, 'uri')
    .map((uriEl) => uriEl.textContent?.trim() || '')
    .filter(Boolean);
  const diffuse = rgbaTextToHex(getFirstDirectChild(materialEl, 'diffuse')?.textContent);
  const ambient = rgbaTextToHex(getFirstDirectChild(materialEl, 'ambient')?.textContent);
  if (scriptName && GAZEBO_COLORS[scriptName]) {
    return {
      color: GAZEBO_COLORS[scriptName],
      materialSource: 'gazebo',
      authoredMaterials: [{ name: scriptName, color: GAZEBO_COLORS[scriptName] }],
    };
  }

  if (scriptName) {
    const scriptMaterial = resolveGazeboScriptMaterial({
      allFileContents,
      scriptName,
      scriptUris,
      sourcePath: sourcePath ?? undefined,
    });
    if (scriptMaterial) {
      return {
        ...(scriptMaterial.color || diffuse || ambient
          ? { color: scriptMaterial.color || diffuse || ambient }
          : {}),
        ...(scriptMaterial.texture ? { texture: scriptMaterial.texture } : {}),
        materialSource: 'gazebo',
        authoredMaterials: [
          {
            ...scriptMaterial,
            ...(scriptMaterial.color || diffuse || ambient
              ? { color: scriptMaterial.color || diffuse || ambient }
              : {}),
          },
        ],
      };
    }
  }

  if (diffuse) {
    return {
      color: diffuse,
      materialSource: 'inline',
      authoredMaterials: [{ color: diffuse }],
    };
  }

  return ambient
    ? {
        color: ambient,
        materialSource: 'inline',
        authoredMaterials: [{ color: ambient }],
      }
    : {};
}

function hasParsedMaterialDefinition(definition: ParsedMaterialDefinition): boolean {
  return Boolean(
    definition.color || definition.texture || (definition.authoredMaterials?.length ?? 0) > 0,
  );
}

function parseObjMeshMaterialDefinition(
  geometry: ParsedSdfGeometry,
  { allFileContents = {}, availableFiles = [], sourcePath }: ParseSDFOptions = {},
): ParsedMaterialDefinition {
  if (
    geometry.type !== GeometryType.MESH ||
    !geometry.meshPath ||
    !geometry.meshPath.toLowerCase().endsWith('.obj')
  ) {
    return {};
  }

  const authoredMaterials = resolveObjAuthoredMaterialsFromAssets(
    sourcePath ? resolveImportedAssetPath(geometry.meshPath, sourcePath) : geometry.meshPath,
    allFileContents,
    [...Object.keys(allFileContents), ...availableFiles.map((file) => file.name)],
  );
  if (authoredMaterials.length === 0) {
    return {};
  }

  const primaryMaterial = authoredMaterials[0];
  return {
    ...(primaryMaterial?.color ? { color: primaryMaterial.color } : {}),
    ...(primaryMaterial?.texture ? { texture: primaryMaterial.texture } : {}),
    authoredMaterials,
  };
}

function parseSdfGeometry(
  geometryEl: Element | null,
  defaultGeometry: UrdfLink['visual'],
): ParsedSdfGeometry {
  if (!geometryEl) {
    return {
      type: defaultGeometry.type,
      dimensions: { ...defaultGeometry.dimensions },
      ...(defaultGeometry.meshPath ? { meshPath: defaultGeometry.meshPath } : {}),
    };
  }

  const boxEl = getFirstDirectChild(geometryEl, 'box');
  if (boxEl) {
    return {
      type: GeometryType.BOX,
      dimensions: parseVec3(getFirstDirectChild(boxEl, 'size')?.textContent),
    };
  }

  const cylinderEl = getFirstDirectChild(geometryEl, 'cylinder');
  if (cylinderEl) {
    return {
      type: GeometryType.CYLINDER,
      dimensions: {
        x: parseFloatSafe(getFirstDirectChild(cylinderEl, 'radius')?.textContent, 0.1),
        y: parseFloatSafe(getFirstDirectChild(cylinderEl, 'length')?.textContent, 0.5),
        z: 0,
      },
    };
  }

  const sphereEl = getFirstDirectChild(geometryEl, 'sphere');
  if (sphereEl) {
    return {
      type: GeometryType.SPHERE,
      dimensions: {
        x: parseFloatSafe(getFirstDirectChild(sphereEl, 'radius')?.textContent, 0.1),
        y: 0,
        z: 0,
      },
    };
  }

  const capsuleEl = getFirstDirectChild(geometryEl, 'capsule');
  if (capsuleEl) {
    return {
      type: GeometryType.CAPSULE,
      dimensions: {
        x: parseFloatSafe(getFirstDirectChild(capsuleEl, 'radius')?.textContent, 0.1),
        y: parseFloatSafe(getFirstDirectChild(capsuleEl, 'length')?.textContent, 0.5),
        z: 0,
      },
    };
  }

  const planeEl = getFirstDirectChild(geometryEl, 'plane');
  if (planeEl) {
    const size = parseVec3(getFirstDirectChild(planeEl, 'size')?.textContent);
    return {
      type: GeometryType.PLANE,
      dimensions: {
        x: size.x || 1,
        y: size.y || 1,
        z: 0,
      },
    };
  }

  const meshEl = getFirstDirectChild(geometryEl, 'mesh');
  if (meshEl) {
    const scale = parseVec3(getFirstDirectChild(meshEl, 'scale')?.textContent);
    const normalizedScale = isIdentityPose({ xyz: scale, rpy: ZERO_EULER })
      ? { x: 1, y: 1, z: 1 }
      : scale;

    const submeshEl = getFirstDirectChild(meshEl, 'submesh');
    const submeshName =
      getFirstDirectChild(submeshEl ?? meshEl, 'name')?.textContent?.trim() || undefined;
    const submeshCenterText = getFirstDirectChild(submeshEl ?? meshEl, 'center')
      ?.textContent?.trim()
      .toLowerCase();
    const submeshCenter = submeshCenterText === 'true';

    return {
      type: GeometryType.MESH,
      dimensions: normalizedScale,
      meshPath: getFirstDirectChild(meshEl, 'uri')?.textContent?.trim() || '',
      ...(submeshName ? { submeshName, submeshCenter } : {}),
    };
  }

  const heightmapEl = getFirstDirectChild(geometryEl, 'heightmap');
  if (heightmapEl) {
    const uri = getFirstDirectChild(heightmapEl, 'uri')?.textContent?.trim() || '';
    const size = parseVec3(getFirstDirectChild(heightmapEl, 'size')?.textContent);
    const pos = parseVec3(getFirstDirectChild(heightmapEl, 'pos')?.textContent);

    const textures = getDirectChildElements(heightmapEl, 'texture').map((texEl) => ({
      diffuse: getFirstDirectChild(texEl, 'diffuse')?.textContent?.trim() || undefined,
      normal: getFirstDirectChild(texEl, 'normal')?.textContent?.trim() || undefined,
      size: parseFloatSafe(getFirstDirectChild(texEl, 'size')?.textContent, 0) || undefined,
    }));

    const blends = getDirectChildElements(heightmapEl, 'blend').map((blendEl) => ({
      minHeight: parseFloatSafe(getFirstDirectChild(blendEl, 'min_height')?.textContent, 0) || 0,
      fadeDist: parseFloatSafe(getFirstDirectChild(blendEl, 'fade_dist')?.textContent, 0) || 0,
    }));

    return {
      type: GeometryType.HFIELD,
      dimensions: { x: size.x || 1, y: size.y || 1, z: size.z || 1 },
      meshPath: uri,
      sdfHeightmap: {
        uri,
        size: { x: size.x || 1, y: size.y || 1, z: size.z || 1 },
        pos,
        textures,
        blends,
      },
    };
  }

  const polylineEl = getFirstDirectChild(geometryEl, 'polyline');
  if (polylineEl) {
    const points = getDirectChildElements(polylineEl, 'point')
      .map((pointEl) => {
        const [x = 0, y = 0] = parseNumberTuple(pointEl.textContent);
        return { x, y };
      })
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const height = parseFloatSafe(getFirstDirectChild(polylineEl, 'height')?.textContent, 0);

    return {
      type: GeometryType.POLYLINE,
      dimensions: { x: 0, y: 0, z: 0 },
      polylinePoints: points,
      polylineHeight: height,
    };
  }

  return {
    type: GeometryType.NONE,
    dimensions: { x: 0, y: 0, z: 0 },
  };
}

function qualifyScopedName(name: string | null | undefined, namespacePrefix?: string): string {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return '';
  }

  return namespacePrefix ? `${namespacePrefix}::${normalizedName}` : normalizedName;
}

function qualifyScopedReference(name: string | null | undefined, namespacePrefix?: string): string {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    return '';
  }

  if (
    normalizedName === MODEL_FRAME ||
    normalizedName === WORLD_FRAME ||
    normalizedName.includes('::')
  ) {
    return normalizedName;
  }

  return qualifyScopedName(normalizedName, namespacePrefix);
}

function resolvePoseWorldMatrix(
  pose: ParsedPose,
  defaultFrame: string,
  resolveFrameWorldMatrix: (frame: string) => THREE.Matrix4,
): THREE.Matrix4 {
  const baseFrame = pose.relativeTo || defaultFrame;
  const baseMatrix = resolveFrameWorldMatrix(baseFrame);

  if (!pose.specified) {
    return baseMatrix.clone();
  }

  return baseMatrix.clone().multiply(poseToMatrix(pose.pose));
}

function resolvePoseRelativeToFrame(
  pose: ParsedPose,
  defaultFrame: string,
  targetFrame: string,
  resolveFrameWorldMatrix: (frame: string) => THREE.Matrix4,
): Pose {
  const targetMatrix = resolveFrameWorldMatrix(targetFrame);
  const worldMatrix = resolvePoseWorldMatrix(pose, defaultFrame, resolveFrameWorldMatrix);
  return matrixToPose(targetMatrix.clone().invert().multiply(worldMatrix));
}

function mapSdfJointType(rawType: string | null): JointType {
  switch ((rawType || '').trim().toLowerCase()) {
    case 'revolute':
      return JointType.REVOLUTE;
    case 'continuous':
      return JointType.CONTINUOUS;
    case 'prismatic':
      return JointType.PRISMATIC;
    case 'ball':
      return JointType.BALL;
    case 'planar':
      return JointType.PLANAR;
    case 'fixed':
    default:
      return JointType.FIXED;
  }
}

function createEmptyLink(id: string, name = id): UrdfLink {
  return {
    ...DEFAULT_LINK,
    id,
    name,
    visible: true,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: IDENTITY_POSE,
    },
    visualBodies: [],
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
      origin: IDENTITY_POSE,
    },
    collisionBodies: [],
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
      origin: IDENTITY_POSE,
    },
  };
}

function deriveSdfFallbackName(sourcePath?: string | null): string {
  const normalized = String(sourcePath || '')
    .trim()
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.[^.]+$/, '');
  return normalized || 'imported_sdf_model';
}

function sanitizeSdfSyntheticId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'imported_sdf_model';
  }

  return trimmed.replace(/[^A-Za-z0-9_.:-]+/g, '_');
}

function createPlaceholderRobotFromLight(
  lightEl: Element,
  { sourcePath }: ParseSDFOptions = {},
): RobotState {
  const lightName = lightEl.getAttribute('name')?.trim() || deriveSdfFallbackName(sourcePath);
  const rootLinkId = `${sanitizeSdfSyntheticId(lightName)}__light_anchor`;

  return {
    name: lightName,
    links: {
      [rootLinkId]: createEmptyLink(rootLinkId, lightName),
    },
    joints: {},
    rootLinkId,
    selection: { type: 'link', id: rootLinkId },
  };
}

function createFixedJoint(
  id: string,
  parentLinkId: string,
  childLinkId: string,
  origin: Pose,
): UrdfJoint {
  return {
    ...DEFAULT_JOINT,
    id,
    name: id,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId,
    origin,
    axis: undefined,
    limit: undefined,
    dynamics: { damping: 0, friction: 0 },
    hardware: {
      armature: 0,
      brand: '',
      motorType: 'None',
      motorId: '',
      motorDirection: 1,
    },
  };
}

class LinkDisjointSet {
  private readonly parent = new Map<string, string>();

  constructor(linkIds: Iterable<string>) {
    for (const linkId of linkIds) {
      this.parent.set(linkId, linkId);
    }
  }

  find(linkId: string): string {
    const directParent = this.parent.get(linkId);
    if (!directParent || directParent === linkId) {
      return linkId;
    }

    const root = this.find(directParent);
    this.parent.set(linkId, root);
    return root;
  }

  union(linkAId: string, linkBId: string): void {
    const rootA = this.find(linkAId);
    const rootB = this.find(linkBId);
    if (rootA !== rootB) {
      this.parent.set(rootA, rootB);
    }
  }
}

function buildSyntheticJointStageName(linkId: string, stageIndex: number): string {
  return `${linkId}__joint_stage_${stageIndex}`;
}

function extractTranslation(matrix: THREE.Matrix4): Vector3 {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { x: position.x, y: position.y, z: position.z };
}

function buildClosedLoopConstraintFromSdfJoint(
  jointId: string,
  joint: UrdfJoint,
  graph: ParsedSdfGraph,
): RobotClosedLoopConstraint | null {
  if (joint.type !== JointType.BALL || !joint.parentLinkId || !joint.childLinkId) {
    return null;
  }

  const parentWorldMatrix = graph.linkRecords.get(joint.parentLinkId)?.worldMatrix;
  const childWorldMatrix = graph.linkRecords.get(joint.childLinkId)?.worldMatrix;
  if (!parentWorldMatrix || !childWorldMatrix) {
    return null;
  }

  const jointWorldMatrix =
    graph.jointRecords.get(jointId)?.worldMatrix ??
    parentWorldMatrix.clone().multiply(poseToMatrix(joint.origin));

  return {
    id: jointId,
    type: 'connect',
    linkAId: joint.parentLinkId,
    linkBId: joint.childLinkId,
    anchorWorld: extractTranslation(jointWorldMatrix),
    anchorLocalA: extractTranslation(
      parentWorldMatrix.clone().invert().multiply(jointWorldMatrix.clone()),
    ),
    anchorLocalB: extractTranslation(
      childWorldMatrix.clone().invert().multiply(jointWorldMatrix.clone()),
    ),
  };
}

function collectSelectedChildLinkIds(joints: Record<string, UrdfJoint>): Set<string> {
  return new Set(Object.values(joints).map((joint) => joint.childLinkId));
}

function collectSelectedParentJointByChild(
  joints: Record<string, UrdfJoint>,
): Map<string, UrdfJoint> {
  const parentJointByChild = new Map<string, UrdfJoint>();
  Object.values(joints).forEach((joint) => {
    parentJointByChild.set(joint.childLinkId, joint);
  });
  return parentJointByChild;
}

function collectSelectedChildJointsByParent(
  joints: Record<string, UrdfJoint>,
): Map<string, UrdfJoint[]> {
  const childJointsByParent = new Map<string, UrdfJoint[]>();
  Object.values(joints).forEach((joint) => {
    const childJoints = childJointsByParent.get(joint.parentLinkId) ?? [];
    childJoints.push(joint);
    childJointsByParent.set(joint.parentLinkId, childJoints);
  });
  return childJointsByParent;
}

function findSelectedTreeRootLinkId(
  linkId: string,
  parentJointByChild: Map<string, UrdfJoint>,
): string {
  const visitedLinkIds = new Set<string>();
  let currentLinkId = linkId;

  while (!visitedLinkIds.has(currentLinkId)) {
    visitedLinkIds.add(currentLinkId);
    const parentJoint = parentJointByChild.get(currentLinkId);
    if (!parentJoint?.parentLinkId) {
      return currentLinkId;
    }
    currentLinkId = parentJoint.parentLinkId;
  }

  return currentLinkId;
}

function collectSelectedReachableLinkIds(
  rootLinkId: string,
  childJointsByParent: Map<string, UrdfJoint[]>,
): Set<string> {
  const reachableLinkIds = new Set<string>();
  const queue = [rootLinkId];

  while (queue.length > 0) {
    const linkId = queue.shift();
    if (!linkId || reachableLinkIds.has(linkId)) {
      continue;
    }

    reachableLinkIds.add(linkId);
    (childJointsByParent.get(linkId) ?? []).forEach((joint) => {
      queue.push(joint.childLinkId);
    });
  }

  return reachableLinkIds;
}

function buildSdfTreeAttachmentJointId(
  sourceJointId: string,
  orphanRootLinkId: string,
  selectedJoints: Record<string, UrdfJoint>,
  graph: ParsedSdfGraph,
): string {
  let index = 0;
  let candidateId = `${sourceJointId}__${orphanRootLinkId}__tree_attachment_fixed`;

  while (selectedJoints[candidateId] || graph.joints[candidateId]) {
    index += 1;
    candidateId = `${sourceJointId}__${orphanRootLinkId}__tree_attachment_${index}_fixed`;
  }

  return candidateId;
}

function createSdfTreeAttachmentJoint(
  sourceJointId: string,
  connectedLinkId: string,
  orphanRootLinkId: string,
  selectedJoints: Record<string, UrdfJoint>,
  graph: ParsedSdfGraph,
): UrdfJoint | null {
  const connectedWorldMatrix = graph.linkRecords.get(connectedLinkId)?.worldMatrix;
  const orphanRootWorldMatrix = graph.linkRecords.get(orphanRootLinkId)?.worldMatrix;
  if (!connectedWorldMatrix || !orphanRootWorldMatrix) {
    return null;
  }

  return createFixedJoint(
    buildSdfTreeAttachmentJointId(sourceJointId, orphanRootLinkId, selectedJoints, graph),
    connectedLinkId,
    orphanRootLinkId,
    matrixToPose(connectedWorldMatrix.clone().invert().multiply(orphanRootWorldMatrix)),
  );
}

function attachSkippedSdfRootComponents(
  graph: ParsedSdfGraph,
  selectedJoints: Record<string, UrdfJoint>,
  skippedJointIds: string[],
): void {
  let attachedInPreviousPass = true;

  while (attachedInPreviousPass) {
    attachedInPreviousPass = false;

    const childLinkIds = collectSelectedChildLinkIds(selectedJoints);
    const rootLinkIds = Object.keys(graph.links).filter((linkId) => !childLinkIds.has(linkId));
    if (rootLinkIds.length <= 1) {
      return;
    }

    const primaryRootLinkId = rootLinkIds[0];
    const parentJointByChild = collectSelectedParentJointByChild(selectedJoints);
    const childJointsByParent = collectSelectedChildJointsByParent(selectedJoints);
    const reachableLinkIds = collectSelectedReachableLinkIds(
      primaryRootLinkId,
      childJointsByParent,
    );

    for (const orphanRootLinkId of rootLinkIds.slice(1)) {
      let attachmentJoint: UrdfJoint | null = null;

      for (const skippedJointId of skippedJointIds) {
        const skippedJoint = graph.joints[skippedJointId];
        if (!skippedJoint?.parentLinkId || !skippedJoint.childLinkId) {
          continue;
        }

        const parentRootLinkId = findSelectedTreeRootLinkId(
          skippedJoint.parentLinkId,
          parentJointByChild,
        );
        const childRootLinkId = findSelectedTreeRootLinkId(
          skippedJoint.childLinkId,
          parentJointByChild,
        );

        if (
          reachableLinkIds.has(skippedJoint.parentLinkId) &&
          childRootLinkId === orphanRootLinkId
        ) {
          attachmentJoint = createSdfTreeAttachmentJoint(
            skippedJointId,
            skippedJoint.parentLinkId,
            orphanRootLinkId,
            selectedJoints,
            graph,
          );
        } else if (
          reachableLinkIds.has(skippedJoint.childLinkId) &&
          parentRootLinkId === orphanRootLinkId
        ) {
          attachmentJoint = createSdfTreeAttachmentJoint(
            skippedJointId,
            skippedJoint.childLinkId,
            orphanRootLinkId,
            selectedJoints,
            graph,
          );
        }

        if (attachmentJoint) {
          selectedJoints[attachmentJoint.id] = attachmentJoint;
          attachedInPreviousPass = true;
          break;
        }
      }
    }
  }
}

function parseJointMimic(
  axisEl: Element | null | undefined,
  namespacePrefix?: string,
): UrdfJoint['mimic'] | undefined {
  if (!axisEl) {
    return undefined;
  }

  const mimicEl = getFirstDirectChild(axisEl, 'mimic');
  if (!mimicEl) {
    return undefined;
  }

  const leaderAxis = mimicEl.getAttribute('axis')?.trim() || 'axis';
  if (leaderAxis !== 'axis') {
    return undefined;
  }

  const joint = qualifyScopedReference(mimicEl.getAttribute('joint'), namespacePrefix);
  if (!joint) {
    return undefined;
  }

  const multiplier = parseFloatSafe(getFirstDirectChild(mimicEl, 'multiplier')?.textContent, 1);
  const offset = parseFloatSafe(getFirstDirectChild(mimicEl, 'offset')?.textContent, 0);
  const reference = parseFloatSafe(getFirstDirectChild(mimicEl, 'reference')?.textContent, 0);

  return {
    joint,
    multiplier,
    offset: offset - multiplier * reference,
  };
}

function selectTreeJointsAndClosedLoops(graph: ParsedSdfGraph): {
  joints: Record<string, UrdfJoint>;
  closedLoopConstraints?: RobotClosedLoopConstraint[];
} {
  const selectedJoints: Record<string, UrdfJoint> = {};
  const closedLoopConstraints: RobotClosedLoopConstraint[] = [];
  const skippedJointIds: string[] = [];
  const childLinkIds = new Set<string>();
  const disjointSet = new LinkDisjointSet(Object.keys(graph.links));

  Object.entries(graph.joints).forEach(([jointId, joint]) => {
    const parentLinkId = joint.parentLinkId;
    const childLinkId = joint.childLinkId;

    if (!graph.links[childLinkId]) {
      return;
    }

    if (!parentLinkId || !graph.links[parentLinkId]) {
      selectedJoints[jointId] = joint;
      childLinkIds.add(childLinkId);
      return;
    }

    const childAlreadyAssigned = childLinkIds.has(childLinkId);
    const introducesCycle = disjointSet.find(parentLinkId) === disjointSet.find(childLinkId);

    if (!childAlreadyAssigned && !introducesCycle) {
      selectedJoints[jointId] = joint;
      childLinkIds.add(childLinkId);
      disjointSet.union(parentLinkId, childLinkId);
      return;
    }

    skippedJointIds.push(jointId);
    const closedLoopConstraint = buildClosedLoopConstraintFromSdfJoint(jointId, joint, graph);
    if (closedLoopConstraint) {
      closedLoopConstraints.push(closedLoopConstraint);
    }
  });

  attachSkippedSdfRootComponents(graph, selectedJoints, skippedJointIds);

  return {
    joints: selectedJoints,
    ...(closedLoopConstraints.length > 0 ? { closedLoopConstraints } : {}),
  };
}

function applyVisualToLink(link: UrdfLink, visual: ParsedSdfVisual): UrdfLink {
  return {
    ...link,
    visual: {
      ...DEFAULT_LINK.visual,
      ...visual.geometry,
      origin: visual.pose,
      color: visual.color,
      materialSource: visual.materialSource,
      authoredMaterials: visual.authoredMaterials,
    },
  };
}

function applyCollisionToLink(link: UrdfLink, collision: ParsedSdfCollision): UrdfLink {
  return {
    ...link,
    collision: {
      ...DEFAULT_LINK.collision,
      ...collision.geometry,
      origin: collision.pose,
    },
  };
}

function parseLinkInertial(
  linkEl: Element,
  linkId: string,
  resolveFrameWorldMatrix: (frame: string) => THREE.Matrix4,
): UrdfLink['inertial'] | undefined {
  const inertialEl = getFirstDirectChild(linkEl, 'inertial');
  if (!inertialEl) {
    return undefined;
  }

  const inertiaEl = getFirstDirectChild(inertialEl, 'inertia');
  const inertialPose = resolvePoseRelativeToFrame(
    parsePoseElement(inertialEl),
    linkId,
    linkId,
    resolveFrameWorldMatrix,
  );
  return {
    mass: parseFloatSafe(getFirstDirectChild(inertialEl, 'mass')?.textContent, 0),
    origin: inertialPose,
    inertia: {
      ixx: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'ixx')?.textContent, 0),
      ixy: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'ixy')?.textContent, 0),
      ixz: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'ixz')?.textContent, 0),
      iyy: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'iyy')?.textContent, 0),
      iyz: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'iyz')?.textContent, 0),
      izz: parseFloatSafe(getFirstDirectChild(inertiaEl ?? inertialEl, 'izz')?.textContent, 0),
    },
  };
}

function mergeParsedSdfGraph(target: ParsedSdfGraph, source: ParsedSdfGraph): void {
  Object.assign(target.links, source.links);
  Object.assign(target.joints, source.joints);
  Object.assign(target.materials, source.materials);
  source.linkRecords.forEach((record, linkId) => {
    target.linkRecords.set(linkId, record);
  });
  source.jointRecords.forEach((record, jointId) => {
    target.jointRecords.set(jointId, record);
  });
}

function parseIncludedModelGraph(
  includeEl: Element,
  parentGraph: ParsedSdfGraph,
  {
    allFileContents = {},
    availableFiles = [],
    sourcePath,
    parentMatrix = new THREE.Matrix4().identity(),
    namespacePrefix,
    includeStack = new Set<string>(),
    includeResolutionContext = createSdfIncludeResolutionContext(allFileContents),
  }: ParseSdfModelOptions,
): void {
  const includeUri = getFirstDirectChild(includeEl, 'uri')?.textContent?.trim() || '';
  if (!includeUri) {
    return;
  }

  const resolvedInclude = includeResolutionContext.resolve(includeUri, sourcePath);
  if (!resolvedInclude || includeStack.has(resolvedInclude.path)) {
    return;
  }

  const includeDoc = parseSdfXmlDocument(resolvedInclude.content);
  if (!includeDoc) {
    return;
  }

  const includeModelEl = includeDoc.querySelector('sdf > model, model');
  if (!includeModelEl) {
    return;
  }

  const includeName =
    getFirstDirectChild(includeEl, 'name')?.textContent?.trim() ||
    includeModelEl.getAttribute('name')?.trim() ||
    resolvedInclude.path.split('/').slice(-2, -1)[0] ||
    'included_model';

  const includePose = parsePoseElement(includeEl);
  const nextIncludeStack = new Set(includeStack);
  nextIncludeStack.add(resolvedInclude.path);

  const includeGraph = parseSdfModel(includeModelEl, {
    allFileContents,
    availableFiles,
    sourcePath: resolvedInclude.path,
    parentMatrix: parentMatrix.clone().multiply(poseToMatrix(includePose.pose)),
    namespacePrefix: qualifyScopedName(includeName, namespacePrefix),
    includeStack: nextIncludeStack,
    includeResolutionContext,
  });

  if (includeGraph) {
    mergeParsedSdfGraph(parentGraph, includeGraph);
  }
}

function parseNestedModelGraph(
  nestedModelEl: Element,
  parentGraph: ParsedSdfGraph,
  {
    allFileContents = {},
    availableFiles = [],
    sourcePath,
    parentMatrix = new THREE.Matrix4().identity(),
    namespacePrefix,
    includeStack = new Set<string>(),
    includeResolutionContext = createSdfIncludeResolutionContext(allFileContents),
    sdfVersion,
  }: ParseSdfModelOptions,
): void {
  const nestedModelName = nestedModelEl.getAttribute('name')?.trim() || 'nested_model';
  const nestedModelPose = parsePoseElement(nestedModelEl);
  const nestedModelMatrix = parentMatrix.clone().multiply(poseToMatrix(nestedModelPose.pose));
  const nestedNamespacePrefix = qualifyScopedName(nestedModelName, namespacePrefix);
  const nestedGraph = parseSdfModel(nestedModelEl, {
    allFileContents,
    availableFiles,
    sourcePath,
    parentMatrix: nestedModelMatrix,
    namespacePrefix: nestedNamespacePrefix,
    includeStack,
    includeResolutionContext,
    sdfVersion,
  });

  if (nestedGraph) {
    mergeParsedSdfGraph(parentGraph, nestedGraph);
  }
}

function parseSdfModel(
  modelEl: Element,
  {
    allFileContents = {},
    availableFiles = [],
    sourcePath,
    parentMatrix = new THREE.Matrix4().identity(),
    namespacePrefix,
    includeStack = new Set<string>(),
    includeResolutionContext = createSdfIncludeResolutionContext(allFileContents),
    sdfVersion,
  }: ParseSdfModelOptions = {},
): ParsedSdfGraph | null {
  const modelPose = parsePoseElement(modelEl);
  const modelMatrix = parentMatrix.clone().multiply(poseToMatrix(modelPose.pose));
  const graph: ParsedSdfGraph = {
    links: {},
    joints: {},
    materials: {},
    linkRecords: new Map<string, ParsedSdfLinkRecord>(),
    jointRecords: new Map<string, ParsedSdfJointRecord>(),
  };

  const linkElements = new Map<string, Element>();
  const jointElements = new Map<string, Element>();
  const frameElements = new Map<string, Element>();

  for (const linkEl of getDirectChildElements(modelEl, 'link')) {
    const linkId = qualifyScopedName(linkEl.getAttribute('name')?.trim(), namespacePrefix);
    if (linkId) {
      linkElements.set(linkId, linkEl);
    }
  }

  for (const jointEl of getDirectChildElements(modelEl, 'joint')) {
    const jointId = qualifyScopedName(jointEl.getAttribute('name')?.trim(), namespacePrefix);
    if (jointId) {
      jointElements.set(jointId, jointEl);
    }
  }

  for (const frameEl of getDirectChildElements(modelEl, 'frame')) {
    const frameId = qualifyScopedName(frameEl.getAttribute('name')?.trim(), namespacePrefix);
    if (frameId) {
      frameElements.set(frameId, frameEl);
    }
  }

  const resolvedFrameCache = new Map<string, THREE.Matrix4>();
  const resolvingFrames = new Set<string>();
  resolvedFrameCache.set(MODEL_FRAME, modelMatrix);
  resolvedFrameCache.set(WORLD_FRAME, new THREE.Matrix4().identity());

  const resolveFrameWorldMatrix = (frame: string): THREE.Matrix4 => {
    const normalizedFrame = frame || MODEL_FRAME;
    const cachedFrame = resolvedFrameCache.get(normalizedFrame);
    if (cachedFrame) {
      return cachedFrame;
    }

    const knownLinkRecord = graph.linkRecords.get(normalizedFrame);
    if (knownLinkRecord) {
      return knownLinkRecord.worldMatrix;
    }

    if (resolvingFrames.has(normalizedFrame)) {
      throw new Error(`SDF frame resolution cycle detected at ${normalizedFrame}`);
    }

    resolvingFrames.add(normalizedFrame);

    let resolvedFrame: THREE.Matrix4 | null = null;

    const linkEl = linkElements.get(normalizedFrame);
    if (linkEl) {
      resolvedFrame = resolvePoseWorldMatrix(
        parsePoseElement(linkEl),
        MODEL_FRAME,
        resolveFrameWorldMatrix,
      );
    }

    if (!resolvedFrame) {
      const jointEl = jointElements.get(normalizedFrame);
      if (jointEl) {
        const childLinkId =
          qualifyScopedReference(
            getFirstDirectChild(jointEl, 'child')?.textContent?.trim(),
            namespacePrefix,
          ) || MODEL_FRAME;
        resolvedFrame = resolvePoseWorldMatrix(
          parsePoseElement(jointEl),
          childLinkId,
          resolveFrameWorldMatrix,
        );
      }
    }

    if (!resolvedFrame) {
      const frameEl = frameElements.get(normalizedFrame);
      if (frameEl) {
        const attachedTo =
          qualifyScopedReference(frameEl.getAttribute('attached_to')?.trim(), namespacePrefix) ||
          MODEL_FRAME;
        resolvedFrame = resolvePoseWorldMatrix(
          parsePoseElement(frameEl),
          attachedTo,
          resolveFrameWorldMatrix,
        );
      }
    }

    resolvingFrames.delete(normalizedFrame);

    if (!resolvedFrame) {
      throw new Error(`Unknown SDF frame reference: ${normalizedFrame}`);
    }

    resolvedFrameCache.set(normalizedFrame, resolvedFrame);
    return resolvedFrame;
  };

  for (const linkEl of getDirectChildElements(modelEl, 'link')) {
    const linkName = linkEl.getAttribute('name')?.trim();
    const linkId = qualifyScopedName(linkName, namespacePrefix);
    if (!linkId) {
      continue;
    }

    const baseLink = createEmptyLink(linkId, linkId);
    const linkPose = parsePoseElement(linkEl);
    const linkWorldMatrix = resolveFrameWorldMatrix(linkId);

    const visuals = getDirectChildElements(linkEl, 'visual').map(
      (visualEl, index): ParsedSdfVisual => {
        const geometry = parseSdfGeometry(
          getFirstDirectChild(visualEl, 'geometry'),
          DEFAULT_LINK.visual,
        );
        const explicitMaterial = parseSdfMaterial(visualEl, {
          allFileContents,
          availableFiles,
          sourcePath,
        });
        const meshMaterial = hasParsedMaterialDefinition(explicitMaterial)
          ? {}
          : parseObjMeshMaterialDefinition(geometry, {
              allFileContents,
              availableFiles,
              sourcePath,
            });

        const heightmapTextures = geometry.sdfHeightmap?.textures;
        const heightmapMaterial =
          heightmapTextures && heightmapTextures.length === 1 && heightmapTextures[0].diffuse
            ? { texture: heightmapTextures[0].diffuse }
            : {};

        // OGRE/Gazebo box UV convention differs from Three.js BoxGeometry by a
        // 90° rotation on the major faces. When a Gazebo material with a texture
        // is applied to a box primitive, rotate the texture to match the expected
        // orientation.
        const needsBoxTextureRotation =
          geometry.type === GeometryType.BOX &&
          explicitMaterial.materialSource === 'gazebo' &&
          explicitMaterial.authoredMaterials?.some((m) => m.texture);

        const authoredMaterials = needsBoxTextureRotation
          ? explicitMaterial.authoredMaterials?.map((m) =>
              m.texture ? { ...m, textureRotation: -Math.PI / 2 } : m,
            )
          : explicitMaterial.authoredMaterials;

        return {
          name: visualEl.getAttribute('name')?.trim() || `${linkId}_visual_${index}`,
          geometry,
          pose: resolvePoseRelativeToFrame(
            parsePoseElement(visualEl),
            linkId,
            linkId,
            resolveFrameWorldMatrix,
          ),
          ...heightmapMaterial,
          ...meshMaterial,
          ...explicitMaterial,
          ...(authoredMaterials ? { authoredMaterials } : {}),
        };
      },
    );

    const collisions = getDirectChildElements(linkEl, 'collision').map(
      (collisionEl): ParsedSdfCollision => ({
        geometry: parseSdfGeometry(
          getFirstDirectChild(collisionEl, 'geometry'),
          DEFAULT_LINK.collision,
        ),
        pose: resolvePoseRelativeToFrame(
          parsePoseElement(collisionEl),
          linkId,
          linkId,
          resolveFrameWorldMatrix,
        ),
      }),
    );

    const inertial = parseLinkInertial(linkEl, linkId, resolveFrameWorldMatrix);
    let nextLink: UrdfLink = {
      ...baseLink,
      ...(inertial ? { inertial } : {}),
    };

    if (visuals[0]) {
      nextLink = applyVisualToLink(nextLink, visuals[0]);
      nextLink.visualBodies = visuals.slice(1).map((visual) => ({
        ...DEFAULT_LINK.visual,
        ...visual.geometry,
        origin: visual.pose,
        color: visual.color,
        materialSource: visual.materialSource,
        authoredMaterials: visual.authoredMaterials,
      }));
      if (visuals[0].color || visuals[0].texture) {
        graph.materials[linkId] = {
          ...(visuals[0].color ? { color: visuals[0].color } : {}),
          ...(visuals[0].texture ? { texture: visuals[0].texture } : {}),
        };
      }
    }

    if (collisions[0]) {
      nextLink = applyCollisionToLink(nextLink, collisions[0]);
      nextLink.collisionBodies = collisions.slice(1).map((collision) => ({
        ...DEFAULT_LINK.collision,
        ...collision.geometry,
        origin: collision.pose,
      }));
    }

    graph.links[linkId] = nextLink;
    graph.linkRecords.set(linkId, {
      parsedPose: linkPose,
      pose: linkPose.pose,
      worldMatrix: linkWorldMatrix,
    });
  }

  for (const includeEl of getDirectChildElements(modelEl, 'include')) {
    parseIncludedModelGraph(includeEl, graph, {
      allFileContents,
      availableFiles,
      sourcePath,
      parentMatrix: modelMatrix,
      namespacePrefix,
      includeStack,
      includeResolutionContext,
    });
  }

  for (const nestedModelEl of getDirectChildElements(modelEl, 'model')) {
    parseNestedModelGraph(nestedModelEl, graph, {
      allFileContents,
      availableFiles,
      sourcePath,
      parentMatrix: modelMatrix,
      namespacePrefix,
      includeStack,
      includeResolutionContext,
      sdfVersion,
    });
  }

  for (const jointEl of getDirectChildElements(modelEl, 'joint')) {
    const jointName = jointEl.getAttribute('name')?.trim();
    const jointId = qualifyScopedName(jointName, namespacePrefix);
    if (!jointId) {
      continue;
    }

    const childLinkId = qualifyScopedName(
      getFirstDirectChild(jointEl, 'child')?.textContent?.trim(),
      namespacePrefix,
    );
    const parentLinkId = qualifyScopedName(
      getFirstDirectChild(jointEl, 'parent')?.textContent?.trim(),
      namespacePrefix,
    );
    if (!childLinkId || !graph.links[childLinkId]) {
      continue;
    }
    if (parentLinkId && !graph.links[parentLinkId]) {
      continue;
    }

    const childRecord = graph.linkRecords.get(childLinkId);
    if (!childRecord) {
      continue;
    }

    const jointWorldMatrix = resolveFrameWorldMatrix(jointId);
    const parentWorldMatrix = parentLinkId
      ? (graph.linkRecords.get(parentLinkId)?.worldMatrix ?? resolveFrameWorldMatrix(parentLinkId))
      : new THREE.Matrix4().identity();
    const relativeMatrix = parentWorldMatrix.clone().invert().multiply(jointWorldMatrix);
    const origin = matrixToPose(relativeMatrix);

    const jointType = mapSdfJointType(jointEl.getAttribute('type'));
    const axisEl = getFirstDirectChild(jointEl, 'axis');
    const limitEl = getFirstDirectChild(axisEl ?? jointEl, 'limit');
    const dynamicsEl = getFirstDirectChild(axisEl ?? jointEl, 'dynamics');
    const mimic = parseJointMimic(axisEl, namespacePrefix);

    // Resolve the axis direction.
    // SDF <use_parent_model_frame> determines whether the xyz vector is
    // expressed in the model frame (true) or the joint frame (false).
    // Per the SDF 1.5 spec the default is false (joint frame); models
    // authored for Gazebo (e.g. cart_soft_suspension) rely on this default.
    // Our internal representation (like URDF) stores the axis in the joint
    // frame, so we must transform when the source is the model frame.
    let axis: Vector3 | undefined;
    if (AXIS_IMPORT_TYPES.has(jointType)) {
      const rawAxis = parseVec3(
        getFirstDirectChild(axisEl ?? jointEl, 'xyz')?.textContent || '0 0 1',
      );
      const useParentModelFrameText = axisEl
        ? getFirstDirectChild(axisEl, 'use_parent_model_frame')?.textContent?.trim().toLowerCase()
        : undefined;
      const useParentModelFrame =
        useParentModelFrameText !== undefined ? useParentModelFrameText === 'true' : false; // SDF spec: use_parent_model_frame defaults to false

      if (useParentModelFrame) {
        // Transform axis from model frame to joint frame:
        // axis_joint = R(jointWorld)^-1 · axis_model
        const jointRotation = new THREE.Quaternion();
        jointWorldMatrix.decompose(new THREE.Vector3(), jointRotation, new THREE.Vector3());
        const axisVec = new THREE.Vector3(rawAxis.x, rawAxis.y, rawAxis.z);
        axisVec.applyQuaternion(jointRotation.invert());
        axis = { x: axisVec.x, y: axisVec.y, z: axisVec.z };
      } else {
        axis = rawAxis;
      }
    }

    const joint: UrdfJoint = {
      ...DEFAULT_JOINT,
      id: jointId,
      name: jointId,
      type: jointType,
      parentLinkId,
      childLinkId,
      origin,
      axis,
      limit: LIMIT_IMPORT_TYPES.has(jointType)
        ? {
            lower: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'lower')?.textContent,
              -Infinity,
            ),
            upper: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'upper')?.textContent,
              Infinity,
            ),
            effort: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'effort')?.textContent,
              0,
            ),
            velocity: parseFloatSafe(
              getFirstDirectChild(limitEl ?? jointEl, 'velocity')?.textContent,
              0,
            ),
          }
        : undefined,
      dynamics: {
        damping: parseFloatSafe(
          getFirstDirectChild(dynamicsEl ?? jointEl, 'damping')?.textContent,
          0,
        ),
        friction: parseFloatSafe(
          getFirstDirectChild(dynamicsEl ?? jointEl, 'friction')?.textContent,
          0,
        ),
      },
      hardware: {
        armature: 0,
        brand: '',
        motorType: 'None',
        motorId: '',
        motorDirection: 1,
      },
      mimic,
    };
    graph.joints[jointId] = joint;

    // When the joint has a non-identity <pose>, the joint frame is offset from
    // the child link frame.  In URDF the child link is placed at the joint
    // frame, but in SDF the link visuals/collisions are authored relative to
    // the link frame.  To compensate, bake the inverse joint-pose into the
    // child link's geometry origins so they render at the correct SDF link
    // position even though the link Object3D sits at the joint frame.
    const jointParsedPose = parsePoseElement(jointEl);
    if (jointParsedPose.specified && !isIdentityPose(jointParsedPose.pose)) {
      const inverseJointPose = poseToMatrix(jointParsedPose.pose).invert();
      const childLink = graph.links[childLinkId];
      if (childLink) {
        const applyOffset = (origin: Pose): Pose =>
          matrixToPose(inverseJointPose.clone().multiply(poseToMatrix(origin)));
        childLink.visual = { ...childLink.visual, origin: applyOffset(childLink.visual.origin) };
        childLink.collision = {
          ...childLink.collision,
          origin: applyOffset(childLink.collision.origin),
        };
        if (childLink.visualBodies) {
          childLink.visualBodies = childLink.visualBodies.map((v) => ({
            ...v,
            origin: applyOffset(v.origin),
          }));
        }
        if (childLink.collisionBodies) {
          childLink.collisionBodies = childLink.collisionBodies.map((c) => ({
            ...c,
            origin: applyOffset(c.origin),
          }));
        }
      }
    }

    graph.jointRecords.set(jointId, {
      joint,
      worldMatrix: jointWorldMatrix.clone(),
    });
  }

  const incomingJointIdsByChild = new Map<string, string[]>();
  Object.values(graph.joints).forEach((joint) => {
    const incomingJointIds = incomingJointIdsByChild.get(joint.childLinkId) ?? [];
    incomingJointIds.push(joint.id);
    incomingJointIdsByChild.set(joint.childLinkId, incomingJointIds);
  });

  graph.linkRecords.forEach((record, linkId) => {
    if (!record.parsedPose.specified || isIdentityPose(record.parsedPose.pose)) {
      return;
    }

    const relativeJointId = qualifyScopedReference(record.parsedPose.relativeTo, namespacePrefix);
    if (!relativeJointId) {
      return;
    }

    const incomingJointIds = incomingJointIdsByChild.get(linkId) ?? [];
    if (incomingJointIds.length !== 1 || incomingJointIds[0] !== relativeJointId) {
      return;
    }

    const incomingJoint = graph.joints[relativeJointId];
    if (!incomingJoint) {
      return;
    }

    let stageIndex = 0;
    let stageLinkId = buildSyntheticJointStageName(linkId, stageIndex);
    while (graph.links[stageLinkId] || graph.joints[`${stageLinkId}_fixed`]) {
      stageIndex += 1;
      stageLinkId = buildSyntheticJointStageName(linkId, stageIndex);
    }

    const stageJointId = `${stageLinkId}_fixed`;
    const jointWorldMatrix = resolveFrameWorldMatrix(relativeJointId);

    graph.links[stageLinkId] = createEmptyLink(stageLinkId, stageLinkId);
    graph.linkRecords.set(stageLinkId, {
      parsedPose: {
        pose: IDENTITY_POSE,
        relativeTo: relativeJointId,
        specified: false,
      },
      pose: IDENTITY_POSE,
      worldMatrix: jointWorldMatrix,
    });

    incomingJoint.childLinkId = stageLinkId;
    const stageJoint = createFixedJoint(stageJointId, stageLinkId, linkId, record.parsedPose.pose);
    graph.joints[stageJointId] = stageJoint;
    graph.jointRecords.set(stageJointId, {
      joint: stageJoint,
      worldMatrix: jointWorldMatrix.clone().multiply(poseToMatrix(record.parsedPose.pose)),
    });
  });

  return Object.keys(graph.links).length > 0 ? graph : null;
}

export function isSDF(content: string): boolean {
  return /<sdf\b/i.test(content) && /<model\b/i.test(content);
}

export function parseSDF(xmlString: string, options: ParseSDFOptions = {}): RobotState | null {
  const xmlDoc = parseSdfXmlDocument(xmlString);
  if (!xmlDoc) {
    return null;
  }

  const modelEl = xmlDoc.querySelector('sdf > model, model');
  if (!modelEl) {
    const lightEl = xmlDoc.querySelector('sdf > light, light');
    return lightEl ? createPlaceholderRobotFromLight(lightEl, options) : null;
  }

  const sdfEl = xmlDoc.querySelector('sdf');
  const sdfVersion = sdfEl?.getAttribute('version') || undefined;

  const modelName = modelEl.getAttribute('name')?.trim() || 'imported_sdf_model';
  const includeResolutionContext = createSdfIncludeResolutionContext(
    options.allFileContents ?? {},
  );
  const parsedGraph = parseSdfModel(modelEl, {
    ...options,
    sdfVersion,
    includeResolutionContext,
  });
  if (!parsedGraph) {
    return null;
  }

  const { links, materials, linkRecords } = parsedGraph;
  const { joints, closedLoopConstraints } = selectTreeJointsAndClosedLoops(parsedGraph);

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootCandidates = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId));

  rootCandidates.forEach((rootLinkId) => {
    const record = linkRecords.get(rootLinkId);
    if (!record || isIdentityPose(matrixToPose(record.worldMatrix))) {
      return;
    }

    const anchorLinkId = `${rootLinkId}__root`;
    const anchorJointId = `${anchorLinkId}_fixed`;
    if (links[anchorLinkId] || joints[anchorJointId]) {
      return;
    }

    links[anchorLinkId] = createEmptyLink(anchorLinkId, anchorLinkId);
    joints[anchorJointId] = createFixedJoint(
      anchorJointId,
      anchorLinkId,
      rootLinkId,
      matrixToPose(record.worldMatrix),
    );
  });

  const finalChildLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootLinkId =
    Object.keys(links).find((linkId) => !finalChildLinkIds.has(linkId)) ||
    Object.keys(links)[0] ||
    '';

  return {
    name: modelName,
    links,
    joints,
    rootLinkId,
    ...(Object.keys(materials).length > 0 ? { materials } : {}),
    ...(closedLoopConstraints ? { closedLoopConstraints } : {}),
    selection: { type: 'link', id: rootLinkId },
  };
}
