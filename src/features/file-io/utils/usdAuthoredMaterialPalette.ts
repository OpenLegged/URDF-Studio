import * as THREE from 'three';

import type { UrdfVisualMaterial } from '@/types';
import { createThreeColorFromSRGB, parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import { toUsdAuthoredColorFromSrgbTuple } from './usdColorSpace.ts';

type UsdPaletteMesh = THREE.Mesh & {
  userData: {
    usdAuthoredColor?: [number, number, number];
    usdMaterialPalette?: Array<{
      materialIndex: number;
      usdAuthoredColor?: [number, number, number];
      usdDisplayColor?: string | null;
      usdMaterial?: Record<string, unknown>;
      usdOpacity?: number;
      usdSourceMaterialName?: string;
    }>;
    usdDisplayColor?: string | null;
    usdMaterial?: Record<string, unknown>;
    usdOpacity?: number;
    usdSourceMaterialIndex?: number;
    usdSourceMaterialName?: string;
  };
};

const normalizeUnitInterval = (value: unknown): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.max(0, Math.min(1, Number(value)));
};

const normalizeMaterialIdentifier = (value: unknown): string | null => {
  const normalized = String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  let current = normalized;
  let previous = '';
  while (current !== previous) {
    previous = current;
    current = current.replace(/(?:[\s._-]*(?:effect|material))$/u, '').trim();
  }

  const collapsed = current.replace(/[\s._-]+/gu, '');
  return collapsed || null;
};

const cloneColorRgba = (
  value: UrdfVisualMaterial['colorRgba'],
): [number, number, number, number] | null => {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((entry) => !Number.isFinite(entry))
  ) {
    return null;
  }

  return [Number(value[0]), Number(value[1]), Number(value[2]), Number(value[3])] as [
    number,
    number,
    number,
    number,
  ];
};

const resolveAuthoredMaterialForMesh = (
  mesh: UsdPaletteMesh,
  authoredMaterials: readonly UrdfVisualMaterial[],
  authoredMaterialsByName: ReadonlyMap<string, UrdfVisualMaterial>,
): UrdfVisualMaterial | null => {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const materialIdentifier = normalizeMaterialIdentifier(
    mesh.userData.usdSourceMaterialName || material?.name,
  );
  if (materialIdentifier) {
    const matchedByName = authoredMaterialsByName.get(materialIdentifier);
    if (matchedByName) {
      return matchedByName;
    }
  }

  const sourceMaterialIndex = Number(mesh.userData.usdSourceMaterialIndex);
  if (
    Number.isInteger(sourceMaterialIndex) &&
    sourceMaterialIndex >= 0 &&
    sourceMaterialIndex < authoredMaterials.length
  ) {
    return authoredMaterials[sourceMaterialIndex] || null;
  }

  if (authoredMaterials.length === 1) {
    return authoredMaterials[0] || null;
  }

  return null;
};

type AppliedAuthoredMaterialMetadata = {
  usdAuthoredColor?: [number, number, number];
  usdDisplayColor?: string | null;
  usdMaterial: Record<string, unknown>;
  usdOpacity?: number;
};

