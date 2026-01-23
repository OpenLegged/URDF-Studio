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
import { createLoadingManager, createMeshLoader } from './loaders';
import { loadMJCFToThreeJS, isMJCFContent } from '../../services/mjcfLoader';
import { throttle } from '../../services/throttle';

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
// Minimum pixel movement threshold before triggering raycast (state locking)
const MOUSE_MOVE_THRESHOLD = 2;
// Throttle interval in ms (~30fps)
const THROTTLE_INTERVAL = 33;

// ============================================================
// URDF Material Parser - Extract rgba colors from URDF XML
// ============================================================
interface URDFMaterialInfo {
    name?: string;
    rgba?: [number, number, number, number];
}

function parseURDFMaterials(urdfContent: string): Map<string, URDFMaterialInfo> {
    const linkMaterials = new Map<string, URDFMaterialInfo>();
    const globalMaterials = new Map<string, URDFMaterialInfo>();

    console.log('[RobotModel] parseURDFMaterials called, content length:', urdfContent.length);

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(urdfContent, 'text/xml');

        // First pass: collect global materials (defined at robot level)
        const robotMaterials = doc.querySelectorAll('robot > material');
        robotMaterials.forEach(matEl => {
            const name = matEl.getAttribute('name');
            if (name) {
                const colorEl = matEl.querySelector('color');
                if (colorEl) {
                    const rgbaStr = colorEl.getAttribute('rgba');
                    if (rgbaStr) {
                        const parts = rgbaStr.trim().split(/\s+/).map(Number);
                        if (parts.length >= 3) {
                            globalMaterials.set(name, {
                                name,
                                rgba: [parts[0], parts[1], parts[2], parts[3] ?? 1]
                            });
                        }
                    }
                }
            }
        });

        // Second pass: get materials from each link's visual
        const links = doc.querySelectorAll('link');
        links.forEach(linkEl => {
            const linkName = linkEl.getAttribute('name');
            if (!linkName) return;

            // Get first visual's material
            const visualEl = linkEl.querySelector('visual');
            if (!visualEl) return;

            const matEl = visualEl.querySelector('material');
            if (!matEl) return;

            const matName = matEl.getAttribute('name');
            const colorEl = matEl.querySelector('color');

            if (colorEl) {
                // Inline color definition
                const rgbaStr = colorEl.getAttribute('rgba');
                if (rgbaStr) {
                    const parts = rgbaStr.trim().split(/\s+/).map(Number);
                    if (parts.length >= 3) {
                        const rgba: [number, number, number, number] = [parts[0], parts[1], parts[2], parts[3] ?? 1];
                        linkMaterials.set(linkName, {
                            name: matName || undefined,
                            rgba
                        });
                        console.log(`[RobotModel] Parsed material for link "${linkName}": rgba=[${rgba.join(', ')}]`);
                    }
                }
            } else if (matName && globalMaterials.has(matName)) {
                // Reference to global material
                linkMaterials.set(linkName, globalMaterials.get(matName)!);
                console.log(`[RobotModel] Link "${linkName}" uses global material "${matName}"`);
            }
        });
    } catch (error) {
        console.error('[RobotModel] Failed to parse URDF materials:', error);
    }

    console.log(`[RobotModel] parseURDFMaterials complete: ${linkMaterials.size} link materials, ${globalMaterials.size} global materials`);
    return linkMaterials;
}

function applyURDFMaterials(robot: THREE.Object3D, materials: Map<string, URDFMaterialInfo>): void {
    if (materials.size === 0) return;

    console.log(`[RobotModel] Applying ${materials.size} URDF materials`);
    console.log(`[RobotModel] Material link names:`, Array.from(materials.keys()).slice(0, 10));

    let appliedCount = 0;
    let meshCount = 0;

    // First, log all link names in the robot for debugging
    const robotLinkNames: string[] = [];
    robot.traverse((obj: any) => {
        if (obj.isURDFLink) {
            robotLinkNames.push(obj.name);
        }
    });
    console.log(`[RobotModel] Robot has ${robotLinkNames.length} URDFLinks:`, robotLinkNames.slice(0, 10));

    robot.traverse((child: any) => {
        if (!child.isMesh) return;
        meshCount++;

        // Find parent link - urdf-loader hierarchy: URDFLink -> URDFVisual -> Mesh
        let linkName: string | null = null;
        let current = child.parent;
        let traversePath: string[] = [];
        
        while (current && current !== robot) {
            traversePath.push(`${current.constructor?.name || current.type}(${current.name})`);
            
            // Check for URDFLink (urdf-loader sets isURDFLink = true)
            if (current.isURDFLink) {
                linkName = current.name;
                break;
            }
            // URDFVisual is between mesh and link, continue traversing
            if (current.isURDFVisual) {
                current = current.parent;
                continue;
            }
            // Fallback: check if this object's name matches a link we have material for
            if (materials.has(current.name)) {
                linkName = current.name;
                break;
            }
            current = current.parent;
        }

        if (!linkName) {
            // Last resort: try mesh name or parent names
            if (materials.has(child.name)) {
                linkName = child.name;
            } else if (child.parent && materials.has(child.parent.name)) {
                linkName = child.parent.name;
            } else if (child.parent?.parent && materials.has(child.parent.parent.name)) {
                // Mesh -> Visual -> Link
                linkName = child.parent.parent.name;
            }
        }

        // Log first few meshes for debugging
        if (meshCount <= 5) {
            console.log(`[RobotModel] Mesh #${meshCount}: path=[${traversePath.join(' -> ')}], foundLink="${linkName}", hasMaterial=${materials.has(linkName || '')}`);
        }

        if (!linkName) return;

        const matInfo = materials.get(linkName);
        if (!matInfo || !matInfo.rgba) return;

        // Apply color to mesh material
        const [r, g, b, a] = matInfo.rgba;
        const color = new THREE.Color(r, g, b);
        appliedCount++;

        if (Array.isArray(child.material)) {
            child.material = child.material.map((mat: THREE.Material) => {
                const cloned = mat.clone();
                (cloned as any).color = color;
                cloned.needsUpdate = true;
                if (a < 1) {
                    cloned.transparent = true;
                    cloned.opacity = a;
                }
                return cloned;
            });
        } else if (child.material) {
            child.material = child.material.clone();
            child.material.color = color;
            child.material.needsUpdate = true;
            if (a < 1) {
                child.material.transparent = true;
                child.material.opacity = a;
            }
        }
    });

    console.log(`[RobotModel] Applied materials to ${appliedCount}/${meshCount} meshes`);
}

