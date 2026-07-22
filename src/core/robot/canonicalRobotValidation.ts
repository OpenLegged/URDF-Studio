export interface CanonicalRobotNestedValidationIssue {
  path: string;
  message: string;
}

type Issues = CanonicalRobotNestedValidationIssue[];

const VISUAL_KEYS = new Set([
  'name', 'type', 'dimensions', 'color', 'materialSource', 'authoredMaterials',
  'meshMaterialGroups', 'doubleSided', 'meshPath', 'usdMeshDescriptors', 'submeshName',
  'submeshCenter', 'assetRef', 'mjcfMesh', 'mjcfHfield', 'sdfHeightmap', 'polylinePoints',
  'polylineHeight', 'origin', 'verbose', 'visible',
]);
const AUTHORED_MATERIAL_KEYS = new Set([
  'name', 'color', 'colorRgba', 'texture', 'textureRotation', 'opacity', 'roughness',
  'metalness', 'emissive', 'emissiveIntensity', 'alphaTest', 'passes',
]);
const MATERIAL_PASS_KEYS = new Set(['texture', 'sceneBlend', 'depthWrite', 'lighting']);
const MESH_GROUP_KEYS = new Set(['meshKey', 'start', 'count', 'materialIndex']);
const USD_DESCRIPTOR_KEYS = new Set([
  'meshId', 'sectionName', 'resolvedPrimPath', 'primType', 'materialId',
]);
const MJCF_MESH_KEYS = new Set(['name', 'file', 'vertices', 'scale', 'refpos', 'refquat']);
const MJCF_HFIELD_KEYS = new Set([
  'name', 'file', 'contentType', 'nrow', 'ncol', 'size', 'elevation',
]);
const MJCF_HFIELD_SIZE_KEYS = new Set(['radiusX', 'radiusY', 'elevationZ', 'baseZ']);
const SDF_HEIGHTMAP_KEYS = new Set(['uri', 'size', 'pos', 'textures', 'blends']);
const SDF_TEXTURE_KEYS = new Set(['diffuse', 'normal', 'size']);
const SDF_BLEND_KEYS = new Set(['minHeight', 'fadeDist']);
const ROBOT_MATERIAL_KEYS = new Set(['color', 'colorRgba', 'texture', 'usdMaterial']);
const USD_STRING_KEYS = [
  'materialId', 'stageSourcePath', 'name', 'shaderPath', 'shaderName', 'shaderInfoId', 'colorSpace',
  'colorSource', 'authoredColorSpace', 'emissiveColorSpace', 'specularColorSpace',
  'attenuationColorSpace', 'sheenColorSpace', 'mapPath', 'emissiveMapPath',
  'roughnessMapPath', 'metalnessMapPath', 'normalMapPath', 'aoMapPath', 'alphaMapPath',
  'clearcoatMapPath', 'clearcoatRoughnessMapPath', 'clearcoatNormalMapPath',
  'specularColorMapPath', 'specularIntensityMapPath', 'transmissionMapPath',
  'thicknessMapPath', 'sheenColorMapPath', 'sheenRoughnessMapPath', 'anisotropyMapPath',
  'iridescenceMapPath', 'iridescenceThicknessMapPath',
] as const;
const USD_BOOLEAN_KEYS = [
  'isOmniPbr', 'opacityEnabled', 'opacityTextureEnabled', 'emissiveEnabled',
] as const;
const USD_NUMBER_KEYS = [
  'roughness', 'metalness', 'opacity', 'alphaTest', 'clearcoat', 'clearcoatRoughness',
  'specularIntensity', 'transmission', 'thickness', 'attenuationDistance', 'aoMapIntensity',
  'sheen', 'sheenRoughness', 'iridescence', 'iridescenceIOR', 'anisotropy',
  'anisotropyRotation', 'emissiveIntensity', 'ior',
] as const;
const USD_ARRAY_KEYS = [
  'color', 'authoredColor', 'emissive', 'specularColor', 'attenuationColor', 'sheenColor',
  'normalScale', 'clearcoatNormalScale',
] as const;
const USD_MATERIAL_KEYS = new Set<string>([
  ...USD_STRING_KEYS, ...USD_BOOLEAN_KEYS, ...USD_NUMBER_KEYS, ...USD_ARRAY_KEYS,
]);
const URDF_INSPECTION_KEYS = new Set([
  'diagnostics', 'diagnosticCounts', 'facts', 'omittedDiagnosticCount',
]);
const DIAGNOSTIC_KEYS = new Set([
  'code', 'severity', 'category', 'message', 'relatedIds', 'source',
]);
const DIAGNOSTIC_SOURCE_KEYS = new Set(['tag', 'name', 'attribute']);
const DIAGNOSTIC_SEVERITIES = new Set(['info', 'warning', 'error']);
const DIAGNOSTIC_CATEGORIES = new Set([
  'source', 'topology', 'joint', 'geometry', 'material', 'physical', 'simulation',
]);
const URDF_FACT_KEYS = [
  'linkCount', 'jointCount', 'visualCount', 'collisionCount', 'inertialCount',
  'materialCount', 'meshCount', 'syntheticParentLinkCount', 'disconnectedRootCount',
] as const;
const CLOSED_LOOP_BASE_KEYS = [
  'id', 'type', 'linkAId', 'linkBId', 'anchorWorld', 'anchorLocalA', 'anchorLocalB', 'source',
] as const;
const CLOSED_LOOP_SOURCE_KEYS = new Set(['format', 'body1Name', 'body2Name']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function issue(issues: Issues, path: string, message: string): void {
  issues.push({ path, message });
}

function allowed(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
  path: string,
  issues: Issues,
): void {
  Object.keys(value).forEach((key) => {
    if (!keys.has(key)) issue(issues, `${path}.${key}`, 'is not a canonical RobotData field');
  });
}

function optionalString(
  value: unknown,
  path: string,
  issues: Issues,
  nullable = false,
): void {
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'string') issue(issues, path, nullable ? 'must be a string or null' : 'must be a string');
}

