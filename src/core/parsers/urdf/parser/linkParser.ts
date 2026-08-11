import {
  UrdfLink,
  GeometryType,
  type UrdfInertial,
  type UrdfOrigin,
  type UrdfVisual,
  type UrdfVisualMaterial,
} from '@/types';
import { DEFAULT_LINK } from '@/types/constants';
import { parseOrigin, parseColorDefinition, parseTexture } from './utils';
import { parseGeometry } from './geometry';
import { addUrdfRecoveryDiagnostic, type UrdfRecoveryDiagnostics } from './recovery';

interface ParsedMaterialDefinition {
  color?: string;
  colorRgba?: [number, number, number, number];
  texture?: string;
}

interface ParsedVisualGeometry {
  geometry: UrdfLink['visual'];
  material?: ParsedMaterialDefinition;
}

const INERTIA_ATTRIBUTES = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'] as const;

function createEmptyGeometry(defaultGeometry: UrdfVisual): UrdfVisual {
  return {
    ...defaultGeometry,
    type: GeometryType.NONE,
    dimensions: { x: 0, y: 0, z: 0 },
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

function hasFiniteVector(rawValue: string | null, expectedLength: number): boolean {
  if (!rawValue?.trim()) return true;
  const values = rawValue.trim().split(/\s+/).map(Number);
  return values.length === expectedLength && values.every(Number.isFinite);
}

function parseOriginWithRecovery(
  originEl: Element | undefined,
  recoveryDiagnostics: UrdfRecoveryDiagnostics | undefined,
  owner: 'visual' | 'collision' | 'inertial',
  linkName: string,
): UrdfOrigin {
  for (const attribute of ['xyz', 'rpy'] as const) {
    if (originEl?.hasAttribute(attribute) && !hasFiniteVector(originEl.getAttribute(attribute), 3)) {
      addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
        code: `urdf_${owner}_origin_${attribute}_defaulted`,
        category: owner === 'inertial' ? 'physical' : 'geometry',
        message: `Link "${linkName}" ${owner} origin ${attribute} was invalid and its unusable values were defaulted to 0.`,
        action: 'defaulted',
        tag: 'origin',
        name: linkName,
        attribute,
        relatedIds: [linkName],
      });
    }
  }
  return parseOrigin(originEl);
}

function isUsableGeometry(geometry: UrdfVisual): boolean {
  const dimensions = geometry.dimensions;
  const finiteDimensions = Object.values(dimensions).every(Number.isFinite);
  if (!finiteDimensions) return false;

  switch (geometry.type) {
    case GeometryType.BOX:
      return dimensions.x > 0 && dimensions.y > 0 && dimensions.z > 0;
    case GeometryType.CYLINDER:
    case GeometryType.CAPSULE:
      return dimensions.x > 0 && dimensions.y > 0;
    case GeometryType.SPHERE:
      return dimensions.x > 0;
    case GeometryType.MESH:
      return Boolean(geometry.meshPath?.trim())
        && dimensions.x !== 0
        && dimensions.y !== 0
        && dimensions.z !== 0;
    default:
      return geometry.type !== GeometryType.NONE;
  }
}

function describeGeometryTag(geometryEl: Element | undefined): string {
  return Array.from(geometryEl?.children ?? [])[0]?.tagName || 'geometry';
}

function resolveMaterialDefinition(
  materialEl: Element,
  globalMaterials: Record<string, ParsedMaterialDefinition>,
): ParsedMaterialDefinition & { name?: string } {
  const inlineColorDefinition = parseColorDefinition(materialEl);
  const inlineTexture = parseTexture(materialEl);
  const materialName = materialEl.getAttribute('name')?.trim() || undefined;
  const namedMaterial = materialName ? globalMaterials[materialName] : undefined;

  return {
    ...(materialName ? { name: materialName } : {}),
    ...(namedMaterial?.color || inlineColorDefinition?.color
      ? { color: namedMaterial?.color || inlineColorDefinition?.color }
      : {}),
    ...(namedMaterial?.colorRgba || inlineColorDefinition?.colorRgba
      ? { colorRgba: namedMaterial?.colorRgba || inlineColorDefinition?.colorRgba }
      : {}),
    ...(namedMaterial?.texture || inlineTexture
      ? { texture: namedMaterial?.texture || inlineTexture }
      : {}),
  };
}

