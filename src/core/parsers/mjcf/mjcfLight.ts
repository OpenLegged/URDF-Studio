export interface MJCFModelLight {
  name?: string;
  className?: string;
  classQName?: string;
  /** Unknown source values are retained so consumers can report unsupported lights. */
  type: string;
  mode: string;
  target?: string;
  active: boolean;
  castshadow: boolean;
  pos: [number, number, number];
  dir: [number, number, number];
  ambient: [number, number, number];
  diffuse: [number, number, number];
  specular: [number, number, number];
  attenuation: [number, number, number];
  /** Always degrees, independent of compiler.angle. */
  cutoff: number;
  exponent: number;
}

function numericAttribute(
  attributes: Record<string, string>,
  name: string,
  fallback: readonly number[],
): number[] {
  const value = attributes[name];
  if (value === undefined) return [...fallback];
  const values = value.trim().split(/\s+/).map(Number);
  if (!value.trim() || values.length !== fallback.length || !values.every(Number.isFinite)) {
    throw new Error(`light attribute "${name}" requires ${fallback.length} finite numbers`);
  }
  return values;
}

function vectorAttribute(
  attributes: Record<string, string>,
  name: string,
  fallback: readonly [number, number, number],
): [number, number, number] {
  const values = numericAttribute(attributes, name, fallback);
  return [values[0], values[1], values[2]];
}

function booleanAttribute(
  attributes: Record<string, string>,
  name: string,
  fallback: boolean,
): boolean {
  const value = attributes[name];
  if (value === undefined) return fallback;
  if (value.trim() === 'true') return true;
  if (value.trim() === 'false') return false;
  throw new Error(`light attribute "${name}" must be true or false`);
}

/** Parse resolved default/source attributes. The model walker owns frame transforms. */
export function parseMJCFModelLightAttributes(attributes: Record<string, string>): MJCFModelLight {
  const cutoff = numericAttribute(attributes, 'cutoff', [45])[0];
  const exponent = numericAttribute(attributes, 'exponent', [10])[0];
  const dir = vectorAttribute(attributes, 'dir', [0, 0, -1]);
  if (dir.every((value) => value === 0)) throw new Error('light direction must be nonzero');
  const attenuation = vectorAttribute(attributes, 'attenuation', [1, 0, 0]);
  const directional = booleanAttribute(attributes, 'directional', false);
  return {
    name: attributes.name?.trim() || undefined,
    type: attributes.type?.trim() || (directional ? 'directional' : 'spot'),
    mode: attributes.mode?.trim() || 'fixed',
    target: attributes.target?.trim() || undefined,
    active: booleanAttribute(attributes, 'active', true),
    castshadow: booleanAttribute(attributes, 'castshadow', true),
    pos: vectorAttribute(attributes, 'pos', [0, 0, 0]),
    dir,
    ambient: vectorAttribute(attributes, 'ambient', [0, 0, 0]),
    diffuse: vectorAttribute(attributes, 'diffuse', [0.7, 0.7, 0.7]),
    specular: vectorAttribute(attributes, 'specular', [0.3, 0.3, 0.3]),
    attenuation,
    cutoff,
    exponent,
  };
}