function optionalBoolean(
  value: unknown,
  path: string,
  issues: Issues,
  nullable = false,
): void {
  if (value === undefined || (nullable && value === null)) return;
  if (typeof value !== 'boolean') issue(issues, path, nullable ? 'must be a boolean or null' : 'must be a boolean');
}

function finite(value: unknown, path: string, issues: Issues): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) issue(issues, path, 'must be a finite number');
}

function optionalFinite(
  value: unknown,
  path: string,
  issues: Issues,
  nullable = false,
): void {
  if (value === undefined || (nullable && value === null)) return;
  finite(value, path, issues);
}

function integer(value: unknown, path: string, issues: Issues, nonNegative = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    issue(issues, path, 'must be a finite integer');
  } else if (nonNegative && value < 0) {
    issue(issues, path, 'must not be negative');
  }
}

function finiteArray({
  value,
  path,
  issues,
  expectedLength,
  allowTypedArray = false,
  nullable = false,
}: {
  value: unknown;
  path: string;
  issues: Issues;
  expectedLength?: number;
  allowTypedArray?: boolean;
  nullable?: boolean;
}): void {
  if (nullable && value === null) return;
  const typed = allowTypedArray && ArrayBuffer.isView(value) && !(value instanceof DataView);
  if (!Array.isArray(value) && !typed) {
    issue(issues, path, nullable ? 'must be a numeric array or null' : 'must be an array');
    return;
  }
  const values = Array.from(value as ArrayLike<unknown>);
  if (expectedLength !== undefined && values.length !== expectedLength) {
    issue(issues, path, `must contain exactly ${expectedLength} numbers`);
  }
  values.forEach((entry, index) => finite(entry, `${path}.${index}`, issues));
}

function vector3(value: unknown, path: string, issues: Issues): void {
  if (!isRecord(value)) {
    issue(issues, path, 'must be an object');
    return;
  }
  for (const field of ['x', 'y', 'z'] as const) finite(value[field], `${path}.${field}`, issues);
}

