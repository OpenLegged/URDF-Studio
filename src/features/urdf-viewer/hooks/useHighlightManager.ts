import { useRef, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import {
    highlightMaterial,
    collisionHighlightMaterial
} from '../utils/materials';
import { _pooledRay, _pooledBox3 } from '../constants';

export interface UseHighlightManagerOptions {
    robot: THREE.Object3D | null;
    robotVersion: number;
    highlightMode: 'link' | 'collision';
    showCollision: boolean;
    showVisual: boolean;
    linkMeshMapRef: React.MutableRefObject<Map<string, THREE.Mesh[]>>;
}

export interface UseHighlightManagerResult {
    highlightGeometry: (
        linkName: string | null,
        revert: boolean,
        subType?: 'visual' | 'collision',
        meshToHighlight?: THREE.Object3D | null
    ) => void;
    revertAllHighlights: () => void;
    getRobotBoundingBox: () => THREE.Box3 | null;
    rayIntersectsBoundingBox: (raycaster: THREE.Raycaster) => boolean;
    highlightedMeshesRef: React.MutableRefObject<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>;
    boundingBoxNeedsUpdateRef: React.MutableRefObject<boolean>;
    getTriangleVertices: (
        geometry: THREE.BufferGeometry,
        faceIndex: number,
        outV0: THREE.Vector3,
        outV1: THREE.Vector3,
        outV2: THREE.Vector3
    ) => void;
}

export function useHighlightManager({
    robot,
    robotVersion,
    highlightMode,
    showCollision,
    showVisual,
    linkMeshMapRef
}: UseHighlightManagerOptions): UseHighlightManagerResult {
    // PERFORMANCE: Cached robot bounding box for two-phase detection
    const robotBoundingBoxRef = useRef<THREE.Box3 | null>(null);
    const boundingBoxNeedsUpdateRef = useRef(true);

    // Map to track currently highlighted meshes for O(1) revert instead of traverse
    const highlightedMeshesRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());

    // Refs for visibility state
    const showVisualRef = useRef(showVisual);
    const showCollisionRef = useRef(showCollision);

    // PERFORMANCE: Pre-allocated vectors for triangle vertices (object pooling)
    const _triVert0 = useRef(new THREE.Vector3());
    const _triVert1 = useRef(new THREE.Vector3());
    const _triVert2 = useRef(new THREE.Vector3());

    // Keep refs in sync
    useEffect(() => { showVisualRef.current = showVisual; }, [showVisual]);
    useEffect(() => { showCollisionRef.current = showCollision; }, [showCollision]);

    // PERFORMANCE: Update robot bounding box when robot changes
    useEffect(() => {
        if (robot) {
            boundingBoxNeedsUpdateRef.current = true;
        }
    }, [robot, robotVersion]);

    // Helper to get/update robot bounding box (cached)
    const getRobotBoundingBox = useCallback(() => {
        if (!robot) return null;
        if (boundingBoxNeedsUpdateRef.current || !robotBoundingBoxRef.current) {
            if (!robotBoundingBoxRef.current) {
                robotBoundingBoxRef.current = new THREE.Box3();
            }
            robotBoundingBoxRef.current.setFromObject(robot);
            // Expand slightly to account for animation/movement
            robotBoundingBoxRef.current.expandByScalar(0.05);
            boundingBoxNeedsUpdateRef.current = false;
        }
        return robotBoundingBoxRef.current;
    }, [robot]);

    // PERFORMANCE: Two-phase detection - check bounding box first
    const rayIntersectsBoundingBox = useCallback((raycaster: THREE.Raycaster): boolean => {
        const bbox = getRobotBoundingBox();
        if (!bbox) return false;
        // Use pooled ray to avoid allocation
        _pooledRay.copy(raycaster.ray);
        return _pooledRay.intersectsBox(bbox);
    }, [getRobotBoundingBox]);

    // Helper function to get triangle vertices - writes to provided output vectors (no allocation)
    const getTriangleVertices = useCallback((
        geometry: THREE.BufferGeometry,
        faceIndex: number,
        outV0: THREE.Vector3,
        outV1: THREE.Vector3,
        outV2: THREE.Vector3
    ): void => {
        const positionAttribute = geometry.getAttribute('position');
        const indexAttribute = geometry.getIndex();

        let a: number, b: number, c: number;
        if (indexAttribute) {
            a = indexAttribute.getX(faceIndex * 3);
            b = indexAttribute.getX(faceIndex * 3 + 1);
            c = indexAttribute.getX(faceIndex * 3 + 2);
        } else {
            a = faceIndex * 3;
            b = faceIndex * 3 + 1;
            c = faceIndex * 3 + 2;
        }

        // Write directly to output vectors - no allocation
        outV0.set(positionAttribute.getX(a), positionAttribute.getY(a), positionAttribute.getZ(a));
        outV1.set(positionAttribute.getX(b), positionAttribute.getY(b), positionAttribute.getZ(b));
        outV2.set(positionAttribute.getX(c), positionAttribute.getY(c), positionAttribute.getZ(c));
    }, []);

    // Revert all highlighted meshes using the tracked Map (O(n) where n = highlighted, not total)
    const revertAllHighlights = useCallback(() => {
        highlightedMeshesRef.current.forEach((origMaterial, mesh) => {
            mesh.material = origMaterial;
            const isCollider = (mesh as any).isURDFCollider || mesh.userData.isCollisionMesh;
            if (isCollider) {
                mesh.visible = showCollisionRef.current;
                if (mesh.parent && (mesh.parent as any).isURDFCollider) mesh.parent.visible = showCollisionRef.current;
                const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
                materials.forEach((m: any) => { if (m) { m.transparent = true; m.opacity = 0.4; } });
                mesh.renderOrder = 999;
            } else {
                mesh.visible = showVisualRef.current;
            }
        });
        highlightedMeshesRef.current.clear();
    }, []);

    // PERFORMANCE: Helper function to highlight/unhighlight link geometry
    // Uses pre-built linkMeshMap for O(1) lookup instead of traverse
    const highlightGeometry = useCallback((
        linkName: string | null,
        revert: boolean,
        subType: 'visual' | 'collision' | undefined = undefined,
        meshToHighlight?: THREE.Object3D | null
    ) => {
        if (!robot) return;

        try {
            const targetSubType = subType || (highlightMode === 'collision' ? 'collision' : 'visual');

            // CRITICAL: Check if the corresponding display option is enabled
            // In link mode, only highlight if showVisual is true
            // In collision mode, only highlight if showCollision is true
            if (!revert) {
                if (targetSubType === 'visual' && !showVisual) {
                    // Link mode but visual display is off - don't highlight
                    return;
                }
                if (targetSubType === 'collision' && !showCollision) {
                    // Collision mode but collision display is off - don't highlight
                    return;
                }
            }

            // OPTIMIZED: Use Map-based revert instead of traversing
            if (revert) {
                revertAllHighlights();
                return;
            }

            // PERFORMANCE: If highlighting a specific mesh, use direct access
            if (meshToHighlight && (meshToHighlight as any).isMesh) {
                const mesh = meshToHighlight as THREE.Mesh;
                if (!highlightedMeshesRef.current.has(mesh)) {
                    highlightedMeshesRef.current.set(mesh, mesh.material);
                }
                mesh.material = targetSubType === 'collision' ? collisionHighlightMaterial : highlightMaterial;
                mesh.visible = true;
                if (mesh.parent) mesh.parent.visible = true;

                if (mesh.userData.isCollisionMesh && mesh.material) {
                    (mesh.material as any).transparent = false;
                    (mesh.material as any).opacity = 1.0;
                    mesh.renderOrder = 1000;
                }
                return;
            }

            // PERFORMANCE: Use pre-built linkMeshMap for O(1) lookup
            if (linkName) {
                const mapKey = `${linkName}:${targetSubType}`;
                const meshes = linkMeshMapRef.current.get(mapKey);

                if (meshes && meshes.length > 0) {
                    for (let i = 0; i < meshes.length; i++) {
                        const mesh = meshes[i];
                        if (mesh.userData?.isGizmo) continue;

                        if (!highlightedMeshesRef.current.has(mesh)) {
                            highlightedMeshesRef.current.set(mesh, mesh.material);
                        }
                        mesh.material = targetSubType === 'collision' ? collisionHighlightMaterial : highlightMaterial;
                        mesh.visible = true;
                        if (mesh.parent) mesh.parent.visible = true;

                        if (targetSubType === 'collision' && mesh.material) {
                            (mesh.material as any).transparent = false;
                            (mesh.material as any).opacity = 1.0;
                            mesh.renderOrder = 1000;
                        }
                    }
                    return;
                }

                // Fallback to traverse if map lookup fails (shouldn't happen normally)
                const linkObj = (robot as any).links?.[linkName];
                if (linkObj) {
                    const fallbackTraverse = (c: any) => {
                        if (c.isURDFJoint || c.userData?.isGizmo) return;
                        if (c.isMesh) {
                            const isCollider = c.isURDFCollider || c.userData.isCollisionMesh;
                            const shouldHighlight = (targetSubType === 'collision' && isCollider) || (targetSubType === 'visual' && !isCollider);
                            if (shouldHighlight) {
                                if (!highlightedMeshesRef.current.has(c)) {
                                    highlightedMeshesRef.current.set(c, c.material);
                                }
                                c.material = targetSubType === 'collision' ? collisionHighlightMaterial : highlightMaterial;
                                c.visible = true;
                                if (c.parent) c.parent.visible = true;
                            }
                        }
                        c.children?.forEach(fallbackTraverse);
                    };
                    fallbackTraverse(linkObj);
                }
            }
        } catch (err) {
            console.warn("Error in highlightGeometry:", err);
        }
    }, [robot, showCollision, showVisual, highlightMode, revertAllHighlights, linkMeshMapRef]);

    return {
        highlightGeometry,
        revertAllHighlights,
        getRobotBoundingBox,
        rayIntersectsBoundingBox,
        highlightedMeshesRef,
        boundingBoxNeedsUpdateRef,
        getTriangleVertices
    };
}
