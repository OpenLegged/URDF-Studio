import * as THREE from 'three';
import type { UrdfLink } from '@/types/index';

export type MeasureSlot = 'first' | 'second';
export type MeasureObjectType = 'visual' | 'collision';
export type MeasureAnchorMode = 'frame' | 'centerOfMass' | 'geometry';
export type MeasurePoseRepresentation = 'matrix' | 'rpy' | 'quat' | 'axisAngle';
export type MeasureMode = 'object' | 'point';

export interface MeasureRelativePose {
  matrix: THREE.Matrix4;
  translation: {
    x: number;
    y: number;
    z: number;
  };
  rpy: {
    r: number;
    p: number;
    y: number;
  };
  quaternion: {
    x: number;
    y: number;
    z: number;
    w: number;
  };
  axisAngle: {
    axis: {
      x: number;
      y: number;
      z: number;
    };
    angle: number;
  };
}

export interface MeasureTargetInput {
  linkName: string;
  objectType: MeasureObjectType;
  objectIndex: number;
  point: THREE.Vector3;
  poseWorldMatrix?: THREE.Matrix4 | null;
  /** Override the auto-derived `link:<name>` key (used by free-point mode for unique keys). */
  key?: string;
  /** Override the display label (defaults to `linkName`). */
  label?: string;
}

export interface MeasureTarget {
  key: string;
  label: string;
  linkName: string;
  objectType: MeasureObjectType;
  objectIndex: number;
  point: THREE.Vector3;
  poseWorldMatrix: THREE.Matrix4 | null;
}

export type MeasureLinkData = Pick<UrdfLink, 'inertial'>;

export interface MeasurementMetrics {
  distance: number;
  delta: {
    x: number;
    y: number;
    z: number;
  };
  absoluteDelta: {
    x: number;
    y: number;
    z: number;
  };
  isDiagonal: boolean;
}

export interface MeasureMeasurement extends MeasurementMetrics {
  id: string;
  groupId: string;
  groupIndex: number;
  first: MeasureTarget;
  second: MeasureTarget;
  relativePose: MeasureRelativePose | null;
}

export interface MeasureGroup {
  id: string;
  activeSlot: MeasureSlot;
  first: MeasureTarget | null;
  second: MeasureTarget | null;
}

export interface MeasureState {
  mode: MeasureMode;
  groups: MeasureGroup[];
  activeGroupId: string;
  hoverTarget: MeasureTarget | null;
}

const AXIS_EPSILON = 1e-6;
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

function normalizeNumber(value: number): number {
  return Math.abs(value) < AXIS_EPSILON ? 0 : value;
}