export function validateCanonicalClosedLoopConstraints({
  value,
  links,
  path,
  issues,
}: {
  value: unknown;
  links: Record<string, Record<string, unknown>> | null;
  path: string;
  issues: Issues;
}): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue(issues, path, 'must be an array');
    return;
  }
  const ids = new Set<string>();
  value.forEach((constraint, index) => {
    const constraintPath = `${path}.${index}`;
    if (!isRecord(constraint)) {
      issue(issues, constraintPath, 'must be a closed-loop constraint');
      return;
    }
    if (typeof constraint.id !== 'string' || !constraint.id.trim()) {
      issue(issues, `${constraintPath}.id`, 'must be a non-empty string');
    } else if (ids.has(constraint.id)) {
      issue(issues, `${constraintPath}.id`, `duplicates constraint id "${constraint.id}"`);
    } else {
      ids.add(constraint.id);
    }
    for (const endpoint of ['linkAId', 'linkBId'] as const) {
      const linkId = constraint[endpoint];
      if (typeof linkId !== 'string' || !links?.[linkId]) {
        issue(
          issues,
          `${constraintPath}.${endpoint}`,
          `references missing source-local link "${String(linkId)}"`,
        );
      }
    }
    if (constraint.type !== 'connect' && constraint.type !== 'distance') {
      issue(issues, `${constraintPath}.type`, 'must be connect or distance');
    }
    allowed(
      constraint,
      new Set(
        constraint.type === 'distance'
          ? [...CLOSED_LOOP_BASE_KEYS, 'restDistance']
          : CLOSED_LOOP_BASE_KEYS,
      ),
      constraintPath,
      issues,
    );
    for (const anchor of ['anchorWorld', 'anchorLocalA', 'anchorLocalB'] as const) {
      vector3(constraint[anchor], `${constraintPath}.${anchor}`, issues);
    }
    if (constraint.type === 'distance') {
      finite(constraint.restDistance, `${constraintPath}.restDistance`, issues);
    }
    if (constraint.source !== undefined) {
      const sourcePath = `${constraintPath}.source`;
      if (!isRecord(constraint.source)) {
        issue(issues, sourcePath, 'must be a closed-loop source object');
      } else {
        allowed(constraint.source, CLOSED_LOOP_SOURCE_KEYS, sourcePath, issues);
        if (constraint.source.format !== 'mjcf') {
          issue(issues, `${sourcePath}.format`, 'must be mjcf');
        }
        for (const field of ['body1Name', 'body2Name'] as const) {
          if (typeof constraint.source[field] !== 'string' || !constraint.source[field].trim()) {
            issue(issues, `${sourcePath}.${field}`, 'must be a non-empty string');
          }
        }
      }
    }
  });
}

function validateAuthoredMaterial(value: unknown, path: string, issues: Issues): void {
  if (!isRecord(value)) {
    issue(issues, path, 'must be an authored material object');
    return;
  }
  allowed(value, AUTHORED_MATERIAL_KEYS, path, issues);
  for (const field of ['name', 'color', 'texture', 'emissive'] as const) {
    optionalString(value[field], `${path}.${field}`, issues);
  }
  if (value.colorRgba !== undefined) {
    finiteArray({
      value: value.colorRgba,
      path: `${path}.colorRgba`,
      issues,
      expectedLength: 4,
    });
  }
  for (const field of [
    'textureRotation', 'opacity', 'roughness', 'metalness', 'emissiveIntensity', 'alphaTest',
  ] as const) {
    optionalFinite(value[field], `${path}.${field}`, issues);
  }
  if (value.passes === undefined) return;
  if (!Array.isArray(value.passes)) {
    issue(issues, `${path}.passes`, 'must be an array');
    return;
  }
  value.passes.forEach((pass, index) => {
    const passPath = `${path}.passes.${index}`;
    if (!isRecord(pass)) {
      issue(issues, passPath, 'must be a material pass object');
      return;
    }
    allowed(pass, MATERIAL_PASS_KEYS, passPath, issues);
    optionalString(pass.texture, `${passPath}.texture`, issues);
    if (
      pass.sceneBlend !== undefined
      && pass.sceneBlend !== 'alpha_blend'
      && pass.sceneBlend !== 'add'
      && pass.sceneBlend !== 'modulate'
    ) {
      issue(issues, `${passPath}.sceneBlend`, 'must be alpha_blend, add, or modulate');
    }
    optionalBoolean(pass.depthWrite, `${passPath}.depthWrite`, issues);
    optionalBoolean(pass.lighting, `${passPath}.lighting`, issues);
  });
}