const applyAuthoredMaterialToMaterial = (
  material: THREE.Material,
  authoredMaterial: UrdfVisualMaterial,
): AppliedAuthoredMaterialMetadata => {
  const nextUsdMaterial = {
    ...((material.userData?.usdMaterial as Record<string, unknown> | undefined) || {}),
  };
  delete nextUsdMaterial.color;
  delete nextUsdMaterial.colorRgba;
  delete nextUsdMaterial.texture;

  const exactColorRgba = cloneColorRgba(authoredMaterial.colorRgba);
  const parsedColor = exactColorRgba
    ? {
        color: createThreeColorFromSRGB(exactColorRgba[0], exactColorRgba[1], exactColorRgba[2]),
        opacity: exactColorRgba[3],
      }
    : parseThreeColorWithOpacity(authoredMaterial.color);

  const effectiveOpacity =
    normalizeUnitInterval(authoredMaterial.opacity) ??
    normalizeUnitInterval(exactColorRgba?.[3]) ??
    normalizeUnitInterval(parsedColor?.opacity) ??
    null;

  if ('color' in material && material.color instanceof THREE.Color && parsedColor) {
    material.color.copy(parsedColor.color);
  }

  if ('map' in material) {
    (material as THREE.MeshStandardMaterial).map = null;
  }

  let usdOpacity: number | undefined;
  if (effectiveOpacity !== null) {
    material.opacity = effectiveOpacity;
    material.transparent = effectiveOpacity < 1;
    usdOpacity = effectiveOpacity;
  }

  let usdDisplayColor: string | null | undefined;
  if (authoredMaterial.color) {
    usdDisplayColor = authoredMaterial.color;
    nextUsdMaterial.color = authoredMaterial.color;
  } else if (authoredMaterial.texture) {
    usdDisplayColor = '#ffffff';
  }

  let usdAuthoredColor: [number, number, number] | undefined;
  if (exactColorRgba) {
    usdAuthoredColor = toUsdAuthoredColorFromSrgbTuple([
      exactColorRgba[0],
      exactColorRgba[1],
      exactColorRgba[2],
    ]);
    nextUsdMaterial.colorRgba = exactColorRgba;
  }

  if (authoredMaterial.texture) {
    nextUsdMaterial.texture = authoredMaterial.texture;
  }

  material.userData = {
    ...(material.userData ?? {}),
    usdMaterial: nextUsdMaterial,
  };
  material.needsUpdate = true;

  return {
    ...(usdAuthoredColor ? { usdAuthoredColor } : {}),
    ...(usdDisplayColor !== undefined ? { usdDisplayColor } : {}),
    usdMaterial: nextUsdMaterial,
    ...(usdOpacity !== undefined ? { usdOpacity } : {}),
  };
};

export const applyUsdAuthoredMaterialPalette = (
  object: THREE.Object3D,
  authoredMaterials: readonly UrdfVisualMaterial[],
): void => {
  if (authoredMaterials.length === 0) {
    return;
  }

  const authoredMaterialsByName = new Map<string, UrdfVisualMaterial>();
  authoredMaterials.forEach((entry) => {
    const key = normalizeMaterialIdentifier(entry.name);
    if (key && !authoredMaterialsByName.has(key)) {
      authoredMaterialsByName.set(key, entry);
    }
  });

  object.traverse((child) => {
    const mesh = child as UsdPaletteMesh;
    if (!mesh.isMesh) {
      return;
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const paletteEntries: NonNullable<UsdPaletteMesh['userData']['usdMaterialPalette']> = [];

    materials.forEach((material, materialIndex) => {
      if (!material) {
        return;
      }

      const authoredMaterial = resolveAuthoredMaterialForMesh(
        {
          ...mesh,
          material,
          userData: {
            ...mesh.userData,
            usdSourceMaterialIndex: mesh.userData.usdSourceMaterialIndex ?? materialIndex,
            usdSourceMaterialName:
              mesh.userData.usdSourceMaterialName || material.name || undefined,
          },
        } as UsdPaletteMesh,
        authoredMaterials,
        authoredMaterialsByName,
      );
      if (!authoredMaterial) {
        return;
      }

      const applied = applyAuthoredMaterialToMaterial(material, authoredMaterial);
      paletteEntries.push({
        materialIndex,
        ...(applied.usdAuthoredColor ? { usdAuthoredColor: applied.usdAuthoredColor } : {}),
        ...(applied.usdDisplayColor !== undefined
          ? { usdDisplayColor: applied.usdDisplayColor }
          : {}),
        usdMaterial: applied.usdMaterial,
        ...(applied.usdOpacity !== undefined ? { usdOpacity: applied.usdOpacity } : {}),
        ...(material.name ? { usdSourceMaterialName: material.name } : {}),
      });
    });

    if (paletteEntries.length === 0) {
      return;
    }

    if (materials.length === 1) {
      const entry = paletteEntries[0];
      mesh.userData.usdMaterial = entry.usdMaterial;
      mesh.userData.usdAuthoredColor = entry.usdAuthoredColor;
      mesh.userData.usdDisplayColor = entry.usdDisplayColor ?? null;
      if (entry.usdOpacity !== undefined) {
        mesh.userData.usdOpacity = entry.usdOpacity;
      } else {
        delete mesh.userData.usdOpacity;
      }
      delete mesh.userData.usdMaterialPalette;
      return;
    }

    mesh.userData.usdMaterialPalette = paletteEntries;
    delete mesh.userData.usdMaterial;
    delete mesh.userData.usdAuthoredColor;
    delete mesh.userData.usdDisplayColor;
    delete mesh.userData.usdOpacity;
  });
};

export const __usdAuthoredMaterialPaletteInternals = {
  normalizeMaterialIdentifier,
};
