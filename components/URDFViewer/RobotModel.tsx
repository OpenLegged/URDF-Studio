import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
// @ts-ignore
import URDFLoader from 'urdf-loader';
import { MathUtils } from '../../services/mathUtils';
import { disposeObject3D } from './dispose';
import { CollisionTransformControls } from './CollisionTransformControls';
import { translations } from '../../services/i18n';
import { 
    enhanceMaterials, 
    highlightMaterial, 
    highlightFaceMaterial,
    collisionHighlightMaterial, 
    collisionBaseMaterial,
    emptyRaycast 
} from './materials';
import { RobotModelProps } from './types';
import { createLoadingManager, createMeshLoader, buildAssetIndex, resetUnitDetection } from './loaders';
import { throttle } from '../../services/throttle';
import { 
    RobotIndex, 
    buildRobotIndex, 
    createEmptyIndex,
    getLinkMeshes,
    highlightLinkMeshes,
    revertHighlights,
    freezeStaticMatrices,
    findParentLinkFromMesh,
    isMeshCollision
} from './robotIndex';

// Set of shared materials that should NOT be disposed (they are module-level singletons)
const SHARED_MATERIALS = new Set<THREE.Material>([
    highlightMaterial,
    highlightFaceMaterial,
    collisionHighlightMaterial,
    collisionBaseMaterial
]);

// ============================================================
// PERFORMANCE: Module-level object pool to eliminate GC pressure
// These objects are reused across all instances and frames
// ============================================================
const _pooledVec2 = new THREE.Vector2();
const _pooledVec3A = new THREE.Vector3();
const _pooledVec3B = new THREE.Vector3();
const _pooledBox3 = new THREE.Box3();
const _pooledRay = new THREE.Ray();
const _pooledMatrix4 = new THREE.Matrix4();
const _pooledQuat = new THREE.Quaternion();

// ============================================================
// PERFORMANCE: Named function references to avoid anonymous closures
// These are defined at module level to prevent recreation each render
// ============================================================
let _frameRaycastCallback: (() => void) | null = null;
let _frameFaceHighlightCallback: (() => void) | null = null;
let _frameFocusCallback: (() => void) | null = null;
// Minimum pixel movement threshold before triggering raycast (state locking)
const MOUSE_MOVE_THRESHOLD = 2;
// Throttle interval in ms (~30fps)
const THROTTLE_INTERVAL = 33;