function validateAuthoredMaterials(value: unknown, path: string, issues: Issues): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue(issues, path, 'must be an array');
    return;
  }
  value.forEach((material, index) => validateAuthoredMaterial(material, `${path}.${index}`, issues));
}

function validateMeshGroups(value: unknown, path: string, issues: Issues): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue(issues, path, 'must be an array');
    return;
  }
  value.forEach((group, index) => {
    const groupPath = `${path}.${index}`;
    if (!isRecord(group)) {
      issue(issues, groupPath, 'must be a mesh material group object');
      return;
    }
    allowed(group, MESH_GROUP_KEYS, groupPath, issues);
    if (typeof group.meshKey !== 'string' || !group.meshKey.trim()) {
      issue(issues, `${groupPath}.meshKey`, 'must be a non-empty string');
    }
    for (const field of ['start', 'count', 'materialIndex'] as const) {
      integer(group[field], `${groupPath}.${field}`, issues, true);
    }
  });
}

function validateUsdDescriptors(value: unknown, path: string, issues: Issues): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue(issues, path, 'must be an array');
    return;
  }
  value.forEach((descriptor, index) => {
    const descriptorPath = `${path}.${index}`;
    if (!isRecord(descriptor)) {
      issue(issues, descriptorPath, 'must be a USD mesh descriptor reference');
      return;
    }
    allowed(descriptor, USD_DESCRIPTOR_KEYS, descriptorPath, issues);
    USD_DESCRIPTOR_KEYS.forEach((field) =>
      optionalString(descriptor[field], `${descriptorPath}.${field}`, issues, true)
    );
  });
}

function validateMjcfMesh(value: unknown, path: string, issues: Issues): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, path, 'must be an MJCF mesh asset');
    return;
  }
  allowed(value, MJCF_MESH_KEYS, path, issues);
  optionalString(value.name, `${path}.name`, issues);
  optionalString(value.file, `${path}.file`, issues);
  if (value.vertices !== undefined) {
    finiteArray({ value: value.vertices, path: `${path}.vertices`, issues });
  }
  for (const [field, length] of [['scale', 3], ['refpos', 3], ['refquat', 4]] as const) {
    if (value[field] !== undefined) {
      finiteArray({
        value: value[field],
        path: `${path}.${field}`,
        issues,
        expectedLength: length,
      });
    }
  }
}

function validateMjcfHfield(value: unknown, path: string, issues: Issues): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, path, 'must be an MJCF heightfield asset');
    return;
  }
  allowed(value, MJCF_HFIELD_KEYS, path, issues);
  for (const field of ['name', 'file', 'contentType'] as const) {
    optionalString(value[field], `${path}.${field}`, issues);
  }
  for (const field of ['nrow', 'ncol'] as const) {
    if (value[field] !== undefined) integer(value[field], `${path}.${field}`, issues);
  }
  if (value.size !== undefined) {
    if (!isRecord(value.size)) {
      issue(issues, `${path}.size`, 'must be an MJCF heightfield size');
    } else {
      const size = value.size;
      allowed(size, MJCF_HFIELD_SIZE_KEYS, `${path}.size`, issues);
      MJCF_HFIELD_SIZE_KEYS.forEach((field) => finite(size[field], `${path}.size.${field}`, issues));
    }
  }
  if (value.elevation !== undefined) {
    finiteArray({ value: value.elevation, path: `${path}.elevation`, issues });
  }
}