function cloneRigidPoseMatrix(matrix?: THREE.Matrix4 | null): THREE.Matrix4 | null {
  if (!matrix) {
    return null;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  matrix.decompose(position, quaternion, new THREE.Vector3());

  return new THREE.Matrix4().compose(position, quaternion.normalize(), UNIT_SCALE);
}

function normalizeDisplayQuaternion(quaternion: THREE.Quaternion): THREE.Quaternion {
  const normalizedQuaternion = quaternion.clone().normalize();
  if (normalizedQuaternion.w < 0) {
    normalizedQuaternion.set(
      -normalizedQuaternion.x,
      -normalizedQuaternion.y,
      -normalizedQuaternion.z,
      -normalizedQuaternion.w,
    );
  }
  return normalizedQuaternion;
}

function toAxisAngle(quaternion: THREE.Quaternion): MeasureRelativePose['axisAngle'] {
  const normalizedQuaternion = normalizeDisplayQuaternion(quaternion);
  const clampedW = THREE.MathUtils.clamp(normalizedQuaternion.w, -1, 1);
  const angle = normalizeNumber(2 * Math.acos(clampedW));
  const sinHalfAngle = Math.sqrt(Math.max(0, 1 - clampedW * clampedW));

  if (sinHalfAngle < AXIS_EPSILON || Math.abs(angle) < AXIS_EPSILON) {
    return {
      axis: { x: 1, y: 0, z: 0 },
      angle: 0,
    };
  }

  return {
    axis: {
      x: normalizeNumber(normalizedQuaternion.x / sinHalfAngle),
      y: normalizeNumber(normalizedQuaternion.y / sinHalfAngle),
      z: normalizeNumber(normalizedQuaternion.z / sinHalfAngle),
    },
    angle,
  };
}

export function createRigidWorldPoseMatrix(
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(position.clone(), quaternion.clone().normalize(), UNIT_SCALE);
}

export function getObjectWorldPoseMatrix(object: THREE.Object3D): THREE.Matrix4 {
  object.updateMatrixWorld(true);

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  object.matrixWorld.decompose(position, quaternion, new THREE.Vector3());

  return createRigidWorldPoseMatrix(position, quaternion);
}

export function getPoseMatrixFromPointAndObjectOrientation(
  point: THREE.Vector3,
  object: THREE.Object3D,
): THREE.Matrix4 {
  object.updateMatrixWorld(true);
  return createRigidWorldPoseMatrix(point, object.getWorldQuaternion(new THREE.Quaternion()));
}

export function getMeasureRelativePose(
  startPoseWorldMatrix?: THREE.Matrix4 | null,
  endPoseWorldMatrix?: THREE.Matrix4 | null,
): MeasureRelativePose | null {
  const startPose = cloneRigidPoseMatrix(startPoseWorldMatrix);
  const endPose = cloneRigidPoseMatrix(endPoseWorldMatrix);
  if (!startPose || !endPose) {
    return null;
  }

  const relativeMatrix = startPose.clone().invert().multiply(endPose);
  const rigidRelativeMatrix = cloneRigidPoseMatrix(relativeMatrix);
  if (!rigidRelativeMatrix) {
    return null;
  }

  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  rigidRelativeMatrix.decompose(position, quaternion, new THREE.Vector3());

  const normalizedQuaternion = normalizeDisplayQuaternion(quaternion);
  const euler = new THREE.Euler(0, 0, 0, 'ZYX').setFromQuaternion(normalizedQuaternion, 'ZYX');

  return {
    matrix: rigidRelativeMatrix,
    translation: {
      x: normalizeNumber(position.x),
      y: normalizeNumber(position.y),
      z: normalizeNumber(position.z),
    },
    rpy: {
      r: normalizeNumber(euler.x),
      p: normalizeNumber(euler.y),
      y: normalizeNumber(euler.z),
    },
    quaternion: {
      x: normalizeNumber(normalizedQuaternion.x),
      y: normalizeNumber(normalizedQuaternion.y),
      z: normalizeNumber(normalizedQuaternion.z),
      w: normalizeNumber(normalizedQuaternion.w),
    },
    axisAngle: toAxisAngle(normalizedQuaternion),
  };
}

function parseVector3Text(value: string | null | undefined): THREE.Vector3 | null {
  if (!value) {
    return null;
  }

  const parts = value
    .trim()
    .split(/\s+/)
    .map((component) => Number(component));

  if (parts.length < 3 || parts.slice(0, 3).some((component) => !Number.isFinite(component))) {
    return null;
  }

  return new THREE.Vector3(parts[0], parts[1], parts[2]);
}

function getLinkDataCenterOfMassLocal(linkData?: MeasureLinkData | null): THREE.Vector3 | null {
  const xyz = linkData?.inertial?.origin?.xyz;
  if (!xyz) {
    return null;
  }

  const x = Number(xyz.x);
  const y = Number(xyz.y);
  const z = Number(xyz.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return null;
  }

  return new THREE.Vector3(x, y, z);
}

function getLinkUrdfNodeCenterOfMassLocal(
  linkObject?: THREE.Object3D | null,
): THREE.Vector3 | null {
  const urdfNode = (
    linkObject as
      | (THREE.Object3D & {
          urdfNode?: {
            querySelector?: (
              selector: string,
            ) => { getAttribute?: (name: string) => string | null } | null;
          } | null;
        })
      | null
  )?.urdfNode;

  if (!urdfNode || typeof urdfNode.querySelector !== 'function') {
    return null;
  }

  const originNode = urdfNode.querySelector('inertial > origin');
  if (!originNode || typeof originNode.getAttribute !== 'function') {
    return null;
  }

  return parseVector3Text(originNode.getAttribute('xyz'));
}

export function getLinkCenterOfMassLocal(
  linkData?: MeasureLinkData | null,
  linkObject?: THREE.Object3D | null,
): THREE.Vector3 | null {
  return getLinkDataCenterOfMassLocal(linkData) ?? getLinkUrdfNodeCenterOfMassLocal(linkObject);
}

export function getLinkCenterOfMassWorld(
  linkObject: THREE.Object3D,
  linkData?: MeasureLinkData | null,
): THREE.Vector3 | null {
  const localCenterOfMass = getLinkCenterOfMassLocal(linkData, linkObject);
  if (!localCenterOfMass) {
    return null;
  }

  linkObject.updateMatrixWorld(true);
  return localCenterOfMass.applyMatrix4(linkObject.matrixWorld);
}

export function getObjectWorldCenter(object: THREE.Object3D): THREE.Vector3 {
  const boundingBox = new THREE.Box3().setFromObject(object);
  if (boundingBox.isEmpty()) {
    return object.getWorldPosition(new THREE.Vector3());
  }
  return boundingBox.getCenter(new THREE.Vector3());
}

export function getLinkFrameWorldPoint(linkObject: THREE.Object3D): THREE.Vector3 {
  linkObject.updateMatrixWorld(true);
  return linkObject.getWorldPosition(new THREE.Vector3());
}

function isMeasureBody(object: THREE.Object3D, objectType: MeasureObjectType): boolean {
  if (objectType === 'collision') {
    return Boolean((object as any).isURDFCollider || object.userData?.isCollisionGroup === true);
  }

  return Boolean((object as any).isURDFVisual || object.userData?.isVisualGroup === true);
}

function isCollisionMeasureMesh(object: THREE.Object3D): boolean {
  return Boolean(
    object.userData?.isCollisionMesh === true ||
    object.userData?.isCollision === true ||
    object.userData?.geometryRole === 'collision',
  );
}

function isMeasureMesh(
  object: THREE.Object3D,
  objectType: MeasureObjectType,
): object is THREE.Mesh {
  if (!(object as THREE.Mesh).isMesh) {
    return false;
  }

  return objectType === 'collision'
    ? isCollisionMeasureMesh(object)
    : !isCollisionMeasureMesh(object);
}

function isDirectLinkMeasureObject(object: THREE.Object3D): boolean {
  if (
    object.userData?.isHelper === true ||
    object.userData?.isGizmo === true ||
    String(object.name || '').startsWith('__')
  ) {
    return false;
  }

  if ((object as any).isURDFJoint || (object as any).isURDFLink) {
    return false;
  }

  return Boolean(
    (object as any).isURDFVisual ||
    (object as any).isURDFCollider ||
    object.userData?.isVisualGroup === true ||
    object.userData?.isCollisionGroup === true ||
    (object as any).isMesh,
  );
}

function expandBoundsWithObject(bounds: THREE.Box3, object: THREE.Object3D): boolean {
  const objectBounds = new THREE.Box3().setFromObject(object);
  if (objectBounds.isEmpty()) {
    return false;
  }

  bounds.union(objectBounds);
  return true;
}

export function getLinkMeasureCenter(
  linkObject: THREE.Object3D,
  objectType: MeasureObjectType = 'visual',
  objectIndex = 0,
): THREE.Vector3 {
  const directBodies = linkObject.children.filter((child) => isMeasureBody(child, objectType));
  const targetBody = directBodies[objectIndex] ?? directBodies[0] ?? null;
  if (targetBody) {
    return getObjectWorldCenter(targetBody);
  }

  const directMeshes = linkObject.children.filter((child): child is THREE.Mesh =>
    isMeasureMesh(child, objectType),
  );
  const targetMesh = directMeshes[objectIndex] ?? directMeshes[0] ?? null;
  if (targetMesh) {
    return getObjectWorldCenter(targetMesh);
  }

  const linkBounds = new THREE.Box3();
  let hasLinkBounds = false;

  linkObject.children.forEach((child) => {
    if (!isDirectLinkMeasureObject(child)) {
      return;
    }

    hasLinkBounds = expandBoundsWithObject(linkBounds, child) || hasLinkBounds;
  });

  if (hasLinkBounds) {
    return linkBounds.getCenter(new THREE.Vector3());
  }

  return linkObject.getWorldPosition(new THREE.Vector3());
}

export function getLinkMeasurePoint(
  linkObject: THREE.Object3D,
  linkData?: MeasureLinkData | null,
  anchorMode: MeasureAnchorMode = 'frame',
  objectType: MeasureObjectType = 'visual',
  objectIndex = 0,
): THREE.Vector3 {
  if (anchorMode === 'centerOfMass') {
    return getLinkCenterOfMassWorld(linkObject, linkData) ?? getLinkFrameWorldPoint(linkObject);
  }

  if (anchorMode === 'geometry') {
    return getLinkMeasureCenter(linkObject, objectType, objectIndex);
  }

  return getLinkFrameWorldPoint(linkObject);
}

function countNonZeroAxes(delta: MeasurementMetrics['absoluteDelta']): number {
  return [delta.x, delta.y, delta.z].filter((value) => value > AXIS_EPSILON).length;
}

function createMeasureGroupId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) {
    return `measure-group:${randomUuid()}`;
  }

  // Fallback keeps the viewer usable in non-secure contexts long enough to surface
  // the real USD runtime environment error instead of crashing first on randomUUID().
  return `measure-group:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createMeasureGroup(): MeasureGroup {
  return {
    id: createMeasureGroupId(),
    activeSlot: 'first',
    first: null,
    second: null,
  };
}

function updateMeasureGroup(
  state: MeasureState,
  groupId: string,
  updater: (group: MeasureGroup) => MeasureGroup,
): MeasureState {
  let changed = false;

  const groups = state.groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }

    changed = true;
    return updater(group);
  });

  return changed ? { ...state, groups } : state;
}

export function createEmptyMeasureState(mode: MeasureMode = 'object'): MeasureState {
  const initialGroup = createMeasureGroup();
  return {
    mode,
    groups: [initialGroup],
    activeGroupId: initialGroup.id,
    hoverTarget: null,
  };
}

export function createMeasureTarget({
  linkName,
  objectType,
  objectIndex,
  point,
  poseWorldMatrix = null,
  key,
  label,
}: MeasureTargetInput): MeasureTarget {
  return {
    key: key ?? `link:${linkName}`,
    label: label ?? linkName,
    linkName,
    objectType,
    objectIndex,
    point: point.clone(),
    poseWorldMatrix: cloneRigidPoseMatrix(poseWorldMatrix),
  };
}

export function getMeasurementMetrics(
  start: THREE.Vector3,
  end: THREE.Vector3,
): MeasurementMetrics {
  const delta = {
    x: normalizeNumber(end.x - start.x),
    y: normalizeNumber(end.y - start.y),
    z: normalizeNumber(end.z - start.z),
  };
  const absoluteDelta = {
    x: Math.abs(delta.x),
    y: Math.abs(delta.y),
    z: Math.abs(delta.z),
  };

  return {
    distance: normalizeNumber(start.distanceTo(end)),
    delta,
    absoluteDelta,
    isDiagonal: countNonZeroAxes(absoluteDelta) > 1,
  };
}

export function createMeasureMeasurement(group: MeasureGroup, groupIndex = 1): MeasureMeasurement {
  if (!group.first || !group.second) {
    throw new Error('Cannot create a measurement from an incomplete measure group.');
  }

  return {
    id: group.id,
    groupId: group.id,
    groupIndex,
    first: createMeasureTarget(group.first),
    second: createMeasureTarget(group.second),
    relativePose: getMeasureRelativePose(group.first.poseWorldMatrix, group.second.poseWorldMatrix),
    ...getMeasurementMetrics(group.first.point, group.second.point),
  };
}

export function getActiveMeasureGroup(state: MeasureState): MeasureGroup {
  return state.groups.find((group) => group.id === state.activeGroupId) ?? state.groups[0];
}

export function getMeasureStateMeasurements(state: MeasureState): MeasureMeasurement[] {
  return state.groups.flatMap((group, index) =>
    group.first && group.second ? [createMeasureMeasurement(group, index + 1)] : [],
  );
}

export function getActiveMeasureMeasurement(state: MeasureState): MeasureMeasurement | null {
  const activeGroup = getActiveMeasureGroup(state);
  if (!activeGroup.first || !activeGroup.second) {
    return null;
  }

  const activeGroupIndex = state.groups.findIndex((group) => group.id === activeGroup.id);
  return createMeasureMeasurement(activeGroup, activeGroupIndex >= 0 ? activeGroupIndex + 1 : 1);
}

export function addMeasureGroup(state: MeasureState): MeasureState {
  const nextGroup = createMeasureGroup();

  return {
    ...state,
    groups: [...state.groups, nextGroup],
    activeGroupId: nextGroup.id,
    hoverTarget: null,
  };
}

export function removeMeasureGroup(state: MeasureState, groupId: string): MeasureState {
  const groupIndex = state.groups.findIndex((group) => group.id === groupId);
  if (groupIndex < 0) {
    return state;
  }

  const remainingGroups = state.groups.filter((group) => group.id !== groupId);
  if (remainingGroups.length === 0) {
    return createEmptyMeasureState(state.mode);
  }

  const nextActiveGroupId =
    state.activeGroupId === groupId
      ? (remainingGroups[Math.min(groupIndex, remainingGroups.length - 1)]?.id ??
        remainingGroups[0].id)
      : state.activeGroupId;

  return {
    ...state,
    groups: remainingGroups,
    activeGroupId: nextActiveGroupId,
    hoverTarget: null,
  };
}

export function setActiveMeasureGroup(state: MeasureState, groupId: string): MeasureState {
  if (!state.groups.some((group) => group.id === groupId) || state.activeGroupId === groupId) {
    return state;
  }

  return {
    ...state,
    activeGroupId: groupId,
    hoverTarget: null,
  };
}

export function setActiveMeasureSlot(state: MeasureState, slot: MeasureSlot): MeasureState {
  return {
    ...updateMeasureGroup(state, state.activeGroupId, (group) => ({
      ...group,
      activeSlot: slot,
    })),
    hoverTarget: null,
  };
}

export function setMeasureHoverTarget(
  state: MeasureState,
  target: MeasureTarget | null,
): MeasureState {
  return {
    ...state,
    hoverTarget: target ? createMeasureTarget(target) : null,
  };
}

export function applyMeasurePick(
  state: MeasureState,
  target: MeasureTarget,
  slot: MeasureSlot = getActiveMeasureGroup(state).activeSlot,
): MeasureState {
  const activeGroup = getActiveMeasureGroup(state);
  const otherSlot = slot === 'first' ? 'second' : 'first';
  const shouldAutoAdvance = !activeGroup[slot] && !activeGroup[otherSlot];

  return {
    ...updateMeasureGroup(state, activeGroup.id, (group) => ({
      ...group,
      [slot]: createMeasureTarget(target),
      activeSlot: shouldAutoAdvance ? otherSlot : slot,
    })),
    hoverTarget: null,
  };
}

export function clearMeasureSlot(state: MeasureState, slot: MeasureSlot): MeasureState {
  return {
    ...updateMeasureGroup(state, state.activeGroupId, (group) => ({
      ...group,
      [slot]: null,
      activeSlot: slot,
    })),
    hoverTarget: null,
  };
}

export function clearActiveMeasureGroup(state: MeasureState): MeasureState {
  return {
    ...updateMeasureGroup(state, state.activeGroupId, (group) => ({
      ...group,
      activeSlot: 'first',
      first: null,
      second: null,
    })),
    hoverTarget: null,
  };
}

export function undoMeasureState(state: MeasureState): MeasureState {
  const activeGroup = getActiveMeasureGroup(state);
  if (activeGroup.first || activeGroup.second || state.hoverTarget) {
    return clearActiveMeasureGroup(state);
  }

  for (let index = state.groups.length - 1; index >= 0; index -= 1) {
    const group = state.groups[index];
    if (!group.first && !group.second) {
      continue;
    }

    return {
      ...updateMeasureGroup(state, group.id, (item) => ({
        ...item,
        activeSlot: 'first',
        first: null,
        second: null,
      })),
      activeGroupId: group.id,
      hoverTarget: null,
    };
  }

  return state;
}

export function clearMeasureState(mode: MeasureMode = 'object'): MeasureState {
  return createEmptyMeasureState(mode);
}

export function setMeasureMode(state: MeasureState, mode: MeasureMode): MeasureState {
  if (state.mode === mode) {
    return state;
  }

  // Object and free-point groups must never share a list: their slots carry
  // different semantics (resolved link vs. raw surface point), which would make
  // undo/labels ambiguous. Switching mode starts from a clean state.
  return createEmptyMeasureState(mode);
}

function createMeasurePointKey(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUuid) {
    return `point:${randomUuid()}`;
  }

  return `point:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Free-point picking: append a raw surface hit point to the active group's
 * current slot, reusing the same slot auto-advance / grouping semantics as
 * object picking. Point targets carry no link/pose, so relative-pose math
 * resolves to null (free points have no orientation).
 */
export function appendMeasurePoint(state: MeasureState, point: THREE.Vector3): MeasureState {
  // Once the active group has both points, the next click starts a fresh pair —
  // matching the classic point-to-point flow where every two clicks draw a new line.
  const baseState = (() => {
    const activeGroup = getActiveMeasureGroup(state);
    return activeGroup.first && activeGroup.second ? addMeasureGroup(state) : state;
  })();

  const activeGroup = getActiveMeasureGroup(baseState);
  const slotLabel = activeGroup.activeSlot === 'second' ? 'P2' : 'P1';
  const target = createMeasureTarget({
    linkName: '',
    objectType: 'visual',
    objectIndex: 0,
    point,
    poseWorldMatrix: null,
    key: createMeasurePointKey(),
    label: slotLabel,
  });

  return applyMeasurePick(baseState, target);
}