/**
 * Create a visual arrow indicator for joint axis (used for both URDF and MJCF joints).
 * Color: Red for X, Green for Y, Blue for Z dominant component.
 */
function createJointAxisVisualization(axis: THREE.Vector3, size: number = 1.0): THREE.Object3D {
    const length = 0.15 * size;
    const group = new THREE.Group();
    group.name = '__joint_axis_helper__';
    group.userData.isGizmo = true;

    // Determine color based on dominant axis
    const absAxis = new THREE.Vector3(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z));
    let color: number;
    if (absAxis.x >= absAxis.y && absAxis.x >= absAxis.z) {
        color = 0xff4444; // Red for X
    } else if (absAxis.y >= absAxis.x && absAxis.y >= absAxis.z) {
        color = 0x44ff44; // Green for Y
    } else {
        color = 0x4444ff; // Blue for Z
    }

    // Create arrow shaft (cylinder)
    const shaftGeom = new THREE.CylinderGeometry(0.005, 0.005, length * 0.8, 8);
    const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
    shaft.position.y = length * 0.4;
    shaft.userData.isGizmo = true;
    shaft.raycast = () => {};
    shaft.renderOrder = 1001;
    group.add(shaft);

    // Create arrow head (cone)
    const headGeom = new THREE.ConeGeometry(0.015, length * 0.2, 8);
    const headMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = length * 0.9;
    head.userData.isGizmo = true;
    head.raycast = () => {};
    head.renderOrder = 1001;
    group.add(head);

    // Align the arrow (default points +Y) to the axis direction
    const targetDir = axis.clone().normalize();
    const upDir = new THREE.Vector3(0, 1, 0);
    if (Math.abs(targetDir.dot(upDir)) < 0.999) {
        const quaternion = new THREE.Quaternion().setFromUnitVectors(upDir, targetDir);
        group.quaternion.copy(quaternion);
    }

    return group;
}

