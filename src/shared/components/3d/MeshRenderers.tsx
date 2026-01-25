/**
 * Shared Mesh Renderer Components
 * Used by both Visualizer.tsx and URDFViewer.tsx
 */

import React, { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
// @ts-ignore
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
// @ts-ignore
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
// @ts-ignore
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

// Loading manager hook for asset resolution
export const useLoadingManager = (assets: Record<string, string>) => {
  const manager = useMemo(() => {
    const m = new THREE.LoadingManager();
    m.setURLModifier((url) => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;

      const normalizedUrl = url.replace(/\\/g, '/');
      const filename = normalizedUrl.split('/').pop();

      if (filename) {
        if (assets[filename]) return assets[filename];

        const lowerFilename = filename.toLowerCase();
        const foundKey = Object.keys(assets).find(k => k.toLowerCase().endsWith(lowerFilename));
        if (foundKey) return assets[foundKey];
      }

      return url;
    });
    return m;
  }, [assets]);
  return manager;
};

interface ScaleProps {
  x: number;
  y: number;
  z: number;
}

// STL Renderer
export const STLRenderer = React.memo(({
  url,
  material,
  scale
}: {
  url: string;
  material: THREE.Material;
  scale?: ScaleProps;
}) => {
  const geometry = useLoader(STLLoader, url);
  const clone = useMemo(() => geometry.clone(), [geometry]);
  const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];
  return <mesh geometry={clone} material={material} rotation={[0, 0, 0]} scale={scaleArr} />;
});

// OBJ Renderer
export const OBJRenderer = React.memo(({
  url,
  material,
  color,
  assets,
  scale
}: {
  url: string;
  material: THREE.Material;
  color: string;
  assets: Record<string, string>;
  scale?: ScaleProps;
}) => {
  const manager = useLoadingManager(assets);
  const obj = useLoader(OBJLoader, url, (loader) => {
    loader.manager = manager;
  });
  const clone = useMemo(() => {
    const c = obj.clone();
    c.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (!mat || !mat.map) {
          mesh.material = material;
        }
      }
    });
    return c;
  }, [obj, material]);
  const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];
  return <group rotation={[0, 0, 0]} scale={scaleArr}><primitive object={clone} /></group>;
});

// DAE (Collada) Renderer
export const DAERenderer = React.memo(({
  url,
  material,
  assets,
  scale
}: {
  url: string;
  material: THREE.Material;
  assets: Record<string, string>;
  scale?: ScaleProps;
}) => {
  const manager = useLoadingManager(assets);
  const dae = useLoader(ColladaLoader, url, (loader) => {
    loader.manager = manager;
  });
  const clone = useMemo(() => {
    const c = dae.scene.clone();
    c.rotation.set(0, 0, 0);
    c.updateMatrix();

    c.traverse((child: any) => {
      if (child.isMesh) {
        const mesh = child as THREE.Mesh;
        const originalMat = mesh.material;

        let hasTexture = false;
        if (Array.isArray(originalMat)) {
          hasTexture = originalMat.some((m: any) => m.map || m.emissiveMap);
        } else {
          const mat = originalMat as any;
          hasTexture = !!mat.map || !!mat.emissiveMap;
        }

        if (!hasTexture) {
          mesh.material = material;
        }
      }
    });
    return c;
  }, [dae, material]);
  const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];
  return <group scale={scaleArr}><primitive object={clone} /></group>;
});
