import {
  MJCF_COMPILER_ANGLE_SCOPE_ATTR,
  MJCF_COMPILER_EULERSEQ_SCOPE_ATTR,
} from './mjcfCompilerScope';
import {
  MJCFElementType,
  MJCFAttributeMap,
  MJCFDefaultClassEntry,
  MJCF_ROOT_PATTERN,
  repairMissingAttributeWhitespace,
  parseXmlDocument,
  normalizeAngleUnit,
  quaternionFromAxisAngle,
  quaternionFromEuler,
  quaternionFromXYAxes,
  quaternionFromZAxis,
  createEmptyDefaults,
  mergeDefaults,
  visitDefaultElement,
  findDescendantClassQName,
  deriveAssetName,
} from './mjcfUtilsHelpers';
import type { MJCFCompilerSettings, MJCFDefaultsRegistry } from './mjcfUtilsHelpers';

export type MJCFMeshInertiaMode = 'legacy' | 'shell' | 'exact' | 'convex';

export interface MJCFMesh {
  name: string;
  file?: string;
  vertices?: number[];
  scale?: number[];
  refpos?: [number, number, number];
  refquat?: [number, number, number, number];
  inertia?: MJCFMeshInertiaMode;
}

export interface MJCFMaterial {
  name: string;
  rgba?: number[];
  shininess?: number;
  specular?: number;
  reflectance?: number;
  emission?: number;
  texture?: string;
  texrepeat?: number[];
  texuniform?: boolean;
}

export interface MJCFTexture {
  name: string;
  file?: string;
  fileback?: string;
  filedown?: string;
  filefront?: string;
  fileleft?: string;
  fileright?: string;
  fileup?: string;
  type?: string;
  builtin?: string;
  rgb1?: number[];
  rgb2?: number[];
  mark?: string;
  markrgb?: number[];
  width?: number;
  height?: number;
}

export interface MJCFHfield {
  name: string;
  file?: string;
  contentType?: string;
  nrow?: number;
  ncol?: number;
  size?: [number, number, number, number];
  elevation?: number[];
}

export interface MJCFPosition {
  x: number;
  y: number;
  z: number;
}

export interface MJCFQuaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

export function looksLikeMJCFDocument(content: string): boolean {
  if (!content) {
    return false;
  }

  return MJCF_ROOT_PATTERN.test(content.slice(0, 2048));
}

export interface ParsedMJCFXmlDocumentResult {
  doc: Document | null;
  parseErrorText: string | null;
  recovered: boolean;
}

export function parseMJCFXmlDocument(content: string): ParsedMJCFXmlDocumentResult {
  const initial = parseXmlDocument(content);
  if (initial.doc) {
    return {
      doc: initial.doc,
      parseErrorText: null,
      recovered: false,
    };
  }

  const repairedContent = repairMissingAttributeWhitespace(content);
  if (repairedContent === content) {
    return {
      doc: null,
      parseErrorText: initial.parseErrorText,
      recovered: false,
    };
  }

  const repaired = parseXmlDocument(repairedContent);
  if (repaired.doc) {
    return {
      doc: repaired.doc,
      parseErrorText: null,
      recovered: true,
    };
  }

  return {
    doc: null,
    parseErrorText: repaired.parseErrorText ?? initial.parseErrorText,
    recovered: false,
  };
}

export function parseNumbers(str: string | null): number[] {
  if (!str) return [];

  return str
    .trim()
    .split(/\s+/)
    .map((segment) => {
      const value = parseFloat(segment);
      return isNaN(value) ? 0 : value;
    });
}

export function parseCompilerSettings(doc: Document): MJCFCompilerSettings {
  // MuJoCo accepts multiple <compiler> blocks (common with <include> files) and
  // merges them in document order: later blocks override only attributes they set.
  const compilers = Array.from(doc.querySelectorAll('compiler'));

  // MuJoCo default when not explicitly set.
  let angleAttr = 'degree';
  let assetdir = '';
  let meshdir: string | null = null;
  let texturedir: string | null = null;
  let eulerSequence = 'xyz';
  let autolimits = false;
  let fitaabb = false;
  let inertiafromgeom: 'false' | 'true' | 'auto' = 'auto';
  let inertiagrouprange: [number, number] | undefined;
  let boundinertia: number | undefined;

  for (const compiler of compilers) {
    const rawAngle = compiler.getAttribute('angle');
    if (rawAngle) {
      angleAttr = rawAngle.toLowerCase();
    }

    const rawAssetdir = compiler.getAttribute('assetdir');
    if (rawAssetdir !== null) {
      assetdir = rawAssetdir;
    }

    const rawMeshdir = compiler.getAttribute('meshdir');
    if (rawMeshdir !== null) {
      meshdir = rawMeshdir;
    }

    const rawTexturedir = compiler.getAttribute('texturedir');
    if (rawTexturedir !== null) {
      texturedir = rawTexturedir;
    }

    const rawEulerSequence = compiler.getAttribute('eulerseq');
    if (rawEulerSequence) {
      eulerSequence = rawEulerSequence;
    }

    const rawAutolimits = compiler.getAttribute('autolimits');
    if (rawAutolimits !== null) {
      autolimits = rawAutolimits.trim().toLowerCase() === 'true';
    }

    const rawFitAabb = compiler.getAttribute('fitaabb');
    if (rawFitAabb !== null) {
      fitaabb = rawFitAabb.trim().toLowerCase() === 'true';
    }

    const rawInertiaFromGeom = compiler.getAttribute('inertiafromgeom');
    if (rawInertiaFromGeom) {
      const normalizedInertiaFromGeom = rawInertiaFromGeom.trim().toLowerCase();
      if (
        normalizedInertiaFromGeom === 'true' ||
        normalizedInertiaFromGeom === 'false' ||
        normalizedInertiaFromGeom === 'auto'
      ) {
        inertiafromgeom = normalizedInertiaFromGeom;
      }
    }

    const rawInertiaGroupRange = parseNumbers(compiler.getAttribute('inertiagrouprange'));
    if (rawInertiaGroupRange.length >= 2) {
      inertiagrouprange = [rawInertiaGroupRange[0] ?? 0, rawInertiaGroupRange[1] ?? 0];
    }

    const rawBoundInertia = compiler.getAttribute('boundinertia');
    if (rawBoundInertia !== null) {
      const parsedBoundInertia = parseFloat(rawBoundInertia);
      boundinertia = Number.isFinite(parsedBoundInertia) ? parsedBoundInertia : undefined;
    }
  }

  const effectiveMeshdir = meshdir ?? assetdir;
  const effectiveTexturedir = texturedir ?? assetdir;

  return {
    angleUnit: angleAttr === 'degree' ? 'degree' : 'radian',
    assetdir,
    meshdir: effectiveMeshdir,
    texturedir: effectiveTexturedir,
    eulerSequence,
    autolimits,
    fitaabb,
    inertiafromgeom,
    inertiagrouprange,
    boundinertia,
  };
}

export function resolveCompilerSettingsForElement(
  element: Element | null | undefined,
  fallback: MJCFCompilerSettings,
): MJCFCompilerSettings {
  if (!element) {
    return fallback;
  }

  let current: Element | null = element;
  while (current) {
    const scopedAngleUnit = normalizeAngleUnit(
      current.getAttribute(MJCF_COMPILER_ANGLE_SCOPE_ATTR),
    );
    const scopedEulerSequence = current.getAttribute(MJCF_COMPILER_EULERSEQ_SCOPE_ATTR)?.trim();
    if (scopedAngleUnit || scopedEulerSequence) {
      return {
        ...fallback,
        angleUnit: scopedAngleUnit || fallback.angleUnit,
        eulerSequence: scopedEulerSequence || fallback.eulerSequence,
      };
    }

    current = current.parentElement;
  }

  return fallback;
}

export function parseOrientationAsQuat(
  attributes: {
    quat?: string | null;
    axisangle?: string | null;
    xyaxes?: string | null;
    zaxis?: string | null;
    euler?: string | null;
  },
  settings: MJCFCompilerSettings,
): [number, number, number, number] | undefined {
  return (
    parseQuatAsTuple(attributes.quat || null) ||
    quaternionFromAxisAngle(parseNumbers(attributes.axisangle || null), settings.angleUnit) ||
    quaternionFromXYAxes(parseNumbers(attributes.xyaxes || null)) ||
    quaternionFromZAxis(parseNumbers(attributes.zaxis || null)) ||
    quaternionFromEuler(parseNumbers(attributes.euler || null), settings)
  );
}

export function parsePosAsTuple(str: string | null): [number, number, number] {
  const nums = parseNumbers(str);

  return [
    nums.length > 0 ? nums[0] : 0,
    nums.length > 1 ? nums[1] : 0,
    nums.length > 2 ? nums[2] : 0,
  ];
}

export function parsePosAsObject(str: string | null): MJCFPosition {
  const [x, y, z] = parsePosAsTuple(str);
  return { x, y, z };
}