function offsetRobotToGround(robot: THREE.Object3D): void {
    // Calculate bounding box
    const box = new THREE.Box3().setFromObject(robot);
    const minY = box.min.y;
    const minZ = box.min.z;

    console.log(`[RobotModel] Robot bounds before offset: minY=${minY.toFixed(4)}, minZ=${minZ.toFixed(4)}`);

    // Offset Y so bottom is at Y=0 (ground plane in Three.js Y-up convention)
    if (isFinite(minY) && Math.abs(minY) > 0.0001) {
        robot.position.y -= minY;
        console.log(`[RobotModel] Offset robot Y by ${-minY} to place on ground`);
    }

    // Also offset Z if there are negative Z parts (for Z-up URDF convention)
    // This ensures the robot is fully above the XY plane
    if (isFinite(minZ) && minZ < -0.0001) {
        robot.position.z -= minZ;
        console.log(`[RobotModel] Offset robot Z by ${-minZ} to remove negative Z parts`);
    }
}

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
    modelOpacity = 1.0,
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
            const box = new THREE.Box3().setFromObject(targetObj);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const distance = Math.max(maxDim * 2, 0.5);
            const direction = new THREE.Vector3().subVectors(camera.position, controls ? (controls as any).target : new THREE.Vector3(0, 0, 0)).normalize();

            if (direction.lengthSq() < 0.001) direction.set(1, 1, 1).normalize();

            const newPos = center.clone().add(direction.multiplyScalar(distance));

            focusTargetRef.current = center;
            cameraTargetPosRef.current = newPos;
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
    }, [robot, showCollision, showVisual, highlightMode, revertAllHighlights]);

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
        /**
         * Find the parent link of the clicked object
         * Matching robot_viewer/JointDragControls.js findParentLink()
         * 
         * MJCF hierarchy: JointNode -> GeomCompensationGroup -> LinkGroup -> visual -> Mesh
         * URDF hierarchy: JointNode -> LinkGroup -> visual -> Mesh
         * Must traverse up through any intermediate groups to find the true URDFLink.
         */
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

        /**
         * Find the parent joint of a link (for drag rotation)
         * Matching robot_viewer/JointDragControls.js findParentJoint()
         * 
         * Key: We need to find the joint that CONNECTS this link to its parent.
         * 
         * MJCF hierarchy (must traverse through GeomCompensationGroup):
         *   BodyOffsetGroup
         *   └── JointNode (isURDFJoint) ← target
         *       └── GeomCompensationGroup (intermediate)
         *           └── LinkGroup (isURDFLink) ← starting point
         * 
         * URDF hierarchy:
         *   JointNode (isURDFJoint) ← target
         *   └── LinkGroup (isURDFLink) ← starting point
         */
        const findParentJoint = (linkObject: THREE.Object3D | null): any => {
            if (!linkObject) return null;

            // Traverse up through parent nodes, skipping intermediate groups
            // until we find a node with isURDFJoint marker
            let current: THREE.Object3D | null = linkObject.parent;
            
            while (current && current !== robot) {
                // Check if this is a joint node
                if ((current as any).isURDFJoint || (current as any).type === 'URDFJoint') {
                    const jointType = (current as any).jointType;
                    
                    // Skip fixed joints - continue searching upward for a movable joint
                    if (jointType === 'fixed') {
                        // Find the next link up in the hierarchy
                        let parentLink: THREE.Object3D | null = current.parent;
                        while (parentLink && parentLink !== robot) {
                            if ((parentLink as any).isURDFLink || (parentLink as any).type === 'URDFLink') {
                                return findParentJoint(parentLink);
                            }
                            parentLink = parentLink.parent;
                        }
                        return null;
                    }
                    
                    // Found a movable joint
                    return current;
                }
                
                // Move up to the next parent (skipping GeomCompensationGroup, BodyOffsetGroup, etc.)
                current = current.parent;
            }
            
            return null;
        };

        const getRevoluteDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
            const axis = joint.axis || new THREE.Vector3(0, 0, 1);
            
            // Transform axis from local space to world space.
            // In MJCF, axis is defined in BodyContainer (bodyOffsetGroup) local space.
            // In URDF, axis is defined in parent link space.
            // Using getWorldQuaternion ensures the axis follows body orientation correctly.
            const worldQuat = new THREE.Quaternion();
            if (joint.bodyOffsetGroup) {
                // MJCF: axis is in BodyContainer local space
                joint.bodyOffsetGroup.getWorldQuaternion(worldQuat);
            } else if (joint.parent) {
                // URDF: axis is in parent link space
                joint.parent.getWorldQuaternion(worldQuat);
            } else {
                joint.getWorldQuaternion(worldQuat);
            }
            
            const axisWorld = axis.clone().applyQuaternion(worldQuat).normalize();
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
            
            // Transform axis from local space to world space.
            // Using getWorldQuaternion ensures the axis follows body orientation correctly.
            const worldQuat = new THREE.Quaternion();
            if (joint.bodyOffsetGroup) {
                // MJCF: axis is in BodyContainer local space
                joint.bodyOffsetGroup.getWorldQuaternion(worldQuat);
            } else if (joint.parent) {
                // URDF: axis is in parent link space
                joint.parent.getWorldQuaternion(worldQuat);
            } else {
                joint.getWorldQuaternion(worldQuat);
            }
            
            const axisWorld = axis.clone().applyQuaternion(worldQuat).normalize();
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

                // Find the parent joint of the clicked link (matching robot_viewer pattern)
                const clickedLink = findParentLink(hit.object);
                const joint = isCollisionMode ? null : (clickedLink ? findParentJoint(clickedLink) : null);

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

    // Update collision visibility when showCollision changes
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (child.isURDFCollider) {
                child.visible = showCollision;
                child.traverse((inner: any) => {
                    if (inner.isMesh) {
                        inner.userData.isCollisionMesh = true;
                        inner.raycast = (highlightMode === 'collision' && showCollision)
                            ? THREE.Mesh.prototype.raycast
                            : emptyRaycast;
                    }
                });

                if (showCollision) {
                    child.traverse((innerChild: any) => {
                        if (innerChild.isMesh) {
                            innerChild.userData.isCollisionMesh = true;
                            if (innerChild.__origMaterial) {
                                innerChild.__origMaterial = collisionBaseMaterial;
                            } else {
                                innerChild.material = collisionBaseMaterial;
                            }
                            innerChild.renderOrder = 999;
                        }
                    });
                }
            }
        });
    }, [robot, showCollision, robotVersion, highlightMode]);

    // Update visual mesh visibility when showVisual changes
    // CRITICAL: Only toggle meshes marked as visual, NOT parent groups
    // This ensures collision meshes remain visible even when visual is off
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            // Handle visual group containers (from MJCF loader)
            if (child.userData?.isVisualGroup) {
                child.visible = showVisual;
                return; // Children handled by group visibility
            }
            
            // Handle individual visual meshes (marked during load)
            if (child.isMesh && child.userData?.isVisual) {
                child.visible = showVisual;
            }
            
            // Handle URDF visual meshes (check parent chain for URDFVisual)
            if (child.isMesh && !child.userData?.isCollision && !child.userData?.isCollisionMesh) {
                let parent = child.parent;
                let isUrdfVisual = false;
                while (parent && parent !== robot) {
                    if ((parent as any).isURDFVisual) {
                        isUrdfVisual = true;
                        break;
                    }
                    if ((parent as any).isURDFCollider) {
                        break; // This is a collision mesh, skip
                    }
                    parent = parent.parent;
                }
                if (isUrdfVisual) {
                    child.visible = showVisual;
                }
            }
        });
        
        invalidate();
    }, [robot, showVisual, robotVersion, invalidate]);

    // Update link axes, joint axes visibility, and model opacity
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            // Handle link coordinate axes (RGB = XYZ)
            if (child.name === '__link_axes_helper__') {
                child.visible = showOrigins;
                const scale = originSize || 1.0;
                child.scale.set(scale, scale, scale);
            }
            
            // Handle joint axis helpers (red arrow with green rotation indicator)
            if (child.name === '__joint_axis_helper__') {
                child.visible = showJointAxes;
                const scale = jointAxisSize || 1.0;
                child.scale.set(scale, scale, scale);
            }
            
            // Handle debug AxesHelper for joint pivot verification (RGB = XYZ)
            // This shows the coordinate frame at each joint pivot point
            if (child.name === '__debug_joint_axes__') {
                child.visible = showJointAxes;
                const scale = jointAxisSize || 1.0;
                child.scale.set(scale, scale, scale);
            }
            
            // Handle URDF joint axis visualization (if any)
            if (child.isURDFJoint && child.axis) {
                let axisHelper = child.children.find((c: any) => c.name === '__joint_axis_helper__');
                if (!axisHelper && showJointAxes) {
                    // Create axis helper for URDF joints that don't have one
                    const axis = child.axis as THREE.Vector3;
                    axisHelper = createJointAxisVisualization(axis, jointAxisSize);
                    child.add(axisHelper);
                }
                if (axisHelper) {
                    axisHelper.visible = showJointAxes;
                    const scale = jointAxisSize || 1.0;
                    axisHelper.scale.set(scale, scale, scale);
                }
            }

            // Apply model opacity to all meshes (except gizmos)
            if (child.isMesh && !child.userData?.isGizmo) {
                if (child.material) {
                    // Handle both single material and material array
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((mat: any) => {
                        if (mat && !mat.userData?.isSharedMaterial) {
                            mat.transparent = modelOpacity < 1.0;
                            mat.opacity = modelOpacity;
                            mat.needsUpdate = true;
                        }
                    });
                }
            }
        });
        
        invalidate();
    }, [robot, showOrigins, originSize, showJointAxes, jointAxisSize, modelOpacity, robotVersion, invalidate]);

    // Update visual visibility when link visibility changes
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (child.parent && child.parent.isURDFLink && !child.isURDFJoint && !child.isURDFCollider) {
                const linkName = child.parent.name;
                const isLinkVisible = robotLinks?.[linkName]?.visible !== false;
                child.visible = isLinkVisible;
            }
            if (child.isMesh && !child.isURDFCollider && !child.userData.isCollisionMesh) {
                let linkName = '';
                if (child.parent && child.parent.isURDFLink) linkName = child.parent.name;
                else if (child.parent && child.parent.parent && child.parent.parent.isURDFLink) linkName = child.parent.parent.name;

                const isLinkVisible = linkName ? (robotLinks?.[linkName]?.visible !== false) : true;
                child.visible = isLinkVisible;
            }
        });
    }, [robot, robotVersion, robotLinks]);

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

                    // CoM Indicator - FIXED size (not affected by model scale)
                    let comVisual = vizGroup.children.find((c: any) => c.name === '__com_visual__');
                    if (!comVisual) {
                        comVisual = new THREE.Group();
                        comVisual.name = '__com_visual__';
                        comVisual.userData = { isGizmo: true };

                        // Fixed radius for CoM sphere (0.01m = 1cm)
                        const radius = 0.01;
                        const geometry = new THREE.SphereGeometry(radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2);
                        const matBlack = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.8 });
                        const matWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 });

                        const positions = [
                            [0, 0, 0], [0, Math.PI / 2, 0], [0, Math.PI, 0], [0, -Math.PI / 2, 0],
                            [Math.PI, 0, 0], [Math.PI, Math.PI / 2, 0], [Math.PI, Math.PI, 0], [Math.PI, -Math.PI / 2, 0]
                        ];

                        positions.forEach((rot, i) => {
                            const mesh = new THREE.Mesh(geometry, (i % 2 === 0) ? matBlack : matWhite);
                            mesh.rotation.set(rot[0], rot[1], rot[2]);
                            mesh.renderOrder = 1000;
                            mesh.userData = { isGizmo: true };
                            mesh.raycast = () => { };
                            comVisual.add(mesh);
                        });

                        const axes = new THREE.AxesHelper(0.1);
                        (axes.material as THREE.Material).depthTest = false;
                        (axes.material as THREE.Material).transparent = true;
                        axes.renderOrder = 1000;
                        axes.userData = { isGizmo: true };
                        axes.raycast = () => { };
                        comVisual.add(axes);

                        vizGroup.add(comVisual);
                    }
                    comVisual.visible = showCenterOfMass;

                    // Inertia Box - clamped to link bounding box size
                    let inertiaBox = vizGroup.children.find((c: any) => c.name === '__inertia_box__');

                    if (!inertiaBox) {
                        // Calculate link bounding box for size clamping
                        let maxLinkSize: number | undefined;
                        try {
                            const linkBox = new THREE.Box3().setFromObject(child);
                            const linkSize = linkBox.getSize(new THREE.Vector3());
                            maxLinkSize = Math.max(linkSize.x, linkSize.y, linkSize.z);
                            // Use 0 if the bounding box is invalid
                            if (!isFinite(maxLinkSize) || maxLinkSize <= 0) {
                                maxLinkSize = undefined;
                            }
                        } catch (e) {
                            maxLinkSize = undefined;
                        }
                        
                        const boxData = MathUtils.computeInertiaBox(inertialData, maxLinkSize);

                        if (boxData) {
                            const { width, height, depth, rotation } = boxData;
                            const geom = new THREE.BoxGeometry(width, height, depth);

                            inertiaBox = new THREE.Group();
                            inertiaBox.name = '__inertia_box__';
                            inertiaBox.userData = { isGizmo: true };

                            const mat = new THREE.MeshBasicMaterial({
                                color: 0x00d4ff,
                                transparent: true,
                                opacity: 0.25,
                                depthWrite: false,
                                depthTest: false
                            });
                            const mesh = new THREE.Mesh(geom, mat);
                            mesh.quaternion.copy(rotation);
                            mesh.userData = { isGizmo: true };
                            mesh.raycast = () => { };
                            mesh.renderOrder = 999;
                            inertiaBox.add(mesh);

                            const edges = new THREE.EdgesGeometry(geom);
                            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
                                color: 0x00d4ff,
                                transparent: true,
                                opacity: 0.6,
                                depthWrite: false,
                                depthTest: false
                            }));
                            line.quaternion.copy(rotation);
                            line.userData = { isGizmo: true };
                            line.raycast = () => { };
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

    // Effect to handle origin axes visualization for each link
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (child.isURDFLink) {
                let originAxes = child.children.find((c: any) => c.name === '__origin_axes__');

                if (!originAxes && showOrigins) {
                    originAxes = new THREE.Group();
                    originAxes.name = '__origin_axes__';
                    originAxes.userData = { isGizmo: true };

                    const size = originSize;
                    const thickness = size * 0.04;
                    const headSize = size * 0.2;
                    const headRadius = thickness * 2.5;

                    // X Axis - Red
                    const xAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
                    const xAxisMat = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
                    const xAxis = new THREE.Mesh(xAxisGeom, xAxisMat);
                    xAxis.rotation.set(0, 0, -Math.PI / 2);
                    xAxis.position.set(size / 2, 0, 0);
                    xAxis.userData = { isGizmo: true };
                    xAxis.raycast = () => {};
                    xAxis.renderOrder = 999;
                    originAxes.add(xAxis);

                    const xConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
                    const xCone = new THREE.Mesh(xConeGeom, xAxisMat);
                    xCone.rotation.set(0, 0, -Math.PI / 2);
                    xCone.position.set(size, 0, 0);
                    xCone.userData = { isGizmo: true };
                    xCone.raycast = () => {};
                    xCone.renderOrder = 999;
                    originAxes.add(xCone);

                    // Y Axis - Green
                    const yAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
                    const yAxisMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false });
                    const yAxis = new THREE.Mesh(yAxisGeom, yAxisMat);
                    yAxis.position.set(0, size / 2, 0);
                    yAxis.userData = { isGizmo: true };
                    yAxis.raycast = () => {};
                    yAxis.renderOrder = 999;
                    originAxes.add(yAxis);

                    const yConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
                    const yCone = new THREE.Mesh(yConeGeom, yAxisMat);
                    yCone.position.set(0, size, 0);
                    yCone.userData = { isGizmo: true };
                    yCone.raycast = () => {};
                    yCone.renderOrder = 999;
                    originAxes.add(yCone);

                    // Z Axis - Blue
                    const zAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
                    const zAxisMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false });
                    const zAxis = new THREE.Mesh(zAxisGeom, zAxisMat);
                    zAxis.rotation.set(Math.PI / 2, 0, 0);
                    zAxis.position.set(0, 0, size / 2);
                    zAxis.userData = { isGizmo: true };
                    zAxis.raycast = () => {};
                    zAxis.renderOrder = 999;
                    originAxes.add(zAxis);

                    const zConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
                    const zCone = new THREE.Mesh(zConeGeom, zAxisMat);
                    zCone.rotation.set(Math.PI / 2, 0, 0);
                    zCone.position.set(0, 0, size);
                    zCone.userData = { isGizmo: true };
                    zCone.raycast = () => {};
                    zCone.renderOrder = 999;
                    originAxes.add(zCone);

                    child.add(originAxes);
                }

                if (originAxes) {
                    originAxes.visible = showOrigins;
                    // Update scale based on originSize
                    if (showOrigins) {
                        const currentSize = originSize;
                        originAxes.scale.setScalar(1);
                        // Rebuild axes if size changed significantly
                        const existingAxisMesh = originAxes.children[0];
                        if (existingAxisMesh && existingAxisMesh.geometry) {
                            const params = (existingAxisMesh.geometry as THREE.CylinderGeometry).parameters;
                            if (params && Math.abs(params.height - currentSize) > 0.001) {
                                // Remove old axes and recreate with new size
                                while (originAxes.children.length > 0) {
                                    const c = originAxes.children[0];
                                    originAxes.remove(c);
                                    if ((c as any).geometry) (c as any).geometry.dispose();
                                    if ((c as any).material) (c as any).material.dispose();
                                }

                                const size = currentSize;
                                const thickness = size * 0.04;
                                const headSize = size * 0.2;
                                const headRadius = thickness * 2.5;

                                // Recreate X Axis
                                const xAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
                                const xAxisMat = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
                                const xAxis = new THREE.Mesh(xAxisGeom, xAxisMat);
                                xAxis.rotation.set(0, 0, -Math.PI / 2);
                                xAxis.position.set(size / 2, 0, 0);
                                xAxis.userData = { isGizmo: true };
                                xAxis.raycast = () => {};
                                xAxis.renderOrder = 999;
                                originAxes.add(xAxis);

                                const xConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
                                const xCone = new THREE.Mesh(xConeGeom, xAxisMat);
                                xCone.rotation.set(0, 0, -Math.PI / 2);
                                xCone.position.set(size, 0, 0);
                                xCone.userData = { isGizmo: true };
                                xCone.raycast = () => {};
                                xCone.renderOrder = 999;
                                originAxes.add(xCone);

                                // Recreate Y Axis
                                const yAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
                                const yAxisMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false });
                                const yAxis = new THREE.Mesh(yAxisGeom, yAxisMat);
                                yAxis.position.set(0, size / 2, 0);
                                yAxis.userData = { isGizmo: true };
                                yAxis.raycast = () => {};
                                yAxis.renderOrder = 999;
                                originAxes.add(yAxis);

                                const yConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
                                const yCone = new THREE.Mesh(yConeGeom, yAxisMat);
                                yCone.position.set(0, size, 0);
                                yCone.userData = { isGizmo: true };
                                yCone.raycast = () => {};
                                yCone.renderOrder = 999;
                                originAxes.add(yCone);

                                // Recreate Z Axis
                                const zAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
                                const zAxisMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false });
                                const zAxis = new THREE.Mesh(zAxisGeom, zAxisMat);
                                zAxis.rotation.set(Math.PI / 2, 0, 0);
                                zAxis.position.set(0, 0, size / 2);
                                zAxis.userData = { isGizmo: true };
                                zAxis.raycast = () => {};
                                zAxis.renderOrder = 999;
                                originAxes.add(zAxis);

                                const zConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
                                const zCone = new THREE.Mesh(zConeGeom, zAxisMat);
                                zCone.rotation.set(Math.PI / 2, 0, 0);
                                zCone.position.set(0, 0, size);
                                zCone.userData = { isGizmo: true };
                                zCone.raycast = () => {};
                                zCone.renderOrder = 999;
                                originAxes.add(zCone);
                            }
                        }
                    }
                }
            }
        });

        invalidate();
    }, [robot, showOrigins, originSize, robotVersion, invalidate]);

    // Effect to handle joint axes visualization
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (child.isURDFJoint && child.jointType !== 'fixed') {
                let jointAxisViz = child.children.find((c: any) => c.name === '__joint_axis__');

                if (!jointAxisViz && showJointAxes) {
                    jointAxisViz = new THREE.Group();
                    jointAxisViz.name = '__joint_axis__';
                    jointAxisViz.userData = { isGizmo: true };

                    const axis = child.axis || new THREE.Vector3(0, 0, 1);
                    const axisVec = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
                    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVec);

                    const scale = jointAxisSize;
                    const color = 0xd946ef; // Purple/magenta

                    // Arrow for axis direction
                    const arrowLength = 0.35 * scale;
                    const arrowHeadLength = 0.08 * scale;
                    const arrowHeadWidth = 0.05 * scale;

                    // Arrow shaft
                    const shaftGeom = new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, arrowLength - arrowHeadLength, 8);
                    const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
                    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
                    shaft.rotation.set(Math.PI / 2, 0, 0);
                    shaft.position.set(0, 0, (arrowLength - arrowHeadLength) / 2);
                    shaft.userData = { isGizmo: true };
                    shaft.raycast = () => {};
                    shaft.renderOrder = 999;
                    jointAxisViz.add(shaft);

                    // Arrow head
                    const headGeom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
                    const head = new THREE.Mesh(headGeom, shaftMat);
                    head.rotation.set(Math.PI / 2, 0, 0);
                    head.position.set(0, 0, arrowLength - arrowHeadLength / 2);
                    head.userData = { isGizmo: true };
                    head.raycast = () => {};
                    head.renderOrder = 999;
                    jointAxisViz.add(head);

                    // For revolute/continuous joints, add rotation indicator (torus)
                    if (child.jointType === 'revolute' || child.jointType === 'continuous') {
                        const torusRadius = 0.15 * scale;
                        const tubeRadius = 0.005 * scale;
                        const torusArc = child.jointType === 'revolute' ? Math.PI * 1.5 : Math.PI * 2;
                        const torusGeom = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, 32, torusArc);
                        const torus = new THREE.Mesh(torusGeom, shaftMat);
                        torus.userData = { isGizmo: true };
                        torus.raycast = () => {};
                        torus.renderOrder = 999;
                        jointAxisViz.add(torus);

                        // Small arrow on torus to indicate rotation direction
                        const miniConeGeom = new THREE.ConeGeometry(0.015 * scale, 0.04 * scale, 8);
                        const miniCone = new THREE.Mesh(miniConeGeom, shaftMat);
                        miniCone.position.set(torusRadius, 0, 0);
                        miniCone.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
                        miniCone.userData = { isGizmo: true };
                        miniCone.raycast = () => {};
                        miniCone.renderOrder = 999;
                        jointAxisViz.add(miniCone);
                    }

                    // For prismatic joints, add bidirectional arrow
                    if (child.jointType === 'prismatic') {
                        // Second arrow in opposite direction
                        const shaft2Geom = new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, arrowLength - arrowHeadLength, 8);
                        const shaft2 = new THREE.Mesh(shaft2Geom, shaftMat);
                        shaft2.rotation.set(-Math.PI / 2, 0, 0);
                        shaft2.position.set(0, 0, -(arrowLength - arrowHeadLength) / 2);
                        shaft2.userData = { isGizmo: true };
                        shaft2.raycast = () => {};
                        shaft2.renderOrder = 999;
                        jointAxisViz.add(shaft2);

                        const head2Geom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
                        const head2 = new THREE.Mesh(head2Geom, shaftMat);
                        head2.rotation.set(-Math.PI / 2, 0, 0);
                        head2.position.set(0, 0, -(arrowLength - arrowHeadLength / 2));
                        head2.userData = { isGizmo: true };
                        head2.raycast = () => {};
                        head2.renderOrder = 999;
                        jointAxisViz.add(head2);
                    }

                    // Apply axis rotation
                    jointAxisViz.quaternion.copy(quaternion);

                    child.add(jointAxisViz);
                }

                if (jointAxisViz) {
                    jointAxisViz.visible = showJointAxes;

                    // Update scale if jointAxisSize changed
                    if (showJointAxes) {
                        // Store the original scale factor used
                        if (!jointAxisViz.userData.originalScale) {
                            jointAxisViz.userData.originalScale = jointAxisSize;
                        }

                        const currentScale = jointAxisSize;
                        const originalScale = jointAxisViz.userData.originalScale;

                        if (Math.abs(currentScale - originalScale) > 0.01) {
                            // Need to recreate with new scale - remove old and mark for recreation
                            child.remove(jointAxisViz);
                            jointAxisViz.traverse((obj: any) => {
                                if (obj.geometry) obj.geometry.dispose();
                                if (obj.material) obj.material.dispose();
                            });

                            // Create new joint axis visualization with updated scale
                            const newJointAxisViz = new THREE.Group();
                            newJointAxisViz.name = '__joint_axis__';
                            newJointAxisViz.userData = { isGizmo: true, originalScale: currentScale };

                            const axis = child.axis || new THREE.Vector3(0, 0, 1);
                            const axisVec = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
                            const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVec);

                            const scale = currentScale;
                            const color = 0xd946ef;

                            const arrowLength = 0.35 * scale;
                            const arrowHeadLength = 0.08 * scale;
                            const arrowHeadWidth = 0.05 * scale;

                            const shaftGeom = new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, arrowLength - arrowHeadLength, 8);
                            const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
                            const shaft = new THREE.Mesh(shaftGeom, shaftMat);
                            shaft.rotation.set(Math.PI / 2, 0, 0);
                            shaft.position.set(0, 0, (arrowLength - arrowHeadLength) / 2);
                            shaft.userData = { isGizmo: true };
                            shaft.raycast = () => {};
                            shaft.renderOrder = 999;
                            newJointAxisViz.add(shaft);

                            const headGeom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
                            const head = new THREE.Mesh(headGeom, shaftMat);
                            head.rotation.set(Math.PI / 2, 0, 0);
                            head.position.set(0, 0, arrowLength - arrowHeadLength / 2);
                            head.userData = { isGizmo: true };
                            head.raycast = () => {};
                            head.renderOrder = 999;
                            newJointAxisViz.add(head);

                            if (child.jointType === 'revolute' || child.jointType === 'continuous') {
                                const torusRadius = 0.15 * scale;
                                const tubeRadius = 0.005 * scale;
                                const torusArc = child.jointType === 'revolute' ? Math.PI * 1.5 : Math.PI * 2;
                                const torusGeom = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, 32, torusArc);
                                const torus = new THREE.Mesh(torusGeom, shaftMat);
                                torus.userData = { isGizmo: true };
                                torus.raycast = () => {};
                                torus.renderOrder = 999;
                                newJointAxisViz.add(torus);

                                const miniConeGeom = new THREE.ConeGeometry(0.015 * scale, 0.04 * scale, 8);
                                const miniCone = new THREE.Mesh(miniConeGeom, shaftMat);
                                miniCone.position.set(torusRadius, 0, 0);
                                miniCone.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
                                miniCone.userData = { isGizmo: true };
                                miniCone.raycast = () => {};
                                miniCone.renderOrder = 999;
                                newJointAxisViz.add(miniCone);
                            }

                            if (child.jointType === 'prismatic') {
                                const shaft2Geom = new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, arrowLength - arrowHeadLength, 8);
                                const shaft2 = new THREE.Mesh(shaft2Geom, shaftMat);
                                shaft2.rotation.set(-Math.PI / 2, 0, 0);
                                shaft2.position.set(0, 0, -(arrowLength - arrowHeadLength) / 2);
                                shaft2.userData = { isGizmo: true };
                                shaft2.raycast = () => {};
                                shaft2.renderOrder = 999;
                                newJointAxisViz.add(shaft2);

                                const head2Geom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
                                const head2 = new THREE.Mesh(head2Geom, shaftMat);
                                head2.rotation.set(-Math.PI / 2, 0, 0);
                                head2.position.set(0, 0, -(arrowLength - arrowHeadLength / 2));
                                head2.userData = { isGizmo: true };
                                head2.raycast = () => {};
                                head2.renderOrder = 999;
                                newJointAxisViz.add(head2);
                            }

                            newJointAxisViz.quaternion.copy(quaternion);
                            child.add(newJointAxisViz);
                        }
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

                let robotModel: THREE.Object3D | null = null;

                // Check if content is MJCF (MuJoCo XML)
                if (isMJCFContent(urdfContent)) {
                    console.log('[RobotModel] Detected MJCF content, using MJCF loader');
                    console.log('[RobotModel] Content snippet:', urdfContent.substring(0, 200));
                    robotModel = await loadMJCFToThreeJS(urdfContent, assets);

                    if (abortController.aborted) {
                        if (robotModel) {
                            disposeObject3D(robotModel, true, SHARED_MATERIALS);
                        }
                        return;
                    }
                } else {
                    console.log('[RobotModel] Detected Standard URDF content');
                    console.log('[RobotModel] Content snippet:', urdfContent.substring(0, 200));
                    // Standard URDF loading
                    const urdfDir = '';
                    const manager = createLoadingManager(assets, urdfDir);
                    manager.onLoad = () => {
                        if (!abortController.aborted && isMountedRef.current) {
                            console.log('[RobotModel] All assets loaded. Applying materials and updating view.');

                            // Apply URDF materials AFTER meshes are fully loaded
                            // This is critical because meshes load asynchronously
                            const materials = parseURDFMaterials(urdfContent);
                            applyURDFMaterials(robotModel!, materials);
                            
                            // Re-run enhanceMaterials to ensure proper lighting on loaded meshes
                            enhanceMaterials(robotModel!);
                            
                            // Re-offset to ground after meshes are loaded (bounds may have changed)
                            offsetRobotToGround(robotModel!);

                            // Log final stats
                            const box = new THREE.Box3().setFromObject(robotModel!);
                            const size = box.getSize(new THREE.Vector3());
                            let meshCount = 0;
                            let visibleMeshCount = 0;
                            robotModel!.traverse((c: any) => {
                                if (c.isMesh) {
                                    meshCount++;
                                    if (c.visible) visibleMeshCount++;
                                }
                            });
                            console.log(`[RobotModel] Final robot stats (at onLoad):`, {
                                bounds: JSON.stringify({ size: size, min: box.min, max: box.max }),
                                meshCount,
                                visibleMeshCount,
                                scale: robotModel!.scale
                            });

                            setRobotVersion(v => v + 1);
                            invalidate();
                        }
                    };

                    const loader = new URDFLoader(manager);
                    loader.parseCollision = true;
                    loader.loadMeshCb = createMeshLoader(assets, manager, urdfDir);
                    loader.packages = (pkg: string) => '';

                    robotModel = loader.parse(urdfContent);

                    // Check if load was aborted (e.g., by StrictMode remount or urdfContent change)
                    if (abortController.aborted) {
                        // Dispose the loaded model since we don't need it
                        if (robotModel) {
                            disposeObject3D(robotModel, true, SHARED_MATERIALS);
                        }
                        return;
                    }
                }

                if (robotModel && isMountedRef.current) {
                    // Apply URDF materials from XML (urdf-loader doesn't handle inline rgba)
                    if (!isMJCFContent(urdfContent)) {
                        const materials = parseURDFMaterials(urdfContent);
                        applyURDFMaterials(robotModel, materials);
                    }

                    // Offset robot so bottom is at ground level (Y=0)
                    offsetRobotToGround(robotModel);

                    enhanceMaterials(robotModel);

                    // PERFORMANCE: Build linkName -> meshes map and inject userData in single traverse
                    // This eliminates the need for traverse in highlightGeometry
                    const newLinkMeshMap = new Map<string, THREE.Mesh[]>();

                    robotModel.traverse((child: any) => {
                        // Find parent link for this object
                        let parentLink: any = null;
                        let current = child;
                        while (current) {
                            if (current.isURDFLink || (robotModel as any).links?.[current.name]) {
                                parentLink = current;
                                break;
                            }
                            current = current.parent;
                        }

                        // Handle collision meshes
                        if (child.isURDFCollider) {
                            child.visible = showCollisionRef.current;
                            child.traverse((inner: any) => {
                                if (inner.isMesh) {
                                    inner.userData.isCollisionMesh = true;
                                    // Inject parent link name for fast lookup
                                    if (parentLink) {
                                        inner.userData.parentLinkName = parentLink.name;
                                    }
                                    // Add to link mesh map
                                    if (parentLink) {
                                        const key = `${parentLink.name}:collision`;
                                        if (!newLinkMeshMap.has(key)) {
                                            newLinkMeshMap.set(key, []);
                                        }
                                        newLinkMeshMap.get(key)!.push(inner);
                                    }
                                }
                            });
                        }
                        // Handle visual meshes
                        else if (child.isMesh && !child.userData.isCollisionMesh) {
                            // Check if it's a visual (not a joint or collider)
                            let isVisual = false;
                            let checkParent = child.parent;
                            while (checkParent) {
                                if (checkParent.isURDFCollider) {
                                    break; // Already handled as collision
                                }
                                if (checkParent.isURDFLink) {
                                    isVisual = true;
                                    break;
                                }
                                checkParent = checkParent.parent;
                            }

                            if (isVisual && parentLink) {
                                child.userData.parentLinkName = parentLink.name;
                                child.userData.isVisualMesh = true;
                                const key = `${parentLink.name}:visual`;
                                if (!newLinkMeshMap.has(key)) {
                                    newLinkMeshMap.set(key, []);
                                }
                                newLinkMeshMap.get(key)!.push(child);
                            }

                            child.visible = showVisualRef.current;
                        }
                    });

                    // Store the pre-built map
                    linkMeshMapRef.current = newLinkMeshMap;

                    // Store in ref for cleanup
                    robotRef.current = robotModel;
                    setRobot(robotModel);
                    setError(null);

                    if (onRobotLoaded) {
                        onRobotLoaded(robotModel);
                    }

                    // Diagnostic: Check robot bounds and mesh count
                    const box = new THREE.Box3().setFromObject(robotModel);
                    const size = box.getSize(new THREE.Vector3());
                    let meshCount = 0;
                    let visibleMeshCount = 0;
                    robotModel.traverse((c: any) => {
                        if (c.isMesh) {
                            meshCount++;
                            if (c.visible) visibleMeshCount++;
                        }
                    });
                    console.log(`[RobotModel] Loaded robot stats:`, {
                        bounds: { size: size, min: box.min, max: box.max },
                        meshCount,
                        visibleMeshCount,
                        position: robotModel.position
                    });
                    if (meshCount === 0) {
                        console.warn('[RobotModel] No meshes found in loaded robot!');
                    } else if (size.lengthSq() < 0.000001) {
                        console.warn('[RobotModel] Robot bounds are effectively zero!');
                    }
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
