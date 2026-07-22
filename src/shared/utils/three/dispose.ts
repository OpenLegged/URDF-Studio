import * as THREE from 'three';
import { isSharedThreeResource } from '@/core/utils/threeResourceOwnership';

type DisposableObject3D = THREE.Object3D & {
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  skeleton?: THREE.Skeleton;
};

function closeTextureImageIfNeeded(texture: THREE.Texture): void {
  const image = (texture as THREE.Texture & { image?: unknown }).image as
    | { close?: () => void }
    | undefined;
  if (!image || typeof image.close !== 'function') {
    return;
  }

  try {
    image.close();
  } catch {
    return;
  }

  if ((texture as THREE.Texture & { image?: unknown }).image === image) {
    (texture as THREE.Texture & { image?: unknown }).image = null;
  }
}

function releaseKnownObjectReferences(object: THREE.Object3D & Record<string, unknown>): void {
  if ('links' in object) {
    object.links = {};
  }

  if ('joints' in object) {
    object.joints = {};
  }

  if ('mimicJoints' in object && Array.isArray(object.mimicJoints)) {
    object.mimicJoints = [];
  }

  if ('jointValue' in object) {
    object.jointValue = null;
  }

  if ('origPosition' in object) {
    object.origPosition = null;
  }

  if ('origQuaternion' in object) {
    object.origQuaternion = null;
  }

  if ('urdfNode' in object) {
    object.urdfNode = null;
  }

  if ('userData' in object) {
    object.userData = {};
  }
}

export function disposeObject3D(
  object: THREE.Object3D | null,
  disposeTextures: boolean = true,
  excludeMaterials?: Set<THREE.Material>,
): void {
  if (!object) return;
  const disposedSkeletons = new Set<THREE.Skeleton>();

  object.traverse((child) => {
    const disposableChild = child as DisposableObject3D;
    if (disposableChild.geometry && !isSharedThreeResource(disposableChild.geometry)) {
      disposableChild.geometry.dispose?.();
    }

    const skeleton = disposableChild.skeleton;
    if (
      skeleton instanceof THREE.Skeleton &&
      !disposedSkeletons.has(skeleton) &&
      typeof skeleton.dispose === 'function'
    ) {
      disposedSkeletons.add(skeleton);
      skeleton.dispose();
    }

    if (disposableChild.material) {
      disposeMaterial(disposableChild.material, disposeTextures, excludeMaterials);
    }

    releaseKnownObjectReferences(child as THREE.Object3D & Record<string, unknown>);
  });

  releaseKnownObjectReferences(object as THREE.Object3D & Record<string, unknown>);
  object.clear();

  if (object.parent) {
    object.parent.remove(object);
  }
}

export function disposeObject3DGraph(object: THREE.Object3D | null): void {
  if (!object) return;
  const disposedSkeletons = new Set<THREE.Skeleton>();

  object.traverse((child) => {
    const disposableChild = child as DisposableObject3D;
    const skeleton = disposableChild.skeleton;
    if (
      skeleton instanceof THREE.Skeleton &&
      !disposedSkeletons.has(skeleton) &&
      typeof skeleton.dispose === 'function'
    ) {
      disposedSkeletons.add(skeleton);
      skeleton.dispose();
    }

    releaseKnownObjectReferences(child as THREE.Object3D & Record<string, unknown>);
  });

  releaseKnownObjectReferences(object as THREE.Object3D & Record<string, unknown>);
  object.clear();

  if (object.parent) {
    object.parent.remove(object);
  }
}

export function disposeMaterial(
  material: THREE.Material | THREE.Material[],
  disposeTextures: boolean = true,
  excludeMaterials?: Set<THREE.Material>,
): void {
  const materials = Array.isArray(material) ? material : [material];

  for (const mat of materials) {
    if (!mat) continue;

    if (excludeMaterials?.has(mat)) continue;
    if (isSharedThreeResource(mat)) continue;

    if (disposeTextures) {
      disposeTexturesFromMaterial(mat);
    }

    mat.dispose();
  }
}

export function disposeTexturesFromMaterial(material: THREE.Material): void {
  const textureProperties = [
    'map',
    'lightMap',
    'bumpMap',
    'normalMap',
    'specularMap',
    'envMap',
    'alphaMap',
    'aoMap',
    'displacementMap',
    'emissiveMap',
    'gradientMap',
    'metalnessMap',
    'roughnessMap',
    'clearcoatMap',
    'clearcoatNormalMap',
    'clearcoatRoughnessMap',
    'sheenColorMap',
    'sheenRoughnessMap',
    'transmissionMap',
    'thicknessMap',
    'anisotropyMap',
    'iridescenceMap',
    'iridescenceThicknessMap',
    'specularColorMap',
    'specularIntensityMap',
  ];
  const visitedTextures = new Set<THREE.Texture>();

  for (const prop of textureProperties) {
    const texture = (material as unknown as Record<string, unknown>)[prop];
    if (texture && texture instanceof THREE.Texture && !visitedTextures.has(texture)) {
      visitedTextures.add(texture);
      closeTextureImageIfNeeded(texture);
      texture.dispose();
    }
  }
}

export function cleanupScene(scene: THREE.Scene, excludeMaterials?: Set<THREE.Material>): void {
  const directChildren = [...scene.children];
  for (const obj of directChildren) {
    disposeObject3D(obj, true, excludeMaterials);
  }
}

export function disposeWebGLRenderer(
  renderer:
    | (THREE.WebGLRenderer & {
        renderLists?: { dispose?: () => void };
        forceContextLoss?: () => void;
      })
    | null
    | undefined,
  options?: {
    forceContextLoss?: boolean;
  },
): void {
  if (!renderer) {
    return;
  }

  try {
    renderer.renderLists?.dispose?.();
  } catch {
    // Best-effort cleanup: continue releasing the renderer even if internal caches fail.
  }

  try {
    renderer.dispose();
  } catch {
    return;
  }

  if (options?.forceContextLoss) {
    try {
      renderer.forceContextLoss?.();
    } catch {
      return;
    }
  }
}

export function cancelAnimationFrameSafe(animationFrameId: { current: number | null }): void {
  if (animationFrameId.current !== null) {
    cancelAnimationFrame(animationFrameId.current);
    animationFrameId.current = null;
  }
}