function parseAuthoredMaterials(
  materialEls: Element[],
  globalMaterials: Record<string, ParsedMaterialDefinition>,
): UrdfVisualMaterial[] | undefined {
  const authoredMaterials = materialEls
    .map((materialEl) => resolveMaterialDefinition(materialEl, globalMaterials))
    .filter((material) =>
      Boolean(material.name || material.color || material.colorRgba || material.texture),
    );

  return authoredMaterials.length > 0 ? authoredMaterials : undefined;
}

function getDirectChildElements(parent: Element, tagName: string): Element[] {
  return Array.from(parent.children).filter((child): child is Element => child.tagName === tagName);
}

function parseVisualElement(
  visualEl: Element,
  globalMaterials: Record<string, ParsedMaterialDefinition>,
  linkGazeboMaterial?: string,
  recoveryDiagnostics?: UrdfRecoveryDiagnostics,
  linkName = '<unnamed>',
): ParsedVisualGeometry | null {
  const visualOriginEl = getDirectChildElements(visualEl, 'origin')[0];
  const geometryEl = getDirectChildElements(visualEl, 'geometry')[0];
  const visualGeo = geometryEl ? parseGeometry(geometryEl, DEFAULT_LINK.visual) : null;
  if (!visualGeo || !isUsableGeometry(visualGeo)) {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_visual_geometry_downgraded',
      category: 'geometry',
      message: `Link "${linkName}" had an unusable ${describeGeometryTag(geometryEl)} visual, so only that visual was disabled.`,
      action: 'downgraded',
      tag: 'visual',
      name: visualEl.getAttribute('name')?.trim() || linkName,
      relatedIds: [linkName],
    });
    return null;
  }

  const materialEls = getDirectChildElements(visualEl, 'material');
  const hasMultipleMeshMaterials = visualGeo.type === GeometryType.MESH && materialEls.length > 1;
  let authoredMaterials: UrdfVisualMaterial[] | undefined;

  let visualColor: string | undefined;
  let visualColorRgba: [number, number, number, number] | undefined;
  let visualTexture: string | undefined;
  let materialSource: 'inline' | 'named' | 'gazebo' | undefined;
  let singleAuthoredMaterials: UrdfVisualMaterial[] | undefined;

  try {
    if (hasMultipleMeshMaterials) {
      authoredMaterials = parseAuthoredMaterials(materialEls, globalMaterials);
    } else {
      const materialEl = materialEls[0] ?? null;
      const resolvedMaterial = materialEl
        ? resolveMaterialDefinition(materialEl, globalMaterials)
        : {};
      singleAuthoredMaterials = materialEl
        ? parseAuthoredMaterials([materialEl], globalMaterials)
        : undefined;

      if (resolvedMaterial.name && globalMaterials[resolvedMaterial.name]) {
        visualColor = resolvedMaterial.color;
        visualColorRgba = resolvedMaterial.colorRgba;
        visualTexture = resolvedMaterial.texture;
        materialSource = 'named';
      } else {
        visualColor = resolvedMaterial.color;
        visualColorRgba = resolvedMaterial.colorRgba;
        visualTexture = resolvedMaterial.texture;
        if (visualColor || visualTexture) {
          materialSource = 'inline';
        } else if (resolvedMaterial.name) {
          addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
            code: 'urdf_visual_material_omitted',
            category: 'material',
            message: `Link "${linkName}" referenced unusable material "${resolvedMaterial.name}", so the visual kept its geometry without that material.`,
            action: 'omitted',
            tag: 'material',
            name: resolvedMaterial.name,
            relatedIds: [linkName, resolvedMaterial.name],
          });
        }
      }
    }
  } catch {
    authoredMaterials = undefined;
    singleAuthoredMaterials = undefined;
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_visual_material_omitted',
      category: 'material',
      message: `Link "${linkName}" had unreadable visual material data, so its geometry was kept without that material.`,
      action: 'omitted',
      tag: 'material',
      name: linkName,
      relatedIds: [linkName],
    });
  }

  if (!visualColor && linkGazeboMaterial) {
    visualColor = linkGazeboMaterial;
    materialSource = 'gazebo';
  }

  return {
    geometry: {
      ...DEFAULT_LINK.visual,
      name: visualEl.getAttribute('name')?.trim() || undefined,
      ...visualGeo,
      origin: parseOriginWithRecovery(
        visualOriginEl,
        recoveryDiagnostics,
        'visual',
        linkName,
      ),
      color: visualColor,
      ...(authoredMaterials || singleAuthoredMaterials
        ? { authoredMaterials: authoredMaterials || singleAuthoredMaterials }
        : {}),
      materialSource,
    },
    material:
      visualColor || visualColorRgba || visualTexture
        ? {
            ...(visualColor ? { color: visualColor } : {}),
            ...(visualColorRgba ? { colorRgba: visualColorRgba } : {}),
            ...(visualTexture ? { texture: visualTexture } : {}),
          }
        : undefined,
  };
}