function validateSdfHeightmap(value: unknown, path: string, issues: Issues): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, path, 'must be an SDF heightmap');
    return;
  }
  allowed(value, SDF_HEIGHTMAP_KEYS, path, issues);
  if (typeof value.uri !== 'string' || !value.uri.trim()) issue(issues, `${path}.uri`, 'must be a non-empty string');
  vector3(value.size, `${path}.size`, issues);
  vector3(value.pos, `${path}.pos`, issues);
  if (!Array.isArray(value.textures)) {
    issue(issues, `${path}.textures`, 'must be an array');
  } else {
    value.textures.forEach((texture, index) => {
      const texturePath = `${path}.textures.${index}`;
      if (!isRecord(texture)) {
        issue(issues, texturePath, 'must be an SDF heightmap texture');
        return;
      }
      allowed(texture, SDF_TEXTURE_KEYS, texturePath, issues);
      optionalString(texture.diffuse, `${texturePath}.diffuse`, issues);
      optionalString(texture.normal, `${texturePath}.normal`, issues);
      optionalFinite(texture.size, `${texturePath}.size`, issues);
    });
  }
  if (!Array.isArray(value.blends)) {
    issue(issues, `${path}.blends`, 'must be an array');
  } else {
    value.blends.forEach((blend, index) => {
      const blendPath = `${path}.blends.${index}`;
      if (!isRecord(blend)) {
        issue(issues, blendPath, 'must be an SDF heightmap blend');
        return;
      }
      allowed(blend, SDF_BLEND_KEYS, blendPath, issues);
      finite(blend.minHeight, `${blendPath}.minHeight`, issues);
      finite(blend.fadeDist, `${blendPath}.fadeDist`, issues);
    });
  }
}

function validatePolyline(value: unknown, path: string, issues: Issues): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue(issues, path, 'must be an array');
    return;
  }
  value.forEach((point, index) => {
    const pointPath = `${path}.${index}`;
    if (!isRecord(point)) {
      issue(issues, pointPath, 'must be a 2D point');
      return;
    }
    finite(point.x, `${pointPath}.x`, issues);
    finite(point.y, `${pointPath}.y`, issues);
  });
}

export function validateCanonicalVisualGeometryNested(
  value: Record<string, unknown>,
  path: string,
  issues: Issues,
): void {
  allowed(value, VISUAL_KEYS, path, issues);
  optionalString(value.name, `${path}.name`, issues);
  if (
    value.materialSource !== undefined
    && value.materialSource !== 'inline'
    && value.materialSource !== 'named'
    && value.materialSource !== 'gazebo'
  ) {
    issue(issues, `${path}.materialSource`, 'must be inline, named, or gazebo');
  }
  validateAuthoredMaterials(value.authoredMaterials, `${path}.authoredMaterials`, issues);
  validateMeshGroups(value.meshMaterialGroups, `${path}.meshMaterialGroups`, issues);
  optionalBoolean(value.doubleSided, `${path}.doubleSided`, issues);
  for (const field of ['meshPath', 'submeshName', 'assetRef', 'verbose'] as const) {
    optionalString(value[field], `${path}.${field}`, issues);
  }
  validateUsdDescriptors(value.usdMeshDescriptors, `${path}.usdMeshDescriptors`, issues);
  optionalBoolean(value.submeshCenter, `${path}.submeshCenter`, issues);
  validateMjcfMesh(value.mjcfMesh, `${path}.mjcfMesh`, issues);
  validateMjcfHfield(value.mjcfHfield, `${path}.mjcfHfield`, issues);
  validateSdfHeightmap(value.sdfHeightmap, `${path}.sdfHeightmap`, issues);
  validatePolyline(value.polylinePoints, `${path}.polylinePoints`, issues);
  optionalFinite(value.polylineHeight, `${path}.polylineHeight`, issues);
}

function validateUsdMaterial(value: unknown, path: string, issues: Issues): void {
  if (value === null) return;
  if (!isRecord(value)) {
    issue(issues, path, 'must be a USD material object or null');
    return;
  }
  allowed(value, USD_MATERIAL_KEYS, path, issues);
  USD_STRING_KEYS.forEach((field) => optionalString(value[field], `${path}.${field}`, issues, true));
  USD_BOOLEAN_KEYS.forEach((field) => optionalBoolean(value[field], `${path}.${field}`, issues, true));
  USD_NUMBER_KEYS.forEach((field) => optionalFinite(value[field], `${path}.${field}`, issues, true));
  USD_ARRAY_KEYS.forEach((field) => {
    if (value[field] !== undefined) {
      finiteArray({
        value: value[field],
        path: `${path}.${field}`,
        issues,
        allowTypedArray: true,
        nullable: true,
      });
    }
  });
}

