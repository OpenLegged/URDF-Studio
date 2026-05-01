// @ts-nocheck
import { Color, DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, SRGBColorSpace } from 'three';

export const HYDRA_DEFAULT_GRAY_HEX = 0x888888;
export const HYDRA_UNIFIED_MATERIAL_DEFAULTS = Object.freeze({
    roughness: 0.56,
    metalness: 0.035,
    envMapIntensity: 0.42,
});

export const HYDRA_PHYSICAL_ONLY_PROPERTY_NAMES = new Set([
    'clearcoat',
    'clearcoatRoughness',
    'clearcoatNormalScale',
    'specularIntensity',
    'specularColor',
    'ior',
    'transmission',
    'thickness',
    'attenuationDistance',
    'attenuationColor',
    'sheen',
    'sheenColor',
    'sheenRoughness',
    'iridescence',
    'iridescenceIOR',
    'anisotropy',
    'anisotropyRotation',
    'clearcoatMap',
    'clearcoatRoughnessMap',
    'clearcoatNormalMap',
    'specularColorMap',
    'specularIntensityMap',
    'transmissionMap',
    'thicknessMap',
    'sheenColorMap',
    'sheenRoughnessMap',
    'anisotropyMap',
    'iridescenceMap',
    'iridescenceThicknessMap',
]);

function normalizeHydraColorChannel(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return 0;
    return Math.max(0, Math.min(1, numeric));
}

export function setHydraColorFromTuple(target, colorTuple, colorSpace = null) {
    const color = target instanceof Color ? target : new Color();
    const tuple = colorTuple && typeof colorTuple.length === 'number' ? colorTuple : [];
    const red = normalizeHydraColorChannel(tuple[0]);
    const green = normalizeHydraColorChannel(tuple[1]);
    const blue = normalizeHydraColorChannel(tuple[2]);
    if (colorSpace === SRGBColorSpace) {
        return color.setRGB(red, green, blue, SRGBColorSpace);
    }
    return color.setRGB(red, green, blue);
}

export function createHydraColorFromTuple(colorTuple, colorSpace = null) {
    return setHydraColorFromTuple(new Color(), colorTuple, colorSpace);
}

export function hydraMaterialRequiresPhysicalExtensions(candidateNames = []) {
    const names = Array.isArray(candidateNames) ? candidateNames : [];
    return names.some((candidateName) => HYDRA_PHYSICAL_ONLY_PROPERTY_NAMES.has(String(candidateName || '')));
}

export function applyUnifiedHydraMaterialDefaults(material) {
    if (!material)
        return material;
    material.roughness = HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness;
    material.metalness = HYDRA_UNIFIED_MATERIAL_DEFAULTS.metalness;
    material.envMapIntensity = HYDRA_UNIFIED_MATERIAL_DEFAULTS.envMapIntensity;
    // Keep USD-authored robot palettes consistent with the URDF/MJCF viewers.
    material.toneMapped = false;
    return material;
}

export function createUnifiedHydraPhysicalMaterial(options = {}) {
    const {
        color = HYDRA_DEFAULT_GRAY_HEX,
        side = DoubleSide,
        name = '',
    } = options;
    const material = new MeshPhysicalMaterial({
        side,
        color: color instanceof Color ? color.clone() : new Color(color),
        roughness: HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness,
        metalness: HYDRA_UNIFIED_MATERIAL_DEFAULTS.metalness,
        envMapIntensity: HYDRA_UNIFIED_MATERIAL_DEFAULTS.envMapIntensity,
        toneMapped: false,
        name,
    });
    return material;
}

export function createUnifiedHydraStandardMaterial(options = {}) {
    const {
        color = HYDRA_DEFAULT_GRAY_HEX,
        side = DoubleSide,
        name = '',
    } = options;
    const material = new MeshStandardMaterial({
        side,
        color: color instanceof Color ? color.clone() : new Color(color),
        roughness: HYDRA_UNIFIED_MATERIAL_DEFAULTS.roughness,
        metalness: HYDRA_UNIFIED_MATERIAL_DEFAULTS.metalness,
        envMapIntensity: HYDRA_UNIFIED_MATERIAL_DEFAULTS.envMapIntensity,
        toneMapped: false,
        name,
    });
    return material;
}