export function parseQuatAsTuple(str: string | null): [number, number, number, number] | undefined {
  const nums = parseNumbers(str);
  if (nums.length < 4) return undefined;

  const w = nums[0];
  const x = nums[1];
  const y = nums[2];
  const z = nums[3];
  const length = Math.hypot(w, x, y, z);

  if (length <= 1e-8) {
    return [1, 0, 0, 0];
  }

  return [w / length, x / length, y / length, z / length];
}

export function parseQuatAsObject(str: string | null): MJCFQuaternion | undefined {
  const quat = parseQuatAsTuple(str);
  if (!quat) return undefined;

  const [w, x, y, z] = quat;
  return { w, x, y, z };
}

export function parseMJCFDefaults(doc: Document): MJCFDefaultsRegistry {
  const registry: MJCFDefaultsRegistry = {
    root: createEmptyDefaults(),
    classesByQName: new Map<string, MJCFDefaultClassEntry>(),
    qnamesByClassName: new Map<string, string[]>(),
  };

  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return registry;
  }

  const topLevelDefaults = mujocoEl.querySelectorAll(':scope > default');
  topLevelDefaults.forEach((defaultEl) => {
    const mergedDefaults = visitDefaultElement(defaultEl, registry, registry.root, undefined);
    const className = defaultEl.getAttribute('class')?.trim();

    // MuJoCo's implicit global defaults class is `main`. Some menagerie models
    // express the active root defaults via `<default class="main">` instead of
    // an unnamed top-level `<default>`, so we need to seed `registry.root`
    // from both representations.
    if (!className || className === 'main') {
      registry.root = mergeDefaults(registry.root, mergedDefaults);
    }
  });

  return registry;
}

export function resolveDefaultClassQName(
  registry: MJCFDefaultsRegistry,
  className: string | null | undefined,
  activeClassQName?: string,
): string | undefined {
  const normalizedClassName = className?.trim();
  if (!normalizedClassName) {
    return activeClassQName;
  }

  if (activeClassQName) {
    const activeEntry = registry.classesByQName.get(activeClassQName);
    if (activeEntry?.className === normalizedClassName) {
      return activeClassQName;
    }

    const descendantMatch = findDescendantClassQName(
      registry,
      activeClassQName,
      normalizedClassName,
    );
    if (descendantMatch) {
      return descendantMatch;
    }
  }

  const qnames = registry.qnamesByClassName.get(normalizedClassName);
  return qnames?.[0];
}

export function resolveElementAttributes(
  registry: MJCFDefaultsRegistry,
  elementType: MJCFElementType,
  element: Element,
  activeClassQName?: string,
): MJCFAttributeMap {
  const resolvedAttributes: MJCFAttributeMap = {
    ...registry.root[elementType],
  };

  const explicitClassName = element.getAttribute('class')?.trim();
  const explicitClassQName = explicitClassName
    ? resolveDefaultClassQName(registry, explicitClassName, activeClassQName)
    : undefined;
  const classQNameToApply = explicitClassQName || activeClassQName;

  if (classQNameToApply) {
    const classEntry = registry.classesByQName.get(classQNameToApply);
    if (classEntry) {
      Object.assign(resolvedAttributes, classEntry.defaults[elementType]);
    }
  }

  for (const attribute of Array.from(element.attributes)) {
    resolvedAttributes[attribute.name] = attribute.value;
  }

  return resolvedAttributes;
}

export function parseMeshAssets(
  doc: Document,
  settings?: MJCFCompilerSettings,
  defaultsRegistry?: MJCFDefaultsRegistry,
): Map<string, MJCFMesh> {
  const meshMap = new Map<string, MJCFMesh>();
  const defaults = defaultsRegistry || parseMJCFDefaults(doc);
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return meshMap;
  }

  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  let meshIndex = 0;
  assetSections.forEach((assetEl) => {
    const meshes = assetEl.querySelectorAll(':scope > mesh');
    meshes.forEach((meshEl) => {
      const meshAttrs = resolveElementAttributes(defaults, 'mesh', meshEl);
      let name = meshEl.getAttribute('name') || meshAttrs.name;
      let file = meshEl.getAttribute('file') || meshAttrs.file;
      const vertex = meshEl.getAttribute('vertex') || meshAttrs.vertex;
      const vertices = parseNumbers(vertex || null);
      const hasInlineVertices = vertices.length >= 9;

      if (!file && !hasInlineVertices) {
        meshIndex += 1;
        return;
      }

      if (file && settings?.meshdir && !file.startsWith('/') && !file.includes(':')) {
        const prefix = settings.meshdir.endsWith('/') ? settings.meshdir : `${settings.meshdir}/`;
        file = `${prefix}${file}`;
      }

      if (!name) {
        name = file ? deriveAssetName(file, 'mesh', meshIndex) : `mesh_${meshIndex}`;
      }

      const scale = parseNumbers(meshAttrs.scale || null);
      const refpos = parseNumbers(meshAttrs.refpos || null);
      const refquat = parseQuatAsTuple(meshAttrs.refquat || null);
      const inertiaAttr = (meshAttrs.inertia || '').trim().toLowerCase();
      const inertia =
        inertiaAttr === 'shell' ||
        inertiaAttr === 'exact' ||
        inertiaAttr === 'convex' ||
        inertiaAttr === 'legacy'
          ? inertiaAttr
          : undefined;
      meshMap.set(name, {
        name,
        file: file || undefined,
        vertices: hasInlineVertices ? vertices : undefined,
        scale: scale.length >= 3 ? scale : undefined,
        refpos: refpos.length >= 3 ? [refpos[0] ?? 0, refpos[1] ?? 0, refpos[2] ?? 0] : undefined,
        refquat,
        inertia,
      });

      meshIndex += 1;
    });
  });

  return meshMap;
}