export function validateCanonicalRobotMaterials(
  value: unknown,
  path: string,
  issues: Issues,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, path, 'must be a material map');
    return;
  }
  Object.entries(value).forEach(([materialId, material]) => {
    const materialPath = `${path}.${materialId}`;
    if (!materialId.trim()) issue(issues, materialPath, 'must use a non-empty key');
    if (!isRecord(material)) {
      issue(issues, materialPath, 'must be a robot material object');
      return;
    }
    allowed(material, ROBOT_MATERIAL_KEYS, materialPath, issues);
    optionalString(material.color, `${materialPath}.color`, issues);
    if (material.colorRgba !== undefined) {
      finiteArray({
        value: material.colorRgba,
        path: `${materialPath}.colorRgba`,
        issues,
        expectedLength: 4,
      });
    }
    optionalString(material.texture, `${materialPath}.texture`, issues);
    if (material.usdMaterial !== undefined) validateUsdMaterial(material.usdMaterial, `${materialPath}.usdMaterial`, issues);
  });
}

function stringArray(value: unknown, path: string, issues: Issues): void {
  if (!Array.isArray(value)) {
    issue(issues, path, 'must be an array');
    return;
  }
  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !entry.trim()) issue(issues, `${path}.${index}`, 'must be a non-empty string');
  });
}

export function validateCanonicalUrdfInspection(
  value: unknown,
  path: string,
  issues: Issues,
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    issue(issues, path, 'must be a URDF inspection object');
    return;
  }
  allowed(value, URDF_INSPECTION_KEYS, path, issues);
  if (!Array.isArray(value.diagnostics)) {
    issue(issues, `${path}.diagnostics`, 'must be an array');
  } else {
    value.diagnostics.forEach((diagnostic, index) => {
      const diagnosticPath = `${path}.diagnostics.${index}`;
      if (!isRecord(diagnostic)) {
        issue(issues, diagnosticPath, 'must be a source diagnostic object');
        return;
      }
      allowed(diagnostic, DIAGNOSTIC_KEYS, diagnosticPath, issues);
      for (const field of ['code', 'message'] as const) {
        if (typeof diagnostic[field] !== 'string' || !diagnostic[field].trim()) {
          issue(issues, `${diagnosticPath}.${field}`, 'must be a non-empty string');
        }
      }
      if (typeof diagnostic.severity !== 'string' || !DIAGNOSTIC_SEVERITIES.has(diagnostic.severity)) {
        issue(issues, `${diagnosticPath}.severity`, 'must be info, warning, or error');
      }
      if (typeof diagnostic.category !== 'string' || !DIAGNOSTIC_CATEGORIES.has(diagnostic.category)) {
        issue(issues, `${diagnosticPath}.category`, 'must be a supported diagnostic category');
      }
      if (diagnostic.relatedIds !== undefined) stringArray(diagnostic.relatedIds, `${diagnosticPath}.relatedIds`, issues);
      if (diagnostic.source !== undefined) {
        if (!isRecord(diagnostic.source)) {
          issue(issues, `${diagnosticPath}.source`, 'must be a diagnostic source object');
        } else {
          const source = diagnostic.source;
          allowed(source, DIAGNOSTIC_SOURCE_KEYS, `${diagnosticPath}.source`, issues);
          DIAGNOSTIC_SOURCE_KEYS.forEach((field) => optionalString(source[field], `${diagnosticPath}.source.${field}`, issues));
        }
      }
    });
  }
  if (!isRecord(value.diagnosticCounts)) {
    issue(issues, `${path}.diagnosticCounts`, 'must be a diagnostic count object');
  } else {
    const counts = value.diagnosticCounts;
    allowed(counts, DIAGNOSTIC_SEVERITIES, `${path}.diagnosticCounts`, issues);
    DIAGNOSTIC_SEVERITIES.forEach((severity) => integer(counts[severity], `${path}.diagnosticCounts.${severity}`, issues, true));
  }
  if (!isRecord(value.facts)) {
    issue(issues, `${path}.facts`, 'must be a URDF fact object');
  } else {
    const facts = value.facts;
    allowed(facts, new Set(URDF_FACT_KEYS), `${path}.facts`, issues);
    URDF_FACT_KEYS.forEach((field) => integer(facts[field], `${path}.facts.${field}`, issues, true));
  }
  if (value.omittedDiagnosticCount !== undefined) {
    integer(value.omittedDiagnosticCount, `${path}.omittedDiagnosticCount`, issues, true);
  }
}
