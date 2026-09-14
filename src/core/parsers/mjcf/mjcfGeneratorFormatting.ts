import * as THREE from 'three';

import { normalizeColorRgbaTuple } from '@/core/utils/color';
import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberPreservingPrecision,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import {
  clampUnitScalar,
  escapeXmlAttribute,
  type ExportedMjcfSite,
  type MeshScaleTuple,
} from './mjcfGeneratorUtils';

type FormatNumber = (value: number) => string;
type Rpy = { r: number; p: number; y: number };

function hexToRgba(hex: string, opacity: number | undefined, format: FormatNumber): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(hex.trim());
  if (!result) return '0.8 0.8 0.8 1.0';
  const alpha = clampUnitScalar(opacity) ?? (result[4] ? parseInt(result[4], 16) / 255 : 1);
  return [parseInt(result[1], 16) / 255, parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255, alpha].map(format).join(' ');
}

function materialToRgba(
  color: string,
  colorRgba: readonly number[] | null | undefined,
  opacity: number | undefined,
  format: FormatNumber,
): string {
  const normalized = normalizeColorRgbaTuple(colorRgba);
  if (!normalized) return hexToRgba(color, opacity, format);
  return [normalized[0], normalized[1], normalized[2],
    clampUnitScalar(opacity) ?? normalized[3]].map(format).join(' ');
}

function renderSite(
  site: ExportedMjcfSite,
  indent: string,
  format: FormatNumber,
  formatColor: FormatNumber,
): string {
  const attrs = [`name="${escapeXmlAttribute(site.name)}"`];
  attrs.push(`type="${escapeXmlAttribute(site.type || 'sphere')}"`);
  if (site.pos) {
    attrs.push(`pos="${[site.pos.x, site.pos.y, site.pos.z].map(format).join(' ')}"`);
  }
  if (site.quat && site.quat.length >= 4) {
    attrs.push(`quat="${site.quat.slice(0, 4).map(format).join(' ')}"`);
  }
  if (site.size?.length) {
    attrs.push(`size="${site.size.map(format).join(' ')}"`);
  }
  if (site.rgba?.length) {
    attrs.push(`rgba="${site.rgba.slice(0, 4).map(formatColor).join(' ')}"`);
  }
  if (Number.isFinite(site.group)) {
    attrs.push(`group="${site.group}"`);
  }
  return `${indent}<site ${attrs.join(' ')} />\n`;
}

/** Each generation owns its precision policy, including nested assets and sites. */
export function createMjcfNumberFormatters(preserveNumericPrecision = false) {
  const formatter = (decimals: number): FormatNumber => preserveNumericPrecision
    ? formatNumberPreservingPrecision
    : value => formatNumberWithMaxDecimals(value, decimals);
  const formatScalar = formatter(MAX_PROPERTY_DECIMALS);
  const formatShape = formatter(MAX_GEOMETRY_DIMENSION_DECIMALS);
  const formatColorScalar = formatter(4);
  const quatStr = (rpy: Rpy): string => {
    const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
    return [quat.w, quat.x, quat.y, quat.z].map(formatScalar).join(' ');
  };
  const quatAttr = (rpy: Rpy | undefined): string => {
    const threshold = preserveNumericPrecision ? 0 : 1e-9;
    return rpy && [rpy.r, rpy.p, rpy.y].some(value => Math.abs(value) > threshold)
      ? ` quat="${quatStr(rpy)}"` : '';
  };
  return {
    formatScalar,
    formatShape,
    formatColorScalar,
    formatInertiaScalar: formatter(10),
    vecStr: (v: { x: number; y: number; z: number }) =>
      [v.x, v.y, v.z].map(formatScalar).join(' '),
    quatStr,
    quatAttr,
    hexToRgba: (hex: string, opacity?: number) => hexToRgba(hex, opacity, formatColorScalar),
    meshScaleKey: (scale: MeshScaleTuple) => scale.map(formatShape).join(' '),
    materialToMjcfRgba: (color: string, rgba?: readonly number[] | null, opacity?: number) =>
      materialToRgba(color, rgba, opacity, formatColorScalar),
    renderMjcfSite: (site: ExportedMjcfSite, indent: string) =>
      renderSite(site, indent, formatScalar, formatColorScalar),
  };
}
