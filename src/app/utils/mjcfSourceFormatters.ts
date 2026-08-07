import { GeometryType, type UrdfInertial, type UrdfVisual } from '@/types';

/**
 * 纯 MJCF 值格式化器：把机器人标量 / 向量 / 欧拉 / 颜色 / 惯量等值转成 MuJoCo XML 属性片段。
 *
 * 原先散落在 mjcfEditableSourcePatchHelpers.ts，与 XML 源 patch（find/replace/insert）逻辑混在一起。
 * 抽离到独立模块以获得更窄合约（值 → 字符串，无 XML surgery）与可独立测试的纯逻辑。
 *
 * 依赖方向：mjcfEditableSourcePatchHelpers（patch/snippet 逻辑）→ 本模块；本模块不反向依赖 patch。
 * isZeroVec3 / isZeroRpy 是谓词（非格式化器），被 patch 逻辑直接调用，仍留在 Helpers。
 * formatMJCFJointRangeValue / getMujocoJointRange 返回数值（非字符串）且与 joint-limit patch 强耦合，也留在 Helpers。
 */

export const DEFAULT_COLLISION_RGBA = '0.937255 0.266667 0.266667 1';

export function formatScalar(value: number | undefined): string | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  const normalized = Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(6));
  return `${normalized}`;
}

export function formatVec3(vector: { x: number; y: number; z: number }): string {
  return [vector.x, vector.y, vector.z]
    .map((value) => formatScalar(value) ?? '0')
    .join(' ');
}

export function normalizeHexColor(color: string | undefined): string | null {
  if (!color) {
    return null;
  }

  const normalized = color.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(normalized) || /^[0-9a-fA-F]{4}$/.test(normalized)) {
    return normalized
      .split('')
      .map((char) => `${char}${char}`)
      .join('');
  }

  if (/^[0-9a-fA-F]{6}$/.test(normalized) || /^[0-9a-fA-F]{8}$/.test(normalized)) {
    return normalized;
  }

  return null;
}

export function formatColorRgba(color: string | undefined): string {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return DEFAULT_COLLISION_RGBA;
  }

  const channels = normalized.match(/.{2}/g);
  if (!channels || (channels.length !== 3 && channels.length !== 4)) {
    return DEFAULT_COLLISION_RGBA;
  }

  const [r, g, b, a = 255] = channels.map((value) => Number.parseInt(value, 16));
  return [r, g, b, a]
    .map((value, index) => {
      const normalizedChannel = Math.max(0, Math.min(255, value)) / 255;
      const rounded = Number(normalizedChannel.toFixed(6));
      return index === 3 ? `${rounded}` : `${rounded}`;
    })
    .join(' ');
}

export function formatCollisionGeomSize(geometry: Pick<UrdfVisual, 'type' | 'dimensions'>): string {
  switch (geometry.type) {
    case GeometryType.BOX:
      return `${formatScalar(geometry.dimensions.x / 2) ?? '0'} ${formatScalar(geometry.dimensions.y / 2) ?? '0'} ${formatScalar(geometry.dimensions.z / 2) ?? '0'}`;
    case GeometryType.PLANE:
      return `${formatScalar(geometry.dimensions.x / 2) ?? '0'} ${formatScalar(geometry.dimensions.y / 2) ?? '0'} 0.1`;
    case GeometryType.CYLINDER:
    case GeometryType.CAPSULE:
      return `${formatScalar(geometry.dimensions.x) ?? '0'} ${formatScalar(geometry.dimensions.y / 2) ?? '0'}`;
    case GeometryType.SPHERE:
      return `${formatScalar(geometry.dimensions.x) ?? '0'}`;
    case GeometryType.ELLIPSOID:
      return `${formatScalar(geometry.dimensions.x) ?? '0'} ${formatScalar(geometry.dimensions.y) ?? '0'} ${formatScalar(geometry.dimensions.z) ?? '0'}`;
    default:
      return '';
  }
}

export function formatEuler(rpy: { r: number; p: number; y: number }): string {
  return [
    formatScalar(rpy.r) ?? '0',
    formatScalar(rpy.p) ?? '0',
    formatScalar(rpy.y) ?? '0',
  ].join(' ');
}

export function formatEulerForAngleUnit(
  rpy: { r: number; p: number; y: number },
  angleUnit: 'radian' | 'degree',
): string {
  if (angleUnit === 'radian') {
    return formatEuler(rpy);
  }

  return [
    formatScalar(rpy.r * 180 / Math.PI) ?? '0',
    formatScalar(rpy.p * 180 / Math.PI) ?? '0',
    formatScalar(rpy.y * 180 / Math.PI) ?? '0',
  ].join(' ');
}

export function formatQuaternionWxyzFromRpy(rpy: { r: number; p: number; y: number }): string {
  const cr = Math.cos(rpy.r / 2);
  const sr = Math.sin(rpy.r / 2);
  const cp = Math.cos(rpy.p / 2);
  const sp = Math.sin(rpy.p / 2);
  const cy = Math.cos(rpy.y / 2);
  const sy = Math.sin(rpy.y / 2);

  const w = cr * cp * cy + sr * sp * sy;
  const x = sr * cp * cy - cr * sp * sy;
  const y = cr * sp * cy + sr * cp * sy;
  const z = cr * cp * sy - sr * sp * cy;

  return [w, x, y, z]
    .map((value) => formatScalar(value) ?? '0')
    .join(' ');
}

export function formatMJCFInertiaDiagonal(inertial: UrdfInertial): string {
  return [
    inertial.inertia.ixx,
    inertial.inertia.iyy,
    inertial.inertia.izz,
  ].map((value) => formatScalar(value) ?? '0').join(' ');
}

export function formatMJCFFullInertia(inertial: UrdfInertial): string {
  return [
    inertial.inertia.ixx,
    inertial.inertia.iyy,
    inertial.inertia.izz,
    inertial.inertia.ixy,
    inertial.inertia.ixz,
    inertial.inertia.iyz,
  ].map((value) => formatScalar(value) ?? '0').join(' ');
}