// Wrap with memo and custom comparison to prevent unnecessary re-renders
export const RobotModel: React.FC<RobotModelProps> = memo(({ 
    urdfContent, 
    assets, 
    onRobotLoaded, 
    showCollision = false, 
    showVisual = true, 
    onSelect, 
    onJointChange, 
    onJointChangeCommit, 
    jointAngles, 
    setIsDragging, 
    setActiveJoint, 
    justSelectedRef, 
    t, 
    mode, 
    selection, 
    hoveredSelection, 
    highlightMode = 'link', 
    showInertia = false, 
    showCenterOfMass = false, 
    showOrigins = false, 
    originSize = 1.0, 
    showJointAxes = false, 
    jointAxisSize = 1.0, 
    robotLinks, 
    focusTarget, 
    transformMode = 'select', 
    toolMode = 'select', 
    onCollisionTransformEnd, 
    isOrbitDragging 
}) => {
    const [robot, setRobot] = useState<THREE.Object3D | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [robotVersion, setRobotVersion] = useState(0);
    const { scene, camera, gl, invalidate, controls } = useThree();
    const mouseRef = useRef(new THREE.Vector2(-1000, -1000));
    const raycasterRef = useRef(new THREE.Raycaster());
    const hoveredLinkRef = useRef<string | null>(null);
    
    // PERFORMANCE: Track last mouse position for state locking (skip small movements)
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    // PERFORMANCE: Cached robot bounding box for two-phase detection
    const robotBoundingBoxRef = useRef<THREE.Box3 | null>(null);
    const boundingBoxNeedsUpdateRef = useRef(true);
    const onJointChangeRef = useRef(onJointChange);
    const onJointChangeCommitRef = useRef(onJointChangeCommit);
    const setIsDraggingRef = useRef(setIsDragging);
    const invalidateRef = useRef(invalidate);
    const setActiveJointRef = useRef(setActiveJoint);
    
    const currentSelectionRef = useRef<{ id: string | null, subType: string | null }>({ id: null, subType: null });
    const currentHoverRef = useRef<{ id: string | null, subType: string | null }>({ id: null, subType: null });
    
    const isDraggingJoint = useRef(false);
    const dragJoint = useRef<any>(null);
    const dragHitDistance = useRef(0);
    const lastRayRef = useRef(new THREE.Ray());
    
    const showVisualRef = useRef(showVisual);
    const showCollisionRef = useRef(showCollision);

    const focusTargetRef = useRef<THREE.Vector3 | null>(null);
    const cameraTargetPosRef = useRef<THREE.Vector3 | null>(null);
    const isFocusingRef = useRef(false);

    const [highlightedFace, setHighlightedFace] = useState<{ mesh: THREE.Mesh, faceIndex: number } | null>(null);
    const highlightedFaceMeshRef = useRef<THREE.Mesh | null>(null);

    // Ref to track current robot for proper cleanup (avoids stale closure issues)
    const robotRef = useRef<THREE.Object3D | null>(null);
    // Track if component is mounted to prevent state updates after unmount
    const isMountedRef = useRef(true);
    // Track loading abort controller to cancel duplicate loads
    const loadAbortRef = useRef<{ aborted: boolean }>({ aborted: false });
    
    // ============================================================
    // PERFORMANCE OPTIMIZATION: Throttle raycasting and track highlights
    // ============================================================
    // Flag to indicate if raycast needs to run (set by mouse move, camera change, etc.)
    const needsRaycastRef = useRef(false);
    // Map to track currently highlighted meshes for O(1) revert instead of traverse
    const highlightedMeshesRef = useRef<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>(new Map());
    // Track last camera position to detect camera movement
    const lastCameraPosRef = useRef(new THREE.Vector3());
    // Track last toolMode to detect mode changes
    const lastToolModeRef = useRef(toolMode);
    
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

    // PERFORMANCE: Pre-allocated vectors for triangle vertices (object pooling)
    const _triVert0 = useRef(new THREE.Vector3());
    const _triVert1 = useRef(new THREE.Vector3());
    const _triVert2 = useRef(new THREE.Vector3());
    
    // PERFORMANCE: Pre-built map of linkName -> meshes for O(1) highlight lookup
    const linkMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());
    
    // PERFORMANCE: Flat robot index for O(1) access to all entities
    const robotIndexRef = useRef<RobotIndex>(createEmptyIndex());
    
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
            // Clear all tracked highlights on unmount (direct Map access)
            highlightedMeshesRef.current.forEach((origMaterial, mesh) => {
                mesh.material = origMaterial;
            });
            highlightedMeshesRef.current.clear();
        };
    }, [scene]);
    
    // Clean up face highlight when leaving face mode
    useEffect(() => {
        if (toolMode !== 'face' && highlightedFaceMeshRef.current) {
            highlightedFaceMeshRef.current.visible = false;
        }
    }, [toolMode]);

    // Handle focus target change
    useEffect(() => {
        if (!focusTarget || !robot) return;

        let targetObj: THREE.Object3D | undefined;
        
        if ((robot as any).links && (robot as any).links[focusTarget]) {
            targetObj = (robot as any).links[focusTarget];
        } 
        else if ((robot as any).joints && (robot as any).joints[focusTarget]) {
            targetObj = (robot as any).joints[focusTarget];
        }
        else {
            targetObj = robot.getObjectByName(focusTarget);
        }

        if (targetObj) {
            // PERFORMANCE: Use pooled Box3 and Vector3s
            _pooledBox3.setFromObject(targetObj);
            const center = _pooledBox3.getCenter(_pooledVec3A);
            const size = _pooledBox3.getSize(_pooledVec3B);
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = Math.max(maxDim * 2, 0.5);
            
            // Calculate direction using pooled vector (reuse _pooledVec3B since size is no longer needed)
            const controlTarget = controls ? (controls as any).target : _pooledVec3B.set(0, 0, 0);
            _pooledVec3B.subVectors(camera.position, controlTarget).normalize();
            
            if (_pooledVec3B.lengthSq() < 0.001) _pooledVec3B.set(1, 1, 1).normalize();
            
            // Store copies (need to persist across frames)
            if (!focusTargetRef.current) focusTargetRef.current = new THREE.Vector3();
            if (!cameraTargetPosRef.current) cameraTargetPosRef.current = new THREE.Vector3();
            
            focusTargetRef.current.copy(center);
            cameraTargetPosRef.current.copy(center).add(_pooledVec3B.multiplyScalar(distance));
            isFocusingRef.current = true;
            invalidate();
        }
    }, [focusTarget, robot, camera, controls, invalidate]);

    // Animate camera focus
    useFrame((state, delta) => {
        // Skip in hardware mode to improve performance
        if (mode === 'hardware') return;

        if (isFocusingRef.current && focusTargetRef.current && cameraTargetPosRef.current && controls) {
            const orbitControls = controls as any;
            const step = 5 * delta;

            orbitControls.target.lerp(focusTargetRef.current, step);
            camera.position.lerp(cameraTargetPosRef.current, step);
            orbitControls.update();
            invalidate();

            if (camera.position.distanceTo(cameraTargetPosRef.current) < 0.01 &&
                orbitControls.target.distanceTo(focusTargetRef.current) < 0.01) {
                isFocusingRef.current = false;
            }
        }
    });

    useEffect(() => { showVisualRef.current = showVisual; }, [showVisual]);
    useEffect(() => { showCollisionRef.current = showCollision; }, [showCollision]);
    
    // Revert all highlighted meshes using the tracked Map (O(n) where n = highlighted, not total)
    const revertAllHighlights = useCallback(() => {
        revertHighlights(
            highlightedMeshesRef.current,
            showVisualRef.current,
            showCollisionRef.current
        );
    }, []);

    // PERFORMANCE: Helper function to highlight/unhighlight link geometry
    // Uses pre-built linkMeshMap for O(1) lookup instead of traverse
    const highlightGeometry = useCallback((linkName: string | null, revert: boolean, subType: 'visual' | 'collision' | undefined = undefined, meshToHighlight?: THREE.Object3D | null) => {
        if (!robot) return;

        try {
            const targetSubType = subType || (highlightMode === 'collision' ? 'collision' : 'visual');

            // OPTIMIZED: Use Map-based revert instead of traversing
            if (revert) {
                revertAllHighlights();
                return;
            }

            // PERFORMANCE: If highlighting a specific mesh, use direct access
            if (meshToHighlight && (meshToHighlight as any).isMesh) {
                const mesh = meshToHighlight as THREE.Mesh;

                // Check if this mesh should be visible based on current mode
                const isCollisionMesh = mesh.userData.isCollisionMesh ||
                                       (mesh as any).isURDFCollider ||
                                       mesh.parent?.userData.isCollisionMesh ||
                                       (mesh.parent as any)?.isURDFCollider;

                // Only highlight if it's the correct type for current mode
                if ((targetSubType === 'collision' && !isCollisionMesh) ||
                    (targetSubType === 'visual' && isCollisionMesh)) {
                    return;
                }

                if (!highlightedMeshesRef.current.has(mesh)) {
                    highlightedMeshesRef.current.set(mesh, mesh.material);
                }
                mesh.material = targetSubType === 'collision' ? collisionHighlightMaterial : highlightMaterial;

                // Only make visible if in correct mode
                if ((targetSubType === 'collision' && showCollisionRef.current) ||
                    (targetSubType === 'visual' && showVisualRef.current)) {
                    mesh.visible = true;
                    if (mesh.parent) mesh.parent.visible = true;
                }

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

                        // Only make visible if in correct mode
                        if ((targetSubType === 'collision' && showCollisionRef.current) ||
                            (targetSubType === 'visual' && showVisualRef.current)) {
                            mesh.visible = true;
                            if (mesh.parent) mesh.parent.visible = true;
                        }

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

                                // Only make visible if in correct mode
                                if ((targetSubType === 'collision' && showCollisionRef.current) ||
                                    (targetSubType === 'visual' && showVisualRef.current)) {
                                    c.visible = true;
                                    if (c.parent) c.parent.visible = true;
                                }
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
    }, [robot, highlightMode, revertAllHighlights]);

    // Keep refs up to date
    useEffect(() => {
        invalidateRef.current = invalidate;
        onJointChangeRef.current = onJointChange;
        onJointChangeCommitRef.current = onJointChangeCommit;
        setIsDraggingRef.current = setIsDragging;
        setActiveJointRef.current = setActiveJoint;
    }, [invalidate, onJointChange, onJointChangeCommit, setIsDragging, setActiveJoint]);
    
    // Mouse tracking for hover detection AND joint dragging
    useEffect(() => {
        const findNearestJoint = (obj: THREE.Object3D | null): any => {
            let curr = obj;
            while (curr) {
                if (curr.userData?.isGizmo) return null;
                if ((curr as any).isURDFJoint && (curr as any).jointType !== 'fixed') {
                    return curr;
                }
                curr = curr.parent;
            }
            return null;
        };
        
        const findParentLink = (hitObject: THREE.Object3D): THREE.Object3D | null => {
            let current: THREE.Object3D | null = hitObject;
            while (current) {
                if (current.userData?.isGizmo) return null;
                if ((current as any).isURDFLink || (current as any).type === 'URDFLink') {
                    return current;
                }
                if ((robot as any)?.links?.[current.name]) {
                    return current;
                }
                if (current === robot) break;
                current = current.parent;
            }
            return null;
        };

        const getRevoluteDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
            const axis = joint.axis || new THREE.Vector3(0, 0, 1);
            const axisWorld = axis.clone().transformDirection(joint.matrixWorld).normalize();
            const pivotPoint = new THREE.Vector3().setFromMatrixPosition(joint.matrixWorld);
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld, pivotPoint);
            
            const projStart = new THREE.Vector3();
            const projEnd = new THREE.Vector3();
            plane.projectPoint(startPt, projStart);
            plane.projectPoint(endPt, projEnd);
            
            projStart.sub(pivotPoint);
            projEnd.sub(pivotPoint);
            
            const cross = new THREE.Vector3().crossVectors(projStart, projEnd);
            const direction = Math.sign(cross.dot(axisWorld));
            return direction * projStart.angleTo(projEnd);
        };

        const getPrismaticDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
            const axis = joint.axis || new THREE.Vector3(0, 0, 1);
            const axisWorld = axis.clone().transformDirection(joint.parent.matrixWorld).normalize();
            const delta = new THREE.Vector3().subVectors(endPt, startPt);
            return delta.dot(axisWorld);
        };

        const moveRay = (toRay: THREE.Ray) => {
            if (!isDraggingJoint.current || !dragJoint.current) return;
            
            const prevHitPoint = new THREE.Vector3();
            const newHitPoint = new THREE.Vector3();
            
            lastRayRef.current.at(dragHitDistance.current, prevHitPoint);
            toRay.at(dragHitDistance.current, newHitPoint);
            
            let delta = 0;
            const jt = dragJoint.current.jointType;
            
            if (jt === 'revolute' || jt === 'continuous') {
                delta = getRevoluteDelta(dragJoint.current, prevHitPoint, newHitPoint);
            } else if (jt === 'prismatic') {
                delta = getPrismaticDelta(dragJoint.current, prevHitPoint, newHitPoint);
            }
            
            if (delta !== 0) {
                const currentAngle = dragJoint.current.angle || 0;
                let newAngle = currentAngle + delta;
                
                const limit = dragJoint.current.limit || { lower: -Math.PI, upper: Math.PI };
                if (jt === 'revolute') {
                    newAngle = Math.max(limit.lower, Math.min(limit.upper, newAngle));
                }
                
                if (dragJoint.current.setJointValue) {
                    dragJoint.current.setJointValue(newAngle);
                    invalidateRef.current();
                }
                
                if (onJointChangeRef.current) {
                    onJointChangeRef.current(dragJoint.current.name, newAngle);
                }
            }
            
            lastRayRef.current.copy(toRay);
        };

        // Core mouse move logic (will be throttled for hover, but immediate for dragging)
        const handleMouseMoveCore = (e: MouseEvent) => {
            // PERFORMANCE: State locking - skip if mouse moved less than threshold
            const dx = e.clientX - lastMousePosRef.current.x;
            const dy = e.clientY - lastMousePosRef.current.y;
            const distSq = dx * dx + dy * dy;
            
            if (distSq < MOUSE_MOVE_THRESHOLD * MOUSE_MOVE_THRESHOLD) {
                return; // Skip - mouse hasn't moved enough
            }
            
            // Update last position
            lastMousePosRef.current.x = e.clientX;
            lastMousePosRef.current.y = e.clientY;
            
            const rect = gl.domElement.getBoundingClientRect();
            mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            
            // OPTIMIZATION: Signal that raycast is needed on next frame
            needsRaycastRef.current = true;
            
            raycasterRef.current.setFromCamera(mouseRef.current, camera);
            
            if (!isOrbitDragging?.current) {
                invalidateRef.current();
            }
        };

        // Throttled version for hover detection
        const throttledMouseMove = throttle(handleMouseMoveCore, THROTTLE_INTERVAL);

        // Full handler: immediate for joint dragging, throttled for hover
        const handleMouseMove = (e: MouseEvent) => {
            // Joint dragging needs immediate response - bypass throttle
            if (isDraggingJoint.current && dragJoint.current) {
                const rect = gl.domElement.getBoundingClientRect();
                mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                raycasterRef.current.setFromCamera(mouseRef.current, camera);
                moveRay(raycasterRef.current.ray);
                invalidateRef.current();
            } else {
                // Throttled for normal hover detection
                throttledMouseMove(e);
            }
        };
        
        const handleMouseDown = (e: MouseEvent) => {
            if (!robot) return;
            
            const isStandardSelectionMode = ['select', 'translate', 'rotate', 'universal'].includes(toolMode || 'select');
            
            if (!isStandardSelectionMode) return;
            
            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            
            raycasterRef.current.setFromCamera(mouse, camera);

            const isCollisionMode = highlightMode === 'collision';

            const intersections = raycasterRef.current.intersectObject(robot, true);
            
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
                
                if (justSelectedRef) {
                    justSelectedRef.current = true;
                }
                
                const linkObj = findParentLink(hit.object);
                
                if (linkObj && onSelect) {
                    const subType = isCollisionMode ? 'collision' : 'visual';

                    if (mode === 'detail') {
                        onSelect('link', linkObj.name, subType);
                    } else {
                        const parent = linkObj.parent;
                        if (parent && (parent as any).isURDFJoint) {
                            onSelect('joint', parent.name);
                        } else {
                            onSelect('link', linkObj.name, subType);
                        }
                    }
                    
                    if (mode === 'detail' || !((linkObj.parent as any)?.isURDFJoint)) {
                        highlightGeometry(linkObj.name, false, subType);
                    }
                    
                    hoveredLinkRef.current = null;
                    (hoveredLinkRef as any).currentMesh = null;
                }
                
                const joint = isCollisionMode ? null : findNearestJoint(hit.object);
                
                if (joint) {
                    isDraggingJoint.current = true;
                    dragJoint.current = joint;
                    dragHitDistance.current = hit.distance;
                    lastRayRef.current.copy(raycasterRef.current.ray);
                    setIsDraggingRef.current?.(true);
                    if (setActiveJointRef.current) {
                        setActiveJointRef.current(joint.name);
                    }
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };
        
        const handleMouseUp = () => {
            if (isDraggingJoint.current) {
                if (onJointChangeCommitRef.current && dragJoint.current) {
                     const currentAngle = dragJoint.current.angle || 0;
                     onJointChangeCommitRef.current(dragJoint.current.name, currentAngle);
                }

                isDraggingJoint.current = false;
                dragJoint.current = null;
                setIsDraggingRef.current?.(false);
            }

            if (justSelectedRef) {
                setTimeout(() => {
                    justSelectedRef.current = false;
                }, 100);
            }
        };
        
        const handleMouseLeave = () => {
            mouseRef.current.set(-1000, -1000);
            
            if (hoveredLinkRef.current && hoveredLinkRef.current !== currentSelectionRef.current.id) {
                const isCollisionMode = highlightMode === 'collision';
                highlightGeometry(hoveredLinkRef.current, true, isCollisionMode ? 'collision' : 'visual', (hoveredLinkRef as any).currentMesh);
                hoveredLinkRef.current = null;
                (hoveredLinkRef as any).currentMesh = null;
            }

            handleMouseUp();
        };
        
        gl.domElement.addEventListener('mousemove', handleMouseMove);
        gl.domElement.addEventListener('mousedown', handleMouseDown);
        gl.domElement.addEventListener('mouseup', handleMouseUp);
        gl.domElement.addEventListener('mouseleave', handleMouseLeave);
        
        return () => {
            // Cancel throttled handler to prevent pending callbacks
            throttledMouseMove.cancel();
            gl.domElement.removeEventListener('mousemove', handleMouseMove);
            gl.domElement.removeEventListener('mousedown', handleMouseDown);
            gl.domElement.removeEventListener('mouseup', handleMouseUp);
            gl.domElement.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [gl, camera, robot, onSelect, highlightGeometry, highlightMode, toolMode, mode, justSelectedRef, isOrbitDragging]);
    
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
                 while(obj) {
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

        raycasterRef.current.setFromCamera(mouseRef.current, camera);
        const isCollisionMode = highlightMode === 'collision';
        
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
    
    // Update collision visibility when showCollision changes (OPTIMIZED: uses robotIndex)
    useEffect(() => {
        if (!robot || robotIndexRef.current.linksCollision.size === 0) return;

        console.log('[RobotModel] Collision visibility effect triggered:', showCollision);
        const index = robotIndexRef.current;

        // PERFORMANCE: Use flat index instead of traverse
        let updatedCount = 0;
        index.linksCollision.forEach((meshes) => {
            for (let i = 0; i < meshes.length; i++) {
                const mesh = meshes[i];

                // Set mesh visibility
                mesh.visible = showCollision;
                updatedCount++;

                // Update raycast function - only enable in collision mode
                mesh.raycast = (highlightMode === 'collision' && showCollision)
                    ? THREE.Mesh.prototype.raycast
                    : emptyRaycast;

                // Update ALL URDFCollider ancestors visibility up to robot
                // This ensures collision groups are shown/hidden properly
                let parent = mesh.parent;
                while (parent && parent !== robot) {
                    if ((parent as any).isURDFCollider || (parent as any).type === 'URDFCollider') {
                        parent.visible = showCollision;
                    }
                    parent = parent.parent;
                }

                // Set material and render order
                if (showCollision) {
                    mesh.material = collisionBaseMaterial;
                    mesh.renderOrder = 999;
                } else {
                    const origMaterial = index.originalMaterials.get(mesh);
                    if (origMaterial) {
                        mesh.material = origMaterial;
                    }
                    mesh.renderOrder = 0;
                }
            }
        });

        console.log(`[RobotModel] Updated ${updatedCount} collision meshes, visibility=${showCollision}`);

        // Single invalidate call - no need for double
        invalidate();
    }, [robot, showCollision, highlightMode, invalidate]);

    // Update visual visibility when showVisual or link visibility changes (OPTIMIZED: uses robotIndex)
    useEffect(() => {
        if (!robot || robotIndexRef.current.linksVisual.size === 0) return;

        console.log('[RobotModel] Visual visibility effect triggered:', showVisual);
        const index = robotIndexRef.current;

        // PERFORMANCE: Use flat index instead of traverse
        let updatedCount = 0;
        index.linksVisual.forEach((meshes, linkName) => {
            const isLinkVisible = robotLinks?.[linkName]?.visible !== false;
            const shouldShow = isLinkVisible && showVisual;

            for (let i = 0; i < meshes.length; i++) {
                const mesh = meshes[i];

                // Set mesh visibility
                mesh.visible = shouldShow;
                updatedCount++;

                // Update raycast function - only enable when visible
                mesh.raycast = shouldShow ? THREE.Mesh.prototype.raycast : emptyRaycast;

                // Update ALL URDFVisual ancestors visibility up to robot
                let parent = mesh.parent;
                while (parent && parent !== robot) {
                    if ((parent as any).isURDFVisual || (parent as any).type === 'URDFVisual') {
                        parent.visible = shouldShow;
                    }
                    parent = parent.parent;
                }
            }
        });

        console.log(`[RobotModel] Updated ${updatedCount} visual meshes, visibility=${showVisual}`);

        // Single invalidate call - no need for double
        invalidate();
    }, [robot, robotLinks, showVisual, invalidate]);

    // Effect to handle inertia and CoM visualization (simplified - see original for full implementation)
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (child.isURDFLink) {
                const linkName = child.name || child.urdfName;
                const linkData = robotLinks?.[linkName];
                const inertialData = linkData?.inertial;
                
                if (inertialData && inertialData.mass > 0) {
                    let vizGroup = child.children.find((c: any) => c.name === '__inertia_visual__');
                    
                    if (!vizGroup) {
                        vizGroup = new THREE.Group();
                        vizGroup.name = '__inertia_visual__';
                        vizGroup.userData = { isGizmo: true };
                        child.add(vizGroup);
                    }

                    // CoM Indicator
                    let comVisual = vizGroup.children.find((c: any) => c.name === '__com_visual__');
                    if (!comVisual) {
                        comVisual = new THREE.Group();
                        comVisual.name = '__com_visual__';
                        comVisual.userData = { isGizmo: true };
                        
                        const radius = 0.03;
                        const geometry = new THREE.SphereGeometry(radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2);
                        const matBlack = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.8 });
                        const matWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 });
                        
                        const positions = [
                            [0, 0, 0], [0, Math.PI/2, 0], [0, Math.PI, 0], [0, -Math.PI/2, 0], 
                            [Math.PI, 0, 0], [Math.PI, Math.PI/2, 0], [Math.PI, Math.PI, 0], [Math.PI, -Math.PI/2, 0]
                        ];
                        
                        positions.forEach((rot, i) => {
                            const mesh = new THREE.Mesh(geometry, (i % 2 === 0) ? matBlack : matWhite);
                            mesh.rotation.set(rot[0], rot[1], rot[2]);
                            mesh.renderOrder = 999;
                            mesh.userData = { isGizmo: true };
                            mesh.raycast = () => {};
                            comVisual.add(mesh);
                        });
                        
                        const axes = new THREE.AxesHelper(0.1);
                        (axes.material as THREE.Material).depthTest = false;
                        (axes.material as THREE.Material).transparent = true;
                        axes.renderOrder = 999;
                        axes.userData = { isGizmo: true };
                        axes.raycast = () => {};
                        comVisual.add(axes);

                        vizGroup.add(comVisual);
                    }
                    comVisual.visible = showCenterOfMass;
                    
                    // Inertia Box
                    let inertiaBox = vizGroup.children.find((c: any) => c.name === '__inertia_box__');
                    
                    if (!inertiaBox) {
                        const boxData = MathUtils.computeInertiaBox(inertialData);
                        
                        if (boxData) {
                            const { width, height, depth, rotation } = boxData;
                            const geom = new THREE.BoxGeometry(width, height, depth);
                            
                            inertiaBox = new THREE.Group();
                            inertiaBox.name = '__inertia_box__';
                            inertiaBox.userData = { isGizmo: true };

                            const mat = new THREE.MeshBasicMaterial({ 
                                color: 0x4a9eff, 
                                transparent: true,
                                opacity: 0.2,
                                depthWrite: false,
                                depthTest: false
                            });
                            const mesh = new THREE.Mesh(geom, mat);
                            mesh.quaternion.copy(rotation);
                            mesh.userData = { isGizmo: true };
                            mesh.raycast = () => {};
                            mesh.renderOrder = 999;
                            inertiaBox.add(mesh);

                            const edges = new THREE.EdgesGeometry(geom);
                            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ 
                                color: 0x4a9eff, 
                                transparent: true, 
                                opacity: 0.6,
                                depthWrite: false,
                                depthTest: false
                            }));
                            line.quaternion.copy(rotation);
                            line.userData = { isGizmo: true };
                            line.raycast = () => {};
                            line.renderOrder = 1000;
                            inertiaBox.add(line);

                            vizGroup.add(inertiaBox);
                        }
                    }
                    
                    if (inertiaBox) {
                        inertiaBox.visible = showInertia;
                    }

                    if (inertialData.origin) {
                        const origin = inertialData.origin;
                        const xyz = origin.xyz || { x: 0, y: 0, z: 0 };
                        const rpy = origin.rpy || { r: 0, p: 0, y: 0 };
                        vizGroup.position.set(xyz.x, xyz.y, xyz.z);
                        vizGroup.rotation.set(rpy.r, rpy.p, rpy.y);
                    }
                    
                    vizGroup.visible = showInertia || showCenterOfMass;
                }
            }
        });
        
        invalidate();

    }, [robot, showInertia, showCenterOfMass, robotVersion, invalidate, robotLinks]);

    // Effect to handle origin axes visualization (showOrigins)
    useEffect(() => {
        if (!robot) return;
        
        robot.traverse((child: any) => {
            // Add origin axes to links
            if (child.isURDFLink) {
                let originAxes = child.children.find((c: any) => c.name === '__origin_axes__');
                
                if (!originAxes && showOrigins) {
                    originAxes = new THREE.AxesHelper(originSize);
                    originAxes.name = '__origin_axes__';
                    originAxes.userData = { isGizmo: true };
                    originAxes.raycast = () => {};
                    (originAxes.material as THREE.Material).depthTest = false;
                    originAxes.renderOrder = 1000;
                    child.add(originAxes);
                }
                
                if (originAxes) {
                    originAxes.visible = showOrigins;
                    // Update size if changed
                    if (showOrigins) {
                        originAxes.scale.setScalar(originSize / 0.1); // AxesHelper default size is 1, we normalize
                    }
                }
            }
        });
        
        invalidate();
    }, [robot, showOrigins, originSize, robotVersion, invalidate]);

    // Effect to handle joint axes visualization (showJointAxes)
    useEffect(() => {
        if (!robot) return;
        
        robot.traverse((child: any) => {
            // Add joint axis indicator to joints
            if (child.isURDFJoint && child.jointType !== 'fixed') {
                let jointAxisGroup = child.children.find((c: any) => c.name === '__joint_axis__');
                
                if (!jointAxisGroup && showJointAxes) {
                    jointAxisGroup = new THREE.Group();
                    jointAxisGroup.name = '__joint_axis__';
                    jointAxisGroup.userData = { isGizmo: true };
                    
                    // Create arrow helper along joint axis
                    const axis = child.axis || new THREE.Vector3(0, 0, 1);
                    const axisNormalized = axis.clone().normalize();
                    
                    // Main axis arrow (red for rotation axis)
                    const arrowHelper = new THREE.ArrowHelper(
                        axisNormalized,
                        new THREE.Vector3(0, 0, 0),
                        jointAxisSize,
                        0xff0000, // Red color
                        jointAxisSize * 0.2,
                        jointAxisSize * 0.1
                    );
                    arrowHelper.userData = { isGizmo: true };
                    arrowHelper.raycast = () => {};
                    jointAxisGroup.add(arrowHelper);
                    
                    // Add rotation indicator ring for revolute joints
                    if (child.jointType === 'revolute' || child.jointType === 'continuous') {
                        const ringGeometry = new THREE.TorusGeometry(jointAxisSize * 0.3, jointAxisSize * 0.02, 8, 32);
                        const ringMaterial = new THREE.MeshBasicMaterial({ 
                            color: 0xff6600, 
                            transparent: true, 
                            opacity: 0.6,
                            depthTest: false 
                        });
                        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
                        ring.userData = { isGizmo: true };
                        ring.raycast = () => {};
                        
                        // Orient ring perpendicular to axis
                        ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisNormalized);
                        ring.renderOrder = 999;
                        jointAxisGroup.add(ring);
                    }
                    
                    child.add(jointAxisGroup);
                }
                
                if (jointAxisGroup) {
                    jointAxisGroup.visible = showJointAxes;
                    // Update scale if changed
                    if (showJointAxes) {
                        jointAxisGroup.scale.setScalar(jointAxisSize);
                    }
                }
            }
        });
        
        invalidate();
    }, [robot, showJointAxes, jointAxisSize, robotVersion, invalidate]);

    // Effect to handle selection highlighting
    useEffect(() => {
        if (!robot) return;

        if (toolMode === 'measure') {
            if (currentSelectionRef.current.id) {
                highlightGeometry(currentSelectionRef.current.id, true, currentSelectionRef.current.subType as any);
            }
            currentSelectionRef.current = { id: null, subType: null };
            return;
        }
        
        if (currentSelectionRef.current.id) {
            highlightGeometry(currentSelectionRef.current.id, true, currentSelectionRef.current.subType as any);
        }
        
        let targetId: string | null = null;
        let targetSubType = selection?.subType;

        if (selection?.type === 'link' && selection.id) {
            targetId = selection.id;
        } else if (selection?.type === 'joint' && selection.id) {
            const jointObj = robot.getObjectByName(selection.id);
            if (jointObj) {
                const childLink = jointObj.children.find((c: any) => c.isURDFLink);
                if (childLink) {
                    targetId = childLink.name;
                }
            }
        }
        
        if (targetId) {
            highlightGeometry(targetId, false, targetSubType);
            currentSelectionRef.current = { id: targetId, subType: targetSubType || null };
        } else {
            currentSelectionRef.current = { id: null, subType: null };
        }
    }, [robot, selection?.type, selection?.id, selection?.subType, highlightGeometry, robotVersion, highlightMode, showCollision, toolMode]);

    // Effect to handle hover highlighting
    useEffect(() => {
        if (!robot) return;

        if (toolMode === 'measure') {
            if (currentHoverRef.current.id) {
                highlightGeometry(currentHoverRef.current.id, true, currentHoverRef.current.subType as any);
            }
            currentHoverRef.current = { id: null, subType: null };
            return;
        }
        
        if (currentHoverRef.current.id) {
            if (currentHoverRef.current.id !== selection?.id || currentHoverRef.current.subType !== selection?.subType) {
                highlightGeometry(currentHoverRef.current.id, true, currentHoverRef.current.subType as any);
            }
        }
        
        if (hoveredSelection?.type === 'link' && hoveredSelection.id) {
            highlightGeometry(hoveredSelection.id, false, hoveredSelection.subType);
            currentHoverRef.current = { id: hoveredSelection.id, subType: hoveredSelection.subType || null };
        } else {
            currentHoverRef.current = { id: null, subType: null };
        }
    }, [robot, hoveredSelection?.id, hoveredSelection?.subType, selection?.id, selection?.subType, highlightGeometry, robotVersion, toolMode]);

    // Load robot with proper cleanup and abort handling
    useEffect(() => {
        if (!urdfContent) return;
        
        // Create abort controller for this load
        const abortController = { aborted: false };
        loadAbortRef.current = abortController;
        
        // Cleanup previous robot before loading new one
        const cleanupPreviousRobot = () => {
            if (robotRef.current) {
                // Remove from scene first
                if (robotRef.current.parent) {
                    robotRef.current.parent.remove(robotRef.current);
                }
                // Deep dispose with shared materials exclusion
                disposeObject3D(robotRef.current, true, SHARED_MATERIALS);
                robotRef.current = null;
            }
        };
        
        const loadRobot = async () => {
            try {
                // Cleanup any existing robot before loading new one
                cleanupPreviousRobot();
                
                // PERFORMANCE: Reset unit detection for new model
                resetUnitDetection();
                
                const urdfDir = '';
                
                // PERFORMANCE: Build asset index once for O(1) lookups
                const assetIndex = buildAssetIndex(assets, urdfDir);
                
                const manager = createLoadingManager(assets, urdfDir);

                manager.onLoad = () => {
                    if (!abortController.aborted && isMountedRef.current && robotRef.current) {
                        console.log('[RobotModel] All meshes loaded, rebuilding index...');

                        // Rebuild index after all meshes are loaded
                        const newIndex = buildRobotIndex(
                            robotRef.current,
                            showCollisionRef.current,
                            showVisualRef.current
                        );

                        console.log('[RobotModel] Index rebuilt after mesh load:', {
                            visualLinks: newIndex.linksVisual.size,
                            collisionLinks: newIndex.linksCollision.size,
                            totalVisualMeshes: Array.from(newIndex.linksVisual.values()).reduce((sum, arr) => sum + arr.length, 0),
                            totalCollisionMeshes: Array.from(newIndex.linksCollision.values()).reduce((sum, arr) => sum + arr.length, 0),
                        });

                        robotIndexRef.current = newIndex;

                        // Update linkMeshMap
                        const newLinkMeshMap = new Map<string, THREE.Mesh[]>();
                        newIndex.linksVisual.forEach((meshes, linkName) => {
                            newLinkMeshMap.set(`${linkName}:visual`, meshes);
                        });
                        newIndex.linksCollision.forEach((meshes, linkName) => {
                            newLinkMeshMap.set(`${linkName}:collision`, meshes);
                        });
                        linkMeshMapRef.current = newLinkMeshMap;

                        // Apply visibility settings to newly loaded meshes (no state updates)
                        newIndex.linksCollision.forEach((meshes) => {
                            for (let i = 0; i < meshes.length; i++) {
                                const mesh = meshes[i];
                                mesh.visible = showCollisionRef.current;
                                let parent = mesh.parent;
                                while (parent && parent !== robotRef.current) {
                                    if ((parent as any).isURDFCollider || (parent as any).type === 'URDFCollider') {
                                        parent.visible = showCollisionRef.current;
                                    }
                                    parent = parent.parent;
                                }
                                mesh.raycast = (highlightMode === 'collision' && showCollisionRef.current)
                                    ? THREE.Mesh.prototype.raycast
                                    : emptyRaycast;
                                if (showCollisionRef.current) {
                                    mesh.material = collisionBaseMaterial;
                                    mesh.renderOrder = 999;
                                } else {
                                    mesh.renderOrder = 0;
                                }
                            }
                        });

                        newIndex.linksVisual.forEach((meshes, linkName) => {
                            const isLinkVisible = robotLinks?.[linkName]?.visible !== false;
                            const shouldShow = isLinkVisible && showVisualRef.current;
                            for (let i = 0; i < meshes.length; i++) {
                                const mesh = meshes[i];
                                mesh.visible = shouldShow;
                                mesh.raycast = shouldShow ? THREE.Mesh.prototype.raycast : emptyRaycast;
                                let parent = mesh.parent;
                                while (parent && parent !== robotRef.current) {
                                    if ((parent as any).isURDFVisual || (parent as any).type === 'URDFVisual') {
                                        parent.visible = shouldShow;
                                    }
                                    parent = parent.parent;
                                }
                            }
                        });

                        // Only update robotVersion, don't call invalidate() to avoid triggering effects
                        setRobotVersion(v => v + 1);
                    }
                };

                const loader = new URDFLoader(manager);
                loader.parseVisual = true;  // Explicitly enable visual parsing
                loader.parseCollision = true;
                // PERFORMANCE: Pass assetIndex for O(1) mesh path resolution
                loader.loadMeshCb = createMeshLoader(assets, manager, urdfDir, assetIndex);
                loader.packages = (pkg: string) => '';
                
                const robotModel = loader.parse(urdfContent);

                // Debug: Check what was parsed
                if (robotModel) {
                    console.log('[RobotModel] Parsed robot structure:', {
                        parseVisual: loader.parseVisual,
                        parseCollision: loader.parseCollision,
                        links: Object.keys((robotModel as any).links || {}),
                        childrenCount: robotModel.children.length
                    });

                    // Check first link structure
                    const firstLink = robotModel.children[0];
                    if (firstLink) {
                        console.log('[RobotModel] First link structure:', {
                            name: firstLink.name,
                            type: (firstLink as any).type,
                            childrenCount: firstLink.children.length,
                            childrenTypes: firstLink.children.map((c: any) => `${c.name}(${c.type}, isURDFCollider=${!!c.isURDFCollider}, isURDFVisual=${!!c.isURDFVisual})`)
                        });
                    }
                }

                // Check if load was aborted (e.g., by StrictMode remount or urdfContent change)
                if (abortController.aborted) {
                    // Dispose the loaded model since we don't need it
                    if (robotModel) {
                        disposeObject3D(robotModel, true, SHARED_MATERIALS);
                    }
                    return;
                }
                
                if (robotModel && isMountedRef.current) {
                    enhanceMaterials(robotModel);

                    // PERFORMANCE: Build comprehensive flat index (single traverse)
                    // This replaces the old manual traverse and linkMeshMap building
                    const newIndex = buildRobotIndex(
                        robotModel,
                        showCollisionRef.current,
                        showVisualRef.current
                    );

                    console.log('[RobotModel] Index built:', {
                        visualLinks: newIndex.linksVisual.size,
                        collisionLinks: newIndex.linksCollision.size,
                        totalVisualMeshes: Array.from(newIndex.linksVisual.values()).reduce((sum, arr) => sum + arr.length, 0),
                        totalCollisionMeshes: Array.from(newIndex.linksCollision.values()).reduce((sum, arr) => sum + arr.length, 0),
                        links: Array.from(newIndex.linksVisual.keys()),
                    });

                    robotIndexRef.current = newIndex;

                    // PERFORMANCE: Build legacy linkMeshMap from new index for backward compatibility
                    const newLinkMeshMap = new Map<string, THREE.Mesh[]>();
                    newIndex.linksVisual.forEach((meshes, linkName) => {
                        newLinkMeshMap.set(`${linkName}:visual`, meshes);
                    });
                    newIndex.linksCollision.forEach((meshes, linkName) => {
                        newLinkMeshMap.set(`${linkName}:collision`, meshes);
                    });
                    linkMeshMapRef.current = newLinkMeshMap;

                    // PERFORMANCE: Freeze static matrices for non-kinematic visual nodes
                    freezeStaticMatrices(newIndex);

                    // Set initial visibility for collision meshes based on showCollision state
                    newIndex.linksCollision.forEach((meshes) => {
                        for (let i = 0; i < meshes.length; i++) {
                            const mesh = meshes[i];

                            // Set mesh visibility
                            mesh.visible = showCollisionRef.current;

                            // Update ALL URDFCollider ancestors visibility
                            let parent = mesh.parent;
                            while (parent && parent !== robotModel) {
                                if ((parent as any).isURDFCollider || (parent as any).type === 'URDFCollider') {
                                    parent.visible = showCollisionRef.current;
                                }
                                parent = parent.parent;
                            }

                            // Set raycast behavior - only enable in collision mode
                            mesh.raycast = (highlightMode === 'collision' && showCollisionRef.current)
                                ? THREE.Mesh.prototype.raycast
                                : emptyRaycast;

                            // Apply collision material if showing
                            if (showCollisionRef.current) {
                                mesh.material = collisionBaseMaterial;
                                mesh.renderOrder = 999;
                            } else {
                                // Keep original material but ensure mesh is hidden
                                mesh.renderOrder = 0;
                            }
                        }
                    });

                    // Set initial visibility for visual meshes (respect showVisual prop)
                    newIndex.linksVisual.forEach((meshes, linkName) => {
                        const isLinkVisible = robotLinks?.[linkName]?.visible !== false;
                        const shouldShow = isLinkVisible && showVisualRef.current;

                        for (let i = 0; i < meshes.length; i++) {
                            const mesh = meshes[i];
                            mesh.visible = shouldShow;
                            // Set raycast behavior based on visibility
                            mesh.raycast = shouldShow ? THREE.Mesh.prototype.raycast : emptyRaycast;

                            // Update ALL URDFVisual ancestors visibility
                            let parent = mesh.parent;
                            while (parent && parent !== robotModel) {
                                if ((parent as any).isURDFVisual || (parent as any).type === 'URDFVisual') {
                                    parent.visible = shouldShow;
                                }
                                parent = parent.parent;
                            }
                        }
                    });

                    // Store in ref for cleanup
                    robotRef.current = robotModel;
                    setRobot(robotModel);
                    setError(null);

                    if (onRobotLoaded) {
                        onRobotLoaded(robotModel);
                    }

                    // Trigger a render after the state update completes
                    requestAnimationFrame(() => {
                        invalidate();
                    });
                }
            } catch (err) {
                if (!abortController.aborted && isMountedRef.current) {
                    console.error('[URDFViewer] Failed to load URDF:', err);
                    setError(err instanceof Error ? err.message : 'Unknown error');
                }
            }
        };
        
        loadRobot();
        
        // Cleanup function - runs on unmount or when dependencies change
        return () => {
            // Mark this load as aborted to prevent state updates
            abortController.aborted = true;
            
            // Deep cleanup of robot resources
            if (robotRef.current) {
                // Remove from scene
                if (robotRef.current.parent) {
                    robotRef.current.parent.remove(robotRef.current);
                }
                // Dispose all geometries, materials (except shared), and textures
                disposeObject3D(robotRef.current, true, SHARED_MATERIALS);
                robotRef.current = null;
            }
        };
    }, [urdfContent, assets]);
    
    // Track component mount state for preventing state updates after unmount
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);
    
    if (error) {
        return (
            <Html center>
                <div className="bg-red-900/80 text-red-200 px-4 py-2 rounded text-sm">
                    Error: {error}
                </div>
            </Html>
        );
    }
    
    if (!robot) {
        return (
            <Html center>
                <div className="text-slate-500 dark:text-slate-400 text-sm">{t.loadingRobot}</div>
            </Html>
        );
    }
    
    return (
        <>
            <primitive object={robot} />
            {(() => {
                const shouldShow = mode === 'detail' && highlightMode === 'collision' && transformMode !== 'select' && selection?.subType === 'collision';
                return shouldShow ? (
                    <CollisionTransformControls
                        robot={robot}
                        selection={selection}
                        transformMode={transformMode}
                        setIsDragging={(dragging) => setIsDraggingRef.current?.(dragging)}
                        onTransformEnd={onCollisionTransformEnd}
                        robotLinks={robotLinks}
                        lang={t === translations['zh'] ? 'zh' : 'en'}
                    />
                ) : null;
            })()}
        </>
    );
});