function parseCollisionElement(
  collisionEl: Element,
  linkName: string,
  recoveryDiagnostics?: UrdfRecoveryDiagnostics,
): UrdfLink['collision'] | null {
  const geometryEl = getDirectChildElements(collisionEl, 'geometry')[0];
  const geometry = geometryEl ? parseGeometry(geometryEl, DEFAULT_LINK.collision) : null;
  if (!geometry || !isUsableGeometry(geometry)) {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_collision_geometry_downgraded',
      category: 'geometry',
      message: `Link "${linkName}" had an unusable ${describeGeometryTag(geometryEl)} collision, so only that collision was disabled.`,
      action: 'downgraded',
      tag: 'collision',
      name: collisionEl.getAttribute('name')?.trim() || linkName,
      relatedIds: [linkName],
    });
    return null;
  }

  const originEl = getDirectChildElements(collisionEl, 'origin')[0];
  const verboseEl = getDirectChildElements(collisionEl, 'verbose')[0];
  return {
    ...DEFAULT_LINK.collision,
    name: collisionEl.getAttribute('name')?.trim() || undefined,
    verbose: verboseEl?.getAttribute('value')?.trim() || undefined,
    ...geometry,
    origin: parseOriginWithRecovery(
      originEl,
      recoveryDiagnostics,
      'collision',
      linkName,
    ),
  };
}

function parseInertialElement(
  inertialEl: Element,
  linkName: string,
  recoveryDiagnostics?: UrdfRecoveryDiagnostics,
): UrdfInertial | undefined {
  try {
    const massEl = getDirectChildElements(inertialEl, 'mass')[0];
    const inertiaEl = getDirectChildElements(inertialEl, 'inertia')[0];
    const mass = Number.parseFloat(massEl?.getAttribute('value') ?? '');
    const inertiaValues = Object.fromEntries(
      INERTIA_ATTRIBUTES.map((attribute) => [
        attribute,
        Number.parseFloat(inertiaEl?.getAttribute(attribute) ?? ''),
      ]),
    ) as UrdfInertial['inertia'];
    const hasUsableMass = Number.isFinite(mass) && mass > 0;
    const hasUsableInertia = INERTIA_ATTRIBUTES.every((attribute) =>
      Number.isFinite(inertiaValues[attribute]));

    if (!hasUsableMass || !hasUsableInertia) {
      addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
        code: 'urdf_inertial_omitted',
        category: 'physical',
        message: `Link "${linkName}" had incomplete or non-finite inertial data, so only its inertial block was omitted.`,
        action: 'omitted',
        tag: 'inertial',
        name: linkName,
        relatedIds: [linkName],
      });
      return undefined;
    }

    return {
      mass,
      origin: getDirectChildElements(inertialEl, 'origin')[0]
        ? parseOriginWithRecovery(
            getDirectChildElements(inertialEl, 'origin')[0],
            recoveryDiagnostics,
            'inertial',
            linkName,
          )
        : undefined,
      inertia: inertiaValues,
    };
  } catch {
    addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
      code: 'urdf_inertial_omitted',
      category: 'physical',
      message: `Link "${linkName}" inertial data could not be read and was omitted.`,
      action: 'omitted',
      tag: 'inertial',
      name: linkName,
      relatedIds: [linkName],
    });
    return undefined;
  }
}