export function parseTextureAssets(
  doc: Document,
  settings?: MJCFCompilerSettings,
  defaultsRegistry?: MJCFDefaultsRegistry,
): Map<string, MJCFTexture> {
  const textureMap = new Map<string, MJCFTexture>();
  const defaults = defaultsRegistry || parseMJCFDefaults(doc);
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return textureMap;
  }

  let textureIndex = 0;
  const parseOptionalPositiveNumber = (value: string | null | undefined): number | undefined => {
    if (value == null || value.trim() === '') {
      return undefined;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  };
  const normalizeTextureFilePath = (filePath: string | null | undefined): string | undefined => {
    const normalizedPath = String(filePath || '').trim();
    if (!normalizedPath) {
      return undefined;
    }

    if (!settings?.texturedir || normalizedPath.startsWith('/') || normalizedPath.includes(':')) {
      return normalizedPath;
    }

    const prefix = settings.texturedir.endsWith('/')
      ? settings.texturedir
      : `${settings.texturedir}/`;
    return `${prefix}${normalizedPath}`;
  };
  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  assetSections.forEach((assetEl) => {
    const textures = assetEl.querySelectorAll(':scope > texture');
    textures.forEach((textureEl) => {
      const textureAttrs = resolveElementAttributes(defaults, 'texture', textureEl);
      const file = normalizeTextureFilePath(textureEl.getAttribute('file') || textureAttrs.file);
      const fileback = normalizeTextureFilePath(
        textureEl.getAttribute('fileback') || textureAttrs.fileback,
      );
      const filedown = normalizeTextureFilePath(
        textureEl.getAttribute('filedown') || textureAttrs.filedown,
      );
      const filefront = normalizeTextureFilePath(
        textureEl.getAttribute('filefront') || textureAttrs.filefront,
      );
      const fileleft = normalizeTextureFilePath(
        textureEl.getAttribute('fileleft') || textureAttrs.fileleft,
      );
      const fileright = normalizeTextureFilePath(
        textureEl.getAttribute('fileright') || textureAttrs.fileright,
      );
      const fileup = normalizeTextureFilePath(
        textureEl.getAttribute('fileup') || textureAttrs.fileup,
      );
      const builtin = textureEl.getAttribute('builtin') || textureAttrs.builtin || undefined;
      const type = textureEl.getAttribute('type') || textureAttrs.type || undefined;
      const rgb1 = parseNumbers(textureEl.getAttribute('rgb1') || textureAttrs.rgb1 || null);
      const rgb2 = parseNumbers(textureEl.getAttribute('rgb2') || textureAttrs.rgb2 || null);
      const mark = textureEl.getAttribute('mark') || textureAttrs.mark || undefined;
      const markrgb = parseNumbers(
        textureEl.getAttribute('markrgb') || textureAttrs.markrgb || null,
      );
      const width = parseOptionalPositiveNumber(
        textureEl.getAttribute('width') || textureAttrs.width || null,
      );
      const height = parseOptionalPositiveNumber(
        textureEl.getAttribute('height') || textureAttrs.height || null,
      );
      const explicitName = textureEl.getAttribute('name') || textureAttrs.name || undefined;

      const name =
        explicitName || (file ? deriveAssetName(file, 'texture', textureIndex) : undefined);
      if (!name) {
        textureIndex += 1;
        return;
      }

      textureMap.set(name, {
        name,
        ...(file ? { file } : {}),
        ...(fileback ? { fileback } : {}),
        ...(filedown ? { filedown } : {}),
        ...(filefront ? { filefront } : {}),
        ...(fileleft ? { fileleft } : {}),
        ...(fileright ? { fileright } : {}),
        ...(fileup ? { fileup } : {}),
        type,
        builtin,
        ...(rgb1.length > 0 ? { rgb1 } : {}),
        ...(rgb2.length > 0 ? { rgb2 } : {}),
        ...(mark ? { mark } : {}),
        ...(markrgb.length > 0 ? { markrgb } : {}),
        ...(width != null ? { width } : {}),
        ...(height != null ? { height } : {}),
      });

      textureIndex += 1;
    });
  });

  return textureMap;
}

