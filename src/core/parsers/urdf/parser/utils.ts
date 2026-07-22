import * as THREE from 'three';
import type { Euler, QuaternionXYZW, UrdfOrigin, Vector3 } from '@/types/geometry';

export interface ParsedUrdfColorDefinition {
  color: string;
  colorRgba: [number, number, number, number];
}

const XML_PREFIX_NAME = '[A-Za-z_][\\w.-]*';
const NAMESPACE_PREFIX_PATTERN = new RegExp(
  `(?:<\\s*\\/?\\s*(${XML_PREFIX_NAME}):${XML_PREFIX_NAME}\\b|\\s(${XML_PREFIX_NAME}):${XML_PREFIX_NAME}\\s*=)`,
  'g',
);
const NAMESPACE_DECLARATION_PATTERN = new RegExp(`\\sxmlns:(${XML_PREFIX_NAME})\\s*=`, 'g');

function findNamespacePrefixes(content: string, pattern: RegExp): Set<string> {
  const prefixes = new Set<string>();
  pattern.lastIndex = 0;

  for (const match of content.matchAll(pattern)) {
    const prefix = match[1] || match[2];
    if (prefix && prefix !== 'xml' && prefix !== 'xmlns') {
      prefixes.add(prefix);
    }
  }

  return prefixes;
}

function addMissingNamespaceDeclarations(content: string): string {
  const usedPrefixes = findNamespacePrefixes(content, NAMESPACE_PREFIX_PATTERN);
  if (usedPrefixes.size === 0) {
    return content;
  }

  const declaredPrefixes = findNamespacePrefixes(content, NAMESPACE_DECLARATION_PATTERN);
  const missingPrefixes = [...usedPrefixes].filter((prefix) => !declaredPrefixes.has(prefix));
  if (missingPrefixes.length === 0) {
    return content;
  }

  const declarations = missingPrefixes
    .map((prefix) => ` xmlns:${prefix}="urn:urdf-studio:auto-namespace:${prefix}"`)
    .join('');

  return content.replace(/<robot\b([^>]*)>/, `<robot$1${declarations}>`);
}

/**
 * Preprocess XML content to fix common issues
 */
export function preprocessXML(content: string): string {
  // Remove XML declaration if it's not at the start (after comments)
  const xmlDeclMatch = content.match(/(<\?xml[^?]*\?>)/);
  if (xmlDeclMatch) {
    const declIndex = content.indexOf(xmlDeclMatch[1]);
    // Check if there's non-whitespace content before the declaration
    const beforeDecl = content.substring(0, declIndex).trim();
    if (beforeDecl.length > 0) {
      // Move the declaration to the beginning or remove it
      content = content.replace(xmlDeclMatch[1], '');
      content = xmlDeclMatch[1] + '\n' + content;
    }
  }

  content = addMissingNamespaceDeclarations(content);

  // Remove <transmission> blocks to prevent parsing errors or duplicates if needed
  // But for the pure parser we might want to keep them if we ever support transmission parsing
  // For now, we clean them only if they cause issues, but the original code didn't remove them in parseURDF,
  // only in the loader preprocessor. We'll stick to basic cleanup here.

  return content.trim();
}

export const parseFloatSafe = (val: string | null | undefined, def: number): number => {
  if (val === null || val === undefined) return def;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : def;
};

export const parseOptionalFiniteFloat = (
  val: string | null | undefined,
): number | undefined => {
  if (val === null || val === undefined || val.trim() === '') return undefined;
  const parsed = Number.parseFloat(val);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseVec3 = (str: string | null): Vector3 => {
  if (!str) return { x: 0, y: 0, z: 0 };
  const parts = str
    .trim()
    .split(/\s+/)
    .map((v) => parseFloat(v));
  const result = {
    x: Number.isFinite(parts[0]) ? parts[0] : 0,
    y: Number.isFinite(parts[1]) ? parts[1] : 0,
    z: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
  return result;
};

export const parseRPY = (str: string | null): Euler => {
  if (!str) return { r: 0, p: 0, y: 0 };
  const parts = str
    .trim()
    .split(/\s+/)
    .map((v) => parseFloat(v));
  return {
    r: Number.isFinite(parts[0]) ? parts[0] : 0,
    p: Number.isFinite(parts[1]) ? parts[1] : 0,
    y: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
};

const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

export const parseQuaternionXYZW = (str: string | null | undefined): QuaternionXYZW | undefined => {
  if (!str) return undefined;
  const parts = str
    .trim()
    .split(/\s+/)
    .map((value) => parseFloat(value));
  if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) {
    return undefined;
  }

  return {
    x: parts[0],
    y: parts[1],
    z: parts[2],
    w: parts[3],
  };
};

export const quaternionXYZWToRPY = (quat: QuaternionXYZW): Euler => {
  tempQuaternion.set(quat.x, quat.y, quat.z, quat.w).normalize();
  tempEuler.setFromQuaternion(tempQuaternion, 'ZYX');
  return {
    r: tempEuler.x,
    p: tempEuler.y,
    y: tempEuler.z,
  };
};

export const parseOrigin = (originEl: Element | null | undefined): UrdfOrigin => {
  const xyz = parseVec3(originEl?.getAttribute('xyz') || null);
  const quatXyzw = parseQuaternionXYZW(originEl?.getAttribute('quat_xyzw'));
  const rpy = originEl?.hasAttribute('rpy')
    ? parseRPY(originEl.getAttribute('rpy'))
    : quatXyzw
      ? quaternionXYZWToRPY(quatXyzw)
      : parseRPY(null);

  return {
    xyz,
    rpy,
    ...(quatXyzw ? { quatXyzw } : {}),
  };
};

export const parseColorDefinition = (
  materialEl: Element | null,
): ParsedUrdfColorDefinition | null => {
  if (!materialEl) return null;
  const colorEl = materialEl.querySelector('color');
  if (!colorEl) return null;

  const rgba = colorEl.getAttribute('rgba');
  if (!rgba) return null;

  const parts = rgba.trim().split(/\s+/).map(Number);
  if (parts.length < 3 || parts.some((value, index) => index < 3 && !Number.isFinite(value))) {
    return null;
  }

  const red = Math.max(0, Math.min(1, parts[0] ?? 0));
  const green = Math.max(0, Math.min(1, parts[1] ?? 0));
  const blue = Math.max(0, Math.min(1, parts[2] ?? 0));
  const alpha = Math.max(0, Math.min(1, Number.isFinite(parts[3]) ? (parts[3] ?? 1) : 1));

  // Convert RGB to Hex
  const r = Math.floor(red * 255);
  const g = Math.floor(green * 255);
  const b = Math.floor(blue * 255);

  return {
    color: '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1),
    colorRgba: [red, green, blue, alpha],
  };
};

export const parseColor = (materialEl: Element | null): string | undefined => {
  return parseColorDefinition(materialEl)?.color;
};

export const parseTexture = (materialEl: Element | null): string | undefined => {
  if (!materialEl) return undefined;
  const textureEl = materialEl.querySelector('texture');
  const filename = textureEl?.getAttribute('filename')?.trim();
  return filename || undefined;
};

export const GAZEBO_COLORS: Record<string, string> = {
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
};