export const parseLinks = (
  robotEl: Element,
  globalMaterials: Record<string, ParsedMaterialDefinition>,
  linkGazeboMaterials: Record<string, string>,
  recoveryDiagnostics?: UrdfRecoveryDiagnostics,
) => {
  const links: Record<string, UrdfLink> = {};
  const extraJoints: any[] = []; // Reserved for backward compatibility
  const linkMaterials: Record<string, ParsedMaterialDefinition> = {};

  Array.from(robotEl.children).forEach((child) => {
    if (child.tagName !== 'link') return;
    const linkEl = child;
    const linkName = linkEl.getAttribute('name')?.trim();
    if (!linkName) {
      addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
        code: 'urdf_unnamed_link_omitted',
        category: 'topology',
        message: 'A link without a usable name was omitted.',
        action: 'omitted',
        tag: 'link',
        attribute: 'name',
      });
      return;
    }

    try {
      const id = linkName;
      const linkType = linkEl.getAttribute('type')?.trim() || undefined;

      const parsedVisuals = getDirectChildElements(linkEl, 'visual')
        .map((visualEl) => {
          try {
            return parseVisualElement(
              visualEl,
              globalMaterials,
              linkGazeboMaterials[linkName],
              recoveryDiagnostics,
              linkName,
            );
          } catch {
            addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
              code: 'urdf_visual_omitted',
              category: 'geometry',
              message: `An unreadable visual on link "${linkName}" was omitted.`,
              action: 'omitted',
              tag: 'visual',
              name: visualEl.getAttribute('name')?.trim() || linkName,
              relatedIds: [linkName],
            });
            return null;
          }
        })
        .filter((visual): visual is ParsedVisualGeometry => visual !== null);
      const primaryVisual = parsedVisuals[0]?.geometry ?? createEmptyGeometry(DEFAULT_LINK.visual);
      const visualBodies = parsedVisuals.slice(1).map((visual) => visual.geometry);
      const primaryVisualMaterial = parsedVisuals[0]?.material;

      const parsedCollisions = getDirectChildElements(linkEl, 'collision')
        .map((collisionEl) => {
          try {
            return parseCollisionElement(collisionEl, linkName, recoveryDiagnostics);
          } catch {
            addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
              code: 'urdf_collision_omitted',
              category: 'geometry',
              message: `An unreadable collision on link "${linkName}" was omitted.`,
              action: 'omitted',
              tag: 'collision',
              name: collisionEl.getAttribute('name')?.trim() || linkName,
              relatedIds: [linkName],
            });
            return null;
          }
        })
        .filter((collision): collision is UrdfLink['collision'] => collision !== null);

      const inertialEls = getDirectChildElements(linkEl, 'inertial');
      if (inertialEls.length > 1) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_extra_inertial_omitted',
          category: 'physical',
          message: `Link "${linkName}" had multiple inertial blocks; only the first usable block was kept.`,
          action: 'omitted',
          tag: 'inertial',
          name: linkName,
          relatedIds: [linkName],
        });
      }
      const inertial = inertialEls[0]
        ? parseInertialElement(inertialEls[0], linkName, recoveryDiagnostics)
        : undefined;

      if (links[id]) {
        addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
          code: 'urdf_duplicate_link_omitted',
          category: 'topology',
          message: `An earlier link named "${linkName}" was replaced by the later definition.`,
          action: 'omitted',
          tag: 'link',
          name: linkName,
          relatedIds: [linkName],
        });
      }

      links[id] = {
        id,
        name: linkName,
        type: linkType,
        visual: primaryVisual,
        visualBodies,
        collision: parsedCollisions[0] ?? createEmptyGeometry(DEFAULT_LINK.collision),
        collisionBodies: parsedCollisions.slice(1),
        inertial,
      };

      if (primaryVisualMaterial) {
        linkMaterials[id] = primaryVisualMaterial;
      } else {
        delete linkMaterials[id];
      }
    } catch {
      addUrdfRecoveryDiagnostic(recoveryDiagnostics, {
        code: 'urdf_link_omitted',
        category: 'topology',
        message: `Link "${linkName}" could not be read and was omitted while its siblings were preserved.`,
        action: 'omitted',
        tag: 'link',
        name: linkName,
        relatedIds: [linkName],
      });
    }
  });

  return { links, extraJoints, linkMaterials };
};