export function parseHfieldAssets(doc: Document): Map<string, MJCFHfield> {
  const hfieldMap = new Map<string, MJCFHfield>();
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return hfieldMap;
  }

  let hfieldIndex = 0;
  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  assetSections.forEach((assetEl) => {
    const hfields = assetEl.querySelectorAll(':scope > hfield');
    hfields.forEach((hfieldEl) => {
      const name = hfieldEl.getAttribute('name') || `hfield_${hfieldIndex}`;
      const file = hfieldEl.getAttribute('file') || undefined;
      const contentType = hfieldEl.getAttribute('content_type') || undefined;
      const nrowAttr = hfieldEl.getAttribute('nrow');
      const ncolAttr = hfieldEl.getAttribute('ncol');
      const size = parseNumbers(hfieldEl.getAttribute('size'));
      const elevation = parseNumbers(hfieldEl.getAttribute('elevation'));

      hfieldMap.set(name, {
        name,
        file,
        contentType,
        nrow: nrowAttr != null ? parseInt(nrowAttr, 10) : undefined,
        ncol: ncolAttr != null ? parseInt(ncolAttr, 10) : undefined,
        size:
          size.length >= 4 ? [size[0] ?? 0, size[1] ?? 0, size[2] ?? 0, size[3] ?? 0] : undefined,
        elevation: elevation.length > 0 ? elevation : undefined,
      });

      hfieldIndex += 1;
    });
  });

  return hfieldMap;
}

export function parseMaterialAssets(
  doc: Document,
  defaultsRegistry?: MJCFDefaultsRegistry,
): Map<string, MJCFMaterial> {
  const materialMap = new Map<string, MJCFMaterial>();
  const defaults = defaultsRegistry || parseMJCFDefaults(doc);
  const mujocoEl = doc.querySelector('mujoco');
  if (!mujocoEl) {
    return materialMap;
  }

  const assetSections = mujocoEl.querySelectorAll(':scope > asset');
  assetSections.forEach((assetEl) => {
    const materials = assetEl.querySelectorAll(':scope > material');
    materials.forEach((materialEl) => {
      const materialAttrs = resolveElementAttributes(defaults, 'material', materialEl);
      const name = materialEl.getAttribute('name') || materialAttrs.name;
      if (!name) return;

      const rgba = parseNumbers(materialEl.getAttribute('rgba') || materialAttrs.rgba || null);
      const shininess = materialEl.getAttribute('shininess') || materialAttrs.shininess;
      const specular = materialEl.getAttribute('specular') || materialAttrs.specular;
      const reflectance = materialEl.getAttribute('reflectance') || materialAttrs.reflectance;
      const emission = materialEl.getAttribute('emission') || materialAttrs.emission;
      const texrepeat = parseNumbers(
        materialEl.getAttribute('texrepeat') || materialAttrs.texrepeat || null,
      );
      const texuniform = materialEl.getAttribute('texuniform') || materialAttrs.texuniform;
      const texture = materialEl.getAttribute('texture') || materialAttrs.texture;

      materialMap.set(name, {
        name,
        rgba: rgba.length >= 3 ? rgba : undefined,
        shininess: shininess != null ? parseFloat(shininess) : undefined,
        specular: specular != null ? parseFloat(specular) : undefined,
        reflectance: reflectance != null ? parseFloat(reflectance) : undefined,
        emission: emission != null ? parseFloat(emission) : undefined,
        texture: texture || undefined,
        texrepeat: texrepeat.length >= 2 ? texrepeat : undefined,
        texuniform:
          texuniform != null ? ['true', '1'].includes(texuniform.toLowerCase()) : undefined,
      });
    });
  });

  return materialMap;
}

export type {} from './mjcfUtilsHelpers';

export type { MJCFCompilerSettings, MJCFDefaultsRegistry } from './mjcfUtilsHelpers';
