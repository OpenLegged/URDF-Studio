import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * A small hook that wraps `useMemo` + `useEffect` for Three.js geometry disposal.
 * Call sites provide explicit dependencies; this wrapper centralizes geometry cleanup.
 */
export const useDisposableGeometry = <T extends THREE.BufferGeometry>(
  createGeometry: () => T,
  deps: React.DependencyList,
) => {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = useMemo(createGeometry, deps);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
};