import { useRef, useEffect, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { highlightFaceMaterial } from '../utils/materials';
import type { ToolMode, URDFViewerProps } from '../types';

export interface UseHoverDetectionOptions {
    robot: THREE.Object3D | null;
    toolMode: ToolMode;
    mode?: 'detail' | 'hardware';
    highlightMode: 'link' | 'collision';
    showCollision: boolean;
    showVisual: boolean;
    selection?: URDFViewerProps['selection'];
    mouseRef: React.MutableRefObject<THREE.Vector2>;
    raycasterRef: React.MutableRefObject<THREE.Raycaster>;
    hoveredLinkRef: React.MutableRefObject<string | null>;
    isDraggingJoint: React.MutableRefObject<boolean>;
    needsRaycastRef: React.MutableRefObject<boolean>;
    isOrbitDragging?: React.MutableRefObject<boolean>;
    justSelectedRef?: React.MutableRefObject<boolean>;
    rayIntersectsBoundingBox: (raycaster: THREE.Raycaster) => boolean;
    highlightGeometry: (
        linkName: string | null,
        revert: boolean,
        subType?: 'visual' | 'collision',
        meshToHighlight?: THREE.Object3D | null
    ) => void;
}

export interface UseHoverDetectionResult {
    highlightedFace: { mesh: THREE.Mesh; faceIndex: number } | null;
    setHighlightedFace: React.Dispatch<React.SetStateAction<{ mesh: THREE.Mesh; faceIndex: number } | null>>;
    highlightedFaceMeshRef: React.MutableRefObject<THREE.Mesh | null>;
}

export function useHoverDetection({
    robot,
    toolMode,
    mode,
    highlightMode,
    showCollision,
    showVisual,
    selection,
    mouseRef,
    raycasterRef,
    hoveredLinkRef,
    isDraggingJoint,
    needsRaycastRef,
    isOrbitDragging,
    justSelectedRef,
    rayIntersectsBoundingBox,
    highlightGeometry
}: UseHoverDetectionOptions): UseHoverDetectionResult {
    const { scene, camera } = useThree();

    const [highlightedFace, setHighlightedFace] = useState<{ mesh: THREE.Mesh; faceIndex: number } | null>(null);
    const highlightedFaceMeshRef = useRef<THREE.Mesh | null>(null);

    // Track last camera position to detect camera movement
    const lastCameraPosRef = useRef(new THREE.Vector3());
    // Track last toolMode to detect mode changes
    const lastToolModeRef = useRef(toolMode);

    // Update face highlight mesh
    useEffect(() => {
        if (!highlightedFace) {
            if (highlightedFaceMeshRef.current) {
                highlightedFaceMeshRef.current.visible = false;
            }
            return;
        }

        const { mesh, faceIndex } = highlightedFace;
        const geometry = mesh.geometry;

        if (!geometry) return;

        if (!highlightedFaceMeshRef.current) {
            highlightedFaceMeshRef.current = new THREE.Mesh(new THREE.BufferGeometry(), highlightFaceMaterial);
            highlightedFaceMeshRef.current.renderOrder = 2000;
            scene.add(highlightedFaceMeshRef.current);
        }

        const highlightMesh = highlightedFaceMeshRef.current;
        highlightMesh.visible = true;

        const positionAttribute = geometry.getAttribute('position');
        const indexAttribute = geometry.getIndex();

        const facesToHighlight = [faceIndex];
        const positions: number[] = [];

        for (const fi of facesToHighlight) {
            let a: number, b: number, c: number;
            if (indexAttribute) {
                a = indexAttribute.getX(fi * 3);
                b = indexAttribute.getX(fi * 3 + 1);
                c = indexAttribute.getX(fi * 3 + 2);
            } else {
                a = fi * 3;
                b = fi * 3 + 1;
                c = fi * 3 + 2;
            }

            positions.push(
                positionAttribute.getX(a), positionAttribute.getY(a), positionAttribute.getZ(a),
                positionAttribute.getX(b), positionAttribute.getY(b), positionAttribute.getZ(b),
                positionAttribute.getX(c), positionAttribute.getY(c), positionAttribute.getZ(c)
            );
        }

        const highlightGeo = highlightMesh.geometry;
        highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        highlightGeo.computeVertexNormals();
    }, [highlightedFace, scene]);

    // Sync face highlight transform
    useFrame(() => {
        // Skip in hardware mode to improve performance
        if (mode === 'hardware') return;

        if (highlightedFace && highlightedFaceMeshRef.current) {
            const mesh = highlightedFace.mesh;
            const highlight = highlightedFaceMeshRef.current;
            mesh.updateMatrixWorld();
            highlight.matrix.copy(mesh.matrixWorld);
            highlight.matrixAutoUpdate = false;
        }
    });

    // Clean up face highlight mesh on unmount
    useEffect(() => {
        return () => {
            if (highlightedFaceMeshRef.current) {
                scene.remove(highlightedFaceMeshRef.current);
                highlightedFaceMeshRef.current.geometry.dispose();
                highlightedFaceMeshRef.current = null;
            }
        };
    }, [scene]);

    // Clean up face highlight when leaving face mode
    useEffect(() => {
        if (toolMode !== 'face' && highlightedFaceMeshRef.current) {
            highlightedFaceMeshRef.current.visible = false;
        }
    }, [toolMode]);

    // Continuous hover detection (OPTIMIZED: only run when needed)
    useFrame(() => {
        if (!robot) return;
        if (isDraggingJoint.current) return;
        if (isOrbitDragging?.current) return;

        // Skip hover detection in hardware mode to improve performance
        if (mode === 'hardware') return;

        // OPTIMIZATION: Check if raycast is needed (mouse moved, camera changed, or toolMode changed)
        const cameraMoved = !camera.position.equals(lastCameraPosRef.current);
        const toolModeChanged = toolMode !== lastToolModeRef.current;

        if (cameraMoved) {
            lastCameraPosRef.current.copy(camera.position);
            needsRaycastRef.current = true;
        }
        if (toolModeChanged) {
            lastToolModeRef.current = toolMode;
            needsRaycastRef.current = true;
        }

        // Skip raycast if no update needed
        if (!needsRaycastRef.current) return;
        needsRaycastRef.current = false;

        const isStandardMode = ['view', 'select', 'translate', 'rotate', 'universal'].includes(toolMode || 'select');

        // Handle Face Selection Mode
        if (toolMode === 'face') {
            raycasterRef.current.setFromCamera(mouseRef.current, camera);

            // PERFORMANCE: Two-phase detection - check bounding box first
            if (!rayIntersectsBoundingBox(raycasterRef.current)) {
                if (highlightedFace) setHighlightedFace(null);
                return;
            }

            const intersects = raycasterRef.current.intersectObject(robot, true);

            if (intersects.length > 0) {
                const hit = intersects[0];
                let isGizmo = false;
                let obj: THREE.Object3D | null = hit.object;
                while (obj) {
                    if (obj.userData?.isGizmo) { isGizmo = true; break; }
                    obj = obj.parent;
                }

                if (!isGizmo && hit.faceIndex !== undefined && hit.faceIndex !== null && hit.object instanceof THREE.Mesh) {
                    if (highlightedFace?.faceIndex !== hit.faceIndex || highlightedFace?.mesh !== hit.object) {
                        setHighlightedFace({ mesh: hit.object, faceIndex: hit.faceIndex as number });
                    }
                    if (hoveredLinkRef.current) {
                        highlightGeometry(hoveredLinkRef.current, true);
                        hoveredLinkRef.current = null;
                    }
                    return;
                }
            }
            if (highlightedFace) setHighlightedFace(null);
            return;
        }

        // Hide face highlight if not in face mode
        if ((toolMode as any) !== 'face' && highlightedFace) {
            setHighlightedFace(null);
        }

        if (justSelectedRef?.current) return;

        if (!isStandardMode) {
            if (hoveredLinkRef.current && hoveredLinkRef.current !== selection?.id) {
                const isCollisionMode = highlightMode === 'collision';
                highlightGeometry(hoveredLinkRef.current, true, isCollisionMode ? 'collision' : 'visual', (hoveredLinkRef as any).currentMesh);
                hoveredLinkRef.current = null;
                (hoveredLinkRef as any).currentMesh = null;
            }
            return;
        }

        // CRITICAL: Skip hover detection if the corresponding display option is not enabled
        const isCollisionMode = highlightMode === 'collision';
        if ((isCollisionMode && !showCollision) || (!isCollisionMode && !showVisual)) {
            // Clear any current hover since display is disabled
            if (hoveredLinkRef.current && hoveredLinkRef.current !== selection?.id) {
                highlightGeometry(hoveredLinkRef.current, true, isCollisionMode ? 'collision' : 'visual', (hoveredLinkRef as any).currentMesh);
                hoveredLinkRef.current = null;
                (hoveredLinkRef as any).currentMesh = null;
            }
            return;
        }

        raycasterRef.current.setFromCamera(mouseRef.current, camera);

        // PERFORMANCE: Two-phase detection - check bounding box first
        if (!rayIntersectsBoundingBox(raycasterRef.current)) {
            // Ray misses robot entirely - clear hover state if needed
            if (hoveredLinkRef.current && hoveredLinkRef.current !== selection?.id) {
                highlightGeometry(hoveredLinkRef.current, true, isCollisionMode ? 'collision' : 'visual', (hoveredLinkRef as any).currentMesh);
                hoveredLinkRef.current = null;
                (hoveredLinkRef as any).currentMesh = null;
            }
            return;
        }

        const intersections = raycasterRef.current.intersectObject(robot, true);

        let newHoveredLink: string | null = null;
        let newHoveredMesh: THREE.Object3D | null = null;

        if (intersections.length > 0) {
            const validHits = intersections.filter(hit => {
                if (hit.object.userData?.isGizmo) return false;
                let p = hit.object.parent;
                while (p) {
                    if (p.userData?.isGizmo) return false;
                    p = p.parent;
                }
                if (isCollisionMode) {
                    let obj: THREE.Object3D | null = hit.object;
                    let isCollision = false;
                    while (obj) {
                        if (obj.userData?.isCollisionMesh || (obj as any).isURDFCollider) {
                            isCollision = true;
                            break;
                        }
                        obj = obj.parent;
                    }
                    return isCollision;
                }
                let obj: THREE.Object3D | null = hit.object;
                while (obj) {
                    if (obj.userData?.isCollisionMesh || (obj as any).isURDFCollider) {
                        return false;
                    }
                    obj = obj.parent;
                }
                return true;
            });

            if (validHits.length > 0) {
                const hit = validHits[0];
                newHoveredMesh = hit.object;
                let current = hit.object as THREE.Object3D | null;

                while (current) {
                    if ((robot as any).links && (robot as any).links[current.name]) {
                        newHoveredLink = current.name;
                        break;
                    }
                    if (current === robot) break;
                    current = current.parent;
                }
            }
        }

        if (newHoveredLink !== hoveredLinkRef.current || newHoveredMesh !== (hoveredLinkRef as any).currentMesh) {
            if (hoveredLinkRef.current && hoveredLinkRef.current !== selection?.id) {
                highlightGeometry(hoveredLinkRef.current, true, isCollisionMode ? 'collision' : 'visual', (hoveredLinkRef as any).currentMesh);
            }

            if (newHoveredLink && newHoveredLink !== selection?.id) {
                highlightGeometry(newHoveredLink, false, isCollisionMode ? 'collision' : 'visual', newHoveredMesh);
            }

            hoveredLinkRef.current = newHoveredLink;
            (hoveredLinkRef as any).currentMesh = newHoveredMesh;
        }
    });

    return {
        highlightedFace,
        setHighlightedFace,
        highlightedFaceMeshRef
    };
}
