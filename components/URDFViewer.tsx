/**
 * URDF Viewer Component
 * Uses urdf-loader library for professional URDF rendering
 * Inspired by robot_viewer demo
 */

import React, { Suspense, useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport, Html, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
import { RotateCcw, Move, ArrowUpRight } from 'lucide-react';
// @ts-ignore
import URDFLoader from 'urdf-loader';
import { translations, Language } from '../services/i18n';
import { MathUtils } from '../services/mathUtils';
import { Theme, UrdfLink } from '../types';

interface URDFViewerProps {
    urdfContent: string;
    assets: Record<string, string>; // filename -> blob URL
    onJointChange?: (jointName: string, angle: number) => void;
    lang: Language;
    mode?: 'detail' | 'hardware';
    onSelect?: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
    theme: Theme;
    selection?: { type: 'link' | 'joint' | null; id: string | null; subType?: 'visual' | 'collision' };
    hoveredSelection?: { type: 'link' | 'joint' | null; id: string | null; subType?: 'visual' | 'collision' };
    robotLinks?: Record<string, UrdfLink>; // Link data from the app state, contains inertial info
    focusTarget?: string | null;
}

// Clean file path (remove '..' and '.', normalize slashes)
const cleanFilePath = (path: string): string => {
    return path
        .replace(/\\/g, '/')
        .split(/\//g)
        .reduce((acc: string[], el: string) => {
            if (el === '..') acc.pop();
            else if (el !== '.') acc.push(el);
            return acc;
        }, [])
        .join('/');
};

// Find file in assets by path with multiple strategies
const findAssetByPath = (path: string, assets: Record<string, string>, urdfDir: string = ''): string | null => {
    // Strategy 0: Direct match
    if (assets[path]) return assets[path];
    
    // Clean the path first
    let cleanPath = path.replace(/\\/g, '/');
    
    // Remove blob: prefix if present
    cleanPath = cleanPath.replace(/^blob:[^\/]+\//, '');
    
    // Remove package:// prefix
    if (cleanPath.startsWith('package://')) {
        cleanPath = cleanPath.replace(/^package:\/\//, '');
        // Remove package name (first segment)
        const parts = cleanPath.split('/');
        if (parts.length > 1) {
            cleanPath = parts.slice(1).join('/');
        }
    }
    
    // Remove leading ./
    cleanPath = cleanPath.replace(/^\.\//, '');
    
    // Normalize path (handle ../)
    const normalizedPath = cleanFilePath(cleanPath);
    
    // Build full path based on URDF directory
    const fullPath = urdfDir + normalizedPath;
    
    // Strategy 1: Full path match
    if (assets[fullPath]) return assets[fullPath];
    
    // Strategy 2: Normalized path match
    if (assets[normalizedPath]) return assets[normalizedPath];
    
    // Strategy 3: Clean path match
    if (assets[cleanPath]) return assets[cleanPath];
    
    // Strategy 4: Filename only match
    const filename = normalizedPath.split('/').pop() || '';
    if (assets[filename]) return assets[filename];
    
    // Strategy 5: Case-insensitive filename match
    const lowerFilename = filename.toLowerCase();
    const foundKey = Object.keys(assets).find(k => k.toLowerCase() === lowerFilename);
    if (foundKey) return assets[foundKey];
    
    // Strategy 6: Path suffix match
    for (const key of Object.keys(assets)) {
        const keyLower = key.toLowerCase();
        const searchLower = normalizedPath.toLowerCase();
        if (keyLower.endsWith(searchLower) || searchLower.endsWith(keyLower.split('/').pop() || '')) {
            return assets[key];
        }
    }
    
    // Strategy 7: Fuzzy matching (suffix matching)
    const cleaned = cleanFilePath(normalizedPath);
    for (const key of Object.keys(assets)) {
        const cleanedKey = cleanFilePath(key);
        const len = Math.min(cleanedKey.length, cleaned.length);
        if (len > 0 && cleaned.substring(cleaned.length - len) === cleanedKey.substring(cleanedKey.length - len)) {
            return assets[key];
        }
    }
    
    return null;
};

// Loading manager that resolves asset URLs from our blob storage
const createLoadingManager = (assets: Record<string, string>, urdfDir: string = '') => {
    const manager = new THREE.LoadingManager();
    
    manager.setURLModifier((url: string) => {
        // If already a blob/data URL, return as-is
        if (url.startsWith('blob:') || url.startsWith('data:')) {
            // Check if it's a malformed blob URL
            const blobMatch = url.match(/^blob:https?:\/\/[^\/]+\/(.+)$/);
            if (blobMatch && blobMatch[1]) {
                const fileName = blobMatch[1];
                // If it looks like a filename, it's malformed
                if (/\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp|dae|stl|obj|gltf|glb)$/i.test(fileName)) {
                    const found = findAssetByPath(fileName, assets, urdfDir);
                    if (found) return found;
                }
            }
            return url;
        }
        
        const found = findAssetByPath(url, assets, urdfDir);
        if (found) return found;
        
        console.warn('[URDFViewer] Asset not found:', url);
        return url;
    });
    
    return manager;
};

// Custom mesh loader callback
const createMeshLoader = (assets: Record<string, string>, manager: THREE.LoadingManager, urdfDir: string = '') => {
    return async (
        path: string,
        _manager: THREE.LoadingManager,
        done: (result: THREE.Object3D | null, err?: Error) => void
    ) => {
        try {
            // Find the asset URL using our path resolver
            const assetUrl = findAssetByPath(path, assets, urdfDir);
            
            if (!assetUrl) {
                console.warn('[URDFViewer] Mesh not found:', path);
                done(null, new Error(`Mesh not found: ${path}`));
                return;
            }
            
            // Determine extension from path or asset key
            const filename = path.split('/').pop() || path;
            const ext = filename.split('.').pop()?.toLowerCase();
            
            let meshObject: THREE.Object3D | null = null;
            
            if (ext === 'stl') {
                const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
                const loader = new STLLoader(manager);
                const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                // Use MeshPhongMaterial to match URDFLoader behavior
                const material = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
                meshObject = new THREE.Mesh(geometry, material);
                
            } else if (ext === 'dae') {
                const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
                const loader = new ColladaLoader(manager);
                const result = await new Promise<any>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                meshObject = result.scene;
                
                // IMPORTANT: urdf-loader will reset obj.quaternion.identity() after this callback,
                // which removes any rotation that ColladaLoader applied for Z-UP -> Y-UP conversion.
                // Since URDF uses Z-UP coordinate system and we're using a Z-UP camera setup,
                // we don't need the ColladaLoader's automatic conversion.
                // Reset the rotation that ColladaLoader may have applied.
                if (meshObject) {
                    meshObject.rotation.set(0, 0, 0);
                    meshObject.updateMatrix();
                    
                    // Remove lights from Collada (they can mess up scene lighting)
                    const lightsToRemove: THREE.Object3D[] = [];
                    meshObject.traverse((child: THREE.Object3D) => {
                        if ((child as any).isLight) {
                            lightsToRemove.push(child);
                        }
                    });
                    lightsToRemove.forEach(light => light.parent?.remove(light));
                }
                
            } else if (ext === 'obj') {
                const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
                const loader = new OBJLoader(manager);
                meshObject = await new Promise<THREE.Group>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                
            } else if (ext === 'gltf' || ext === 'glb') {
                const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
                const loader = new GLTFLoader(manager);
                const gltfModel = await new Promise<any>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                meshObject = gltfModel.scene;
            }
            
            if (meshObject) {
                done(meshObject);
            } else {
                done(null, new Error(`Unsupported mesh format: ${ext}`));
            }
            
        } catch (error) {
            console.error('[URDFViewer] Mesh loading error:', error);
            done(null, error as Error);
        }
    };
};

// Enhance materials for better lighting (from robot_viewer)
const enhanceMaterials = (robotObject: THREE.Object3D) => {
    robotObject.traverse((child: any) => {
        if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
                child.material = child.material.map((mat: THREE.Material) => enhanceSingleMaterial(mat));
            } else {
                child.material = enhanceSingleMaterial(child.material);
            }
            
            // Enable shadows
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
};

const enhanceSingleMaterial = (material: THREE.Material): THREE.Material => {
    if ((material as any).isMeshPhongMaterial || (material as any).isMeshStandardMaterial) {
        const mat = material as THREE.MeshPhongMaterial;
        
        // Increase shininess for better highlights
        if (mat.shininess !== undefined) {
            mat.shininess = 100; // Even higher shininess
        }
        
        // Enhance specular reflection
        if (!mat.specular) {
            mat.specular = new THREE.Color(0.8, 0.8, 0.8); // Brighter specular
        } else if (mat.specular.isColor) {
            mat.specular.setRGB(0.8, 0.8, 0.8);
        }
        
        // If standard material (PBR), make it more metallic/glossy
        if ((mat as any).isMeshStandardMaterial) {
            const stdMat = mat as unknown as THREE.MeshStandardMaterial;
            stdMat.roughness = 0.2; // Smoother
            stdMat.metalness = 0.1; // Slight metalness for plastic-like gloss
            stdMat.envMapIntensity = 1.0;
        }
        
        mat.needsUpdate = true;
        return mat;
        
    } else if ((material as any).isMeshBasicMaterial) {
        // Convert to Phong for better lighting
        const oldMat = material as THREE.MeshBasicMaterial;
        const newMat = new THREE.MeshPhongMaterial({
            color: oldMat.color,
            map: oldMat.map,
            transparent: oldMat.transparent,
            opacity: oldMat.opacity,
            side: oldMat.side,
            shininess: 50,
            specular: new THREE.Color(0.3, 0.3, 0.3)
        });
        return newMat;
    }
    
    return material;
};

interface RobotModelProps {
    urdfContent: string;
    assets: Record<string, string>;
    onRobotLoaded?: (robot: any) => void;
    showCollision?: boolean;
    showVisual?: boolean;
    onSelect?: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
    onJointChange?: (name: string, angle: number) => void;
    jointAngles?: Record<string, number>;
    setIsDragging?: (dragging: boolean) => void;
    setActiveJoint?: (jointName: string | null) => void;
    justSelectedRef?: React.MutableRefObject<boolean>;
    t: typeof translations['en'];
    mode?: 'detail' | 'hardware';
    highlightMode?: 'link' | 'collision';
    showInertia?: boolean;
    showCenterOfMass?: boolean;
    showOrigins?: boolean;
    showJointAxes?: boolean;
    robotLinks?: Record<string, UrdfLink>; // Link data from the app state, contains inertial info
    focusTarget?: string | null;
}

// Empty raycast function to disable raycast on collision meshes
const emptyRaycast = () => {};

// Highlight material like robot_viewer's urdf-manipulator-element
const highlightMaterial = new THREE.MeshPhongMaterial({
    shininess: 10,
    color: 0x60a5fa, // Blue-400
    emissive: 0x60a5fa,
    emissiveIntensity: 0.25,
    side: THREE.DoubleSide,
});

const collisionHighlightMaterial = new THREE.MeshPhongMaterial({
    shininess: 10,
    color: 0xfacc15, // Yellow-400 for high visibility
    emissive: 0xfacc15,
    emissiveIntensity: 0.5,
    side: THREE.DoubleSide,
});

const collisionBaseMaterial = new THREE.MeshBasicMaterial({
    color: '#a855f7', // Purple-500
    wireframe: false,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false
});

function RobotModel({ urdfContent, assets, onRobotLoaded, showCollision = false, showVisual = true, onSelect, onJointChange, jointAngles, setIsDragging, setActiveJoint, justSelectedRef, t, mode, selection, hoveredSelection, highlightMode = 'link', showInertia = false, showCenterOfMass = false, showOrigins = false, showJointAxes = false, robotLinks, focusTarget }: RobotModelProps & { selection?: URDFViewerProps['selection'], hoveredSelection?: URDFViewerProps['selection'] }) {
    const [robot, setRobot] = useState<THREE.Object3D | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [robotVersion, setRobotVersion] = useState(0); // Track async loading updates
    const { scene, camera, gl, invalidate, controls } = useThree();
    const mouseRef = useRef(new THREE.Vector2(-1000, -1000));
    const raycasterRef = useRef(new THREE.Raycaster());
    const hoveredLinkRef = useRef<string | null>(null);
    const onJointChangeRef = useRef(onJointChange);
    const setIsDraggingRef = useRef(setIsDragging);
    const invalidateRef = useRef(invalidate);
    const setActiveJointRef = useRef(setActiveJoint);
    
    // Internal refs to track current highlighted link/subtype to avoid redundant updates
    const currentSelectionRef = useRef<{ id: string | null, subType: string | null }>({ id: null, subType: null });
    const currentHoverRef = useRef<{ id: string | null, subType: string | null }>({ id: null, subType: null });
    
    // Drag state refs (like robot_viewer's JointDragControls)
    const isDraggingJoint = useRef(false);
    const dragJoint = useRef<any>(null);
    const dragHitDistance = useRef(0);
    const lastRayRef = useRef(new THREE.Ray()); // Store last ray for delta calculation
    
    // Refs for visibility to use inside loadRobot (avoiding stale closures without triggering re-loads)
    const showVisualRef = useRef(showVisual);
    const showCollisionRef = useRef(showCollision);

    // Focus animation state
    const focusTargetRef = useRef<THREE.Vector3 | null>(null);
    const cameraTargetPosRef = useRef<THREE.Vector3 | null>(null);
    const isFocusingRef = useRef(false);

    // Handle focus target change
    useEffect(() => {
        if (!focusTarget || !robot) return;

        // Find the target object
        let targetObj: THREE.Object3D | undefined;
        
        // Search in links
        if ((robot as any).links && (robot as any).links[focusTarget]) {
            targetObj = (robot as any).links[focusTarget];
        } 
        // Search in joints (if focusTarget is a joint ID, though TreeEditor passes link IDs mostly)
        else if ((robot as any).joints && (robot as any).joints[focusTarget]) {
            targetObj = (robot as any).joints[focusTarget];
        }
        // Fallback: search by name in graph
        else {
            targetObj = robot.getObjectByName(focusTarget);
        }

        if (targetObj) {
            // Calculate target center in world coordinates
            const box = new THREE.Box3().setFromObject(targetObj);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            
            // Determine optimal camera distance based on object size
            // Avoid getting too close for small objects or too far for large ones
            const distance = Math.max(maxDim * 2, 0.5);
            
            // Calculate new camera position
            // Keep current camera direction relative to target, just adjust distance/center
            const direction = new THREE.Vector3().subVectors(camera.position, controls ? (controls as any).target : new THREE.Vector3(0,0,0)).normalize();
            
            // If direction is zero (camera at target), pick a default direction
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
        if (isFocusingRef.current && focusTargetRef.current && cameraTargetPosRef.current && controls) {
            const orbitControls = controls as any;
            const step = 5 * delta; // Animation speed
            
            // Interpolate controls target (lookAt)
            orbitControls.target.lerp(focusTargetRef.current, step);
            
            // Interpolate camera position
            camera.position.lerp(cameraTargetPosRef.current, step);
            
            orbitControls.update();
            invalidate();

            // Check if close enough to stop
            if (camera.position.distanceTo(cameraTargetPosRef.current) < 0.01 && 
                orbitControls.target.distanceTo(focusTargetRef.current) < 0.01) {
                isFocusingRef.current = false;
            }
        }
    });
    useEffect(() => { showVisualRef.current = showVisual; }, [showVisual]);
    useEffect(() => { showCollisionRef.current = showCollision; }, [showCollision]);
    
    // Helper function to highlight/unhighlight link geometry (like robot_viewer)
    const highlightGeometry = useCallback((linkName: string | null, revert: boolean, subType: 'visual' | 'collision' | undefined = undefined, meshToHighlight?: THREE.Object3D | null) => {
        if (!robot) return;
        
        try {
            // Use provided subType or fall back to current highlight mode
            const targetSubType = subType || (highlightMode === 'collision' ? 'collision' : 'visual');
            
            const revertMesh = (c: any) => {
                if (c.isMesh && c.__origMaterial !== undefined) {
                    c.material = c.__origMaterial;
                    delete c.__origMaterial;
                    
                    // Restore visibility state
                    const isCollider = c.isURDFCollider || c.userData.isCollisionMesh;
                    if (isCollider) {
                        c.visible = showCollision;
                        // Ensure parent group is visible if needed (collision groups are isURDFCollider)
                        if (c.parent && c.parent.isURDFCollider) c.parent.visible = showCollision;
                        
                        // Handle both single material and array of materials
                        const materials = Array.isArray(c.material) ? c.material : [c.material];
                        materials.forEach((m: any) => {
                            if (m) {
                                m.transparent = true;
                                m.opacity = 0.4;
                            }
                        });
                        c.renderOrder = 999;
                    } else {
                        // Restore visual mesh visibility
                        c.visible = showVisual;
                        // Restore parent visual group visibility
                        if (c.parent && c.parent.parent && c.parent.parent.isURDFLink && !c.parent.isURDFCollider) {
                            c.parent.visible = showVisual;
                        }
                    }
                }
            };

            const linkObj = linkName ? (robot as any).links?.[linkName] : null;

            // If reverting, we need to restore meshes
            if (revert) {
                if (meshToHighlight) {
                    revertMesh(meshToHighlight);
                    // Also traverse children of the mesh if any (though usually meshToHighlight is a leaf-ish mesh)
                    meshToHighlight.traverse((child: any) => {
                        if (child !== meshToHighlight) revertMesh(child);
                    });
                } else if (linkObj) {
                    // Targeted revert: only revert this link's meshes
                    const traverseRevert = (c: any, isRoot: boolean) => {
                        // Stop if we hit another joint (not the root)
                        if (!isRoot && c.isURDFJoint) return;
                        
                        revertMesh(c);
                        
                        c.children.forEach((child: any) => {
                            traverseRevert(child, false);
                        });
                    };
                    traverseRevert(linkObj, true);
                } else {
                    // Global revert (fallback)
                    robot.traverse(revertMesh);
                }
                return;
            }

            if (!linkObj && !meshToHighlight) return;
            
            // Traverse the link and its children, applying highlight
            // Stop when encountering another joint (like robot_viewer)
            const traverse = (c: any, isRoot: boolean) => {
                // Stop if we hit another joint (not the root)
                if (!isRoot && c.isURDFJoint) return;
                
                // Skip gizmos (CoM, Inertia visuals)
                if (c.userData?.isGizmo) return;

                if (c.isMesh) {
                    const isCollider = c.isURDFCollider || c.userData.isCollisionMesh;
                    // If meshToHighlight is provided, only highlight that specific mesh.
                    // Otherwise highlight all meshes of the correct subType in the link.
                    const shouldHighlight = meshToHighlight 
                        ? c === meshToHighlight 
                        : ((targetSubType === 'collision' && isCollider) || (targetSubType === 'visual' && !isCollider));

                    if (shouldHighlight) {
                        // Store original material and apply highlight
                        if (c.__origMaterial === undefined) {
                            c.__origMaterial = c.material;
                        }
                        c.material = targetSubType === 'collision' ? collisionHighlightMaterial : highlightMaterial;
                        
                        // Force visibility when highlighted
                        c.visible = true;
                        
                        // Force parent visibility (important if visual group was hidden)
                        if (c.parent) c.parent.visible = true;

                        // If highlighting collision, make it opaque
                        if (isCollider && c.material) {
                            // highlight material is single MeshPhongMaterial
                            (c.material as any).transparent = false;
                            (c.material as any).opacity = 1.0;
                            c.renderOrder = 1000;
                        }
                    }
                }
                
                // Traverse children
                c.children.forEach((child: any) => {
                    traverse(child, false);
                });
            };
            
            if (meshToHighlight) {
                traverse(meshToHighlight, true);
            } else if (linkObj) {
                traverse(linkObj, true);
            }
        } catch (err) {
            console.warn("Error in highlightGeometry:", err);
        }
    }, [robot, showCollision, showVisual, highlightMode]);

    // Keep refs up to date
    useEffect(() => {
        invalidateRef.current = invalidate;
        onJointChangeRef.current = onJointChange;
        setIsDraggingRef.current = setIsDragging;
        setActiveJointRef.current = setActiveJoint;
    }, [invalidate, onJointChange, setIsDragging, setActiveJoint]);
    
    // Mouse tracking for hover detection AND joint dragging (like robot_viewer's URDFDragControls)
    useEffect(() => {
        // Helper: find nearest movable joint by traversing up hierarchy (like urdf-loader's findNearestJoint)
        const findNearestJoint = (obj: THREE.Object3D | null): any => {
            let curr = obj;
            while (curr) {
                if (curr.userData?.isGizmo) return null; // Ignore gizmos
                if ((curr as any).isURDFJoint && (curr as any).jointType !== 'fixed') {
                    return curr;
                }
                curr = curr.parent;
            }
            return null;
        };
        
        // Helper: find the link that the clicked object belongs to
        const findParentLink = (hitObject: THREE.Object3D): THREE.Object3D | null => {
            let current: THREE.Object3D | null = hitObject;
            while (current) {
                if (current.userData?.isGizmo) return null; // Ignore gizmos
                // Check if is URDFLink
                if ((current as any).isURDFLink || (current as any).type === 'URDFLink') {
                    return current;
                }
                // Also check if it's in the robot's links map
                if ((robot as any)?.links?.[current.name]) {
                    return current;
                }
                if (current === robot) break;
                current = current.parent;
            }
            return null;
        };

        // Helper: get revolute delta angle
        const getRevoluteDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
            const axis = joint.axis || new THREE.Vector3(0, 0, 1);
            const axisWorld = axis.clone().transformDirection(joint.matrixWorld).normalize();
            const pivotPoint = new THREE.Vector3().setFromMatrixPosition(joint.matrixWorld);
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axisWorld, pivotPoint);
            
            // Project points onto plane relative to pivot
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

        // Helper: get prismatic delta
        const getPrismaticDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
            const axis = joint.axis || new THREE.Vector3(0, 0, 1);
            const axisWorld = axis.clone().transformDirection(joint.parent.matrixWorld).normalize();
            const delta = new THREE.Vector3().subVectors(endPt, startPt);
            return delta.dot(axisWorld);
        };

        // moveRay function like robot_viewer's JointDragControls.moveRay
        const moveRay = (toRay: THREE.Ray) => {
            if (!isDraggingJoint.current || !dragJoint.current) return;
            
            const prevHitPoint = new THREE.Vector3();
            const newHitPoint = new THREE.Vector3();
            
            // Get point on last ray at hit distance
            lastRayRef.current.at(dragHitDistance.current, prevHitPoint);
            // Get point on new ray at same distance
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
                
                // Clamp to limits
                const limit = dragJoint.current.limit || { lower: -Math.PI, upper: Math.PI };
                if (jt === 'revolute') {
                    newAngle = Math.max(limit.lower, Math.min(limit.upper, newAngle));
                }
                
                // Apply joint change directly using setJointValue (like robot_viewer)
                if (dragJoint.current.setJointValue) {
                    dragJoint.current.setJointValue(newAngle);
                    // Trigger re-render
                    invalidateRef.current();
                }
                
                // Also call callback if available
                if (onJointChangeRef.current) {
                    onJointChangeRef.current(dragJoint.current.name, newAngle);
                }
            }
            
            // Store current ray as last ray for next frame
            lastRayRef.current.copy(toRay);
        };

        const handleMouseMove = (e: MouseEvent) => {
            const rect = gl.domElement.getBoundingClientRect();
            mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            
            // Update raycaster
            raycasterRef.current.setFromCamera(mouseRef.current, camera);
            
            // Handle dragging using moveRay (like robot_viewer)
            if (isDraggingJoint.current && dragJoint.current) {
                moveRay(raycasterRef.current.ray);
            }
        };
        
        const handleMouseDown = (e: MouseEvent) => {
            if (!robot) return;
            
            // Cast ray from mouse position
            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );
            
            raycasterRef.current.setFromCamera(mouse, camera);

            // Handle raycast for specific modes
            const isCollisionMode = highlightMode === 'collision';
            
            // Raycast is already enabled/disabled by useEffect based on mode

            const intersections = raycasterRef.current.intersectObject(robot, true);
            
            // Filter intersections based on current mode
            // Also filter out gizmo objects (CoM, inertia, axes, etc.)
            const validHits = intersections.filter(hit => {
                // Skip gizmo objects
                if (hit.object.userData?.isGizmo) return false;
                let p = hit.object.parent;
                while (p) {
                    if (p.userData?.isGizmo) return false;
                    p = p.parent;
                }
                // Determine if we should filter based on mode.
                // WE REMOVED STRICT FILTERING: If it's visible and hit, it's selectable.
                // This fixes issues where "clicking the front object" fails if the front object
                // type doesn't match the current mode (e.g. clicking a visible collider in visual mode).
                return true;
            });
            
            if (validHits.length > 0) {
                const hit = validHits[0];
                
                // Mark that we just selected something - prevent onPointerMissed from deselecting
                if (justSelectedRef) {
                    justSelectedRef.current = true;
                    // We clear this in handleMouseUp to handle long clicks correctly
                }
                
                // Find the link that was clicked for selection
                const linkObj = findParentLink(hit.object);
                
                // Handle link selection
                if (linkObj && onSelect) {
                    // Use current mode to determine subtype, regardless of what was clicked
                    const subType = isCollisionMode ? 'collision' : 'visual';

                    if (mode === 'detail') {
                        onSelect('link', linkObj.name, subType);
                    } else {
                        // Try to find parent joint
                        const parent = linkObj.parent;
                        if (parent && (parent as any).isURDFJoint) {
                            onSelect('joint', parent.name);
                            // Highlight handled by useEffect
                        } else {
                            onSelect('link', linkObj.name, subType);
                        }
                    }
                    
                    // Highlight logic
                    if (mode === 'detail' || !((linkObj.parent as any)?.isURDFJoint)) {
                        highlightGeometry(linkObj.name, false, subType);
                    }
                    
                    // CRITICAL: Clear hoveredLinkRef to prevent useFrame from incorrectly
                    // removing the highlight due to race condition with async React state update.
                    // Without this, useFrame may see hoveredLinkRef !== selection?.id (stale)
                    // and revert the highlight we just applied.
                    hoveredLinkRef.current = null;
                    (hoveredLinkRef as any).currentMesh = null;
                }
                
                // Find nearest movable joint for dragging (like urdf-loader's approach)
                const joint = findNearestJoint(hit.object);
                
                // Start joint dragging (like urdf-loader's setGrabbed)
                if (joint) {
                    isDraggingJoint.current = true;
                    dragJoint.current = joint;
                    dragHitDistance.current = hit.distance;
                    // Store initial ray for delta calculation
                    lastRayRef.current.copy(raycasterRef.current.ray);
                    setIsDraggingRef.current?.(true);
                    // Set active joint for UI highlighting
                    if (setActiveJointRef.current) {
                        setActiveJointRef.current(joint.name);
                    }
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
            // Note: Deselection on empty space click is handled by Canvas onPointerMissed
        };
        
        const handleMouseUp = () => {
            if (isDraggingJoint.current) {
                isDraggingJoint.current = false;
                dragJoint.current = null;
                setIsDraggingRef.current?.(false);
            }

            // Clear selection protection on mouse up with a small delay
            // to ensure onPointerMissed (which fires on click) sees the flag
            if (justSelectedRef) {
                setTimeout(() => {
                    justSelectedRef.current = false;
                }, 100);
            }
        };
        
        const handleMouseLeave = () => {
            mouseRef.current.set(-1000, -1000);
            
            // Force clear hover if active (to prevent stuck highlights)
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
            gl.domElement.removeEventListener('mousemove', handleMouseMove);
            gl.domElement.removeEventListener('mousedown', handleMouseDown);
            gl.domElement.removeEventListener('mouseup', handleMouseUp);
            gl.domElement.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, [gl, camera, robot, onSelect, highlightGeometry, highlightMode]);
    
    // Continuous hover detection like robot_viewer's URDFDragControls.update()
    useFrame(() => {
        if (!robot) return;
        
        // If dragging joint, do not update hover highlight
        if (isDraggingJoint.current) return;
        
        // Skip hover processing briefly after selection to avoid race condition
        // with async React state update (selection?.id may be stale)
        if (justSelectedRef?.current) return;

        raycasterRef.current.setFromCamera(mouseRef.current, camera);
        
        // When checking for intersections, we need to be careful with collision meshes
        // Raycast is already enabled/disabled by useEffect based on mode
        const isCollisionMode = highlightMode === 'collision';

        const intersections = raycasterRef.current.intersectObject(robot, true);
        
        let newHoveredLink: string | null = null;
        let newHoveredMesh: THREE.Object3D | null = null;
        
        if (intersections.length > 0) {
            // Filter intersections based on current mode (visual vs collision)
            // Also filter out gizmo objects (CoM, inertia, axes, etc.)
            const validHits = intersections.filter(hit => {
                // Skip gizmo objects
                if (hit.object.userData?.isGizmo) return false;
                let p = hit.object.parent;
                while (p) {
                    if (p.userData?.isGizmo) return false;
                    p = p.parent;
                }
                // Relaxed filtering for hover as well
                return true;
            });

            if (validHits.length > 0) {
                const hit = validHits[0];
                newHoveredMesh = hit.object;
                let current = hit.object as THREE.Object3D | null;
                
                // Traverse up to find the owning link
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
        
        // Only update if hovered link or mesh changed
        if (newHoveredLink !== hoveredLinkRef.current || newHoveredMesh !== (hoveredLinkRef as any).currentMesh) {
            // Unhighlight previous link/mesh (if it's not the current selection)
            if (hoveredLinkRef.current && hoveredLinkRef.current !== selection?.id) {
                highlightGeometry(hoveredLinkRef.current, true, isCollisionMode ? 'collision' : 'visual', (hoveredLinkRef as any).currentMesh);
            }
            
            // Highlight new link/mesh on hover
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
            // urdf-loader marks collision meshes with isURDFCollider
            if (child.isURDFCollider) {
                child.visible = showCollision;
                // Enable/Disable raycast based on mode
                child.traverse((inner: any) => {
                    if (inner.isMesh) {
                        // CRITICAL: Ensure async loaded meshes are marked as collision meshes
                        inner.userData.isCollisionMesh = true;
                        
                        inner.raycast = highlightMode === 'collision' 
                            ? THREE.Mesh.prototype.raycast 
                            : emptyRaycast;
                    }
                });
                
                if (showCollision) {
                    // Apply purple material to all meshes inside the collider group
                    child.traverse((innerChild: any) => {
                        if (innerChild.isMesh) {
                            // Ensure tag is present
                            innerChild.userData.isCollisionMesh = true;
                            
                            // Check if this mesh is currently highlighted (has __origMaterial)
                            // If highlighted, update the backup material instead of current material
                            // to prevent flashing (overwriting highlight with base material)
                            if (innerChild.__origMaterial) {
                                innerChild.__origMaterial = collisionBaseMaterial;
                            } else {
                                innerChild.material = collisionBaseMaterial;
                            }
                            
                            // Ensure collision meshes render after visual meshes
                            innerChild.renderOrder = 999;
                        }
                    });
                }
            }
        });
    }, [robot, showCollision, robotVersion, highlightMode]);

    // Update visual visibility when showVisual changes
    useEffect(() => {
        if (!robot) return;
        
        robot.traverse((child: any) => {
            // Check for Visual Groups (children of Link that are not Joint/Collider)
            // This covers the container of visual meshes.
            if (child.parent && child.parent.isURDFLink && !child.isURDFJoint && !child.isURDFCollider) {
                child.visible = showVisual;
            }
            // Also keep the mesh check as a fallback if structure is flat (though URDFLoader usually groups)
            // But if we hide the group, mesh visibility doesn't matter much.
            // Let's keep mesh check for robustness but prioritize group.
            if (child.isMesh && !child.isURDFCollider && !child.userData.isCollisionMesh) {
                 // Only set if parent isn't the controlled group (to avoid double setting or conflicts)
                 // Actually setting mesh visibility is fine too.
                 child.visible = showVisual;
            }
        });
    }, [robot, showVisual, robotVersion]);

    // Effect to handle inertia and CoM visualization
    useEffect(() => {
        if (!robot) return;

        console.log('[URDFViewer] Updating CoM/Inertia visibility:', { showInertia, showCenterOfMass, hasRobotLinks: !!robotLinks });
        let linkCount = 0;
        let inertialCount = 0;

        robot.traverse((child: any) => {
            if (child.isURDFLink) {
                linkCount++;
                
                // Get inertial data from robotLinks (passed from app state) instead of urdf-loader
                const linkName = child.name || child.urdfName;
                const linkData = robotLinks?.[linkName];
                const inertialData = linkData?.inertial;
                
                // Check if we have valid inertial data with mass > 0
                if (inertialData && inertialData.mass > 0) {
                    inertialCount++;
                    // Found a link with inertial data
                    // Check if visualization group already exists
                    let vizGroup = child.children.find((c: any) => c.name === '__inertia_visual__');
                    
                    if (!vizGroup) {
                        vizGroup = new THREE.Group();
                        vizGroup.name = '__inertia_visual__';
                        vizGroup.userData = { isGizmo: true }; // Mark as gizmo
                        child.add(vizGroup);
                    }

                    // --- 1. CoM Indicator (Sphere) ---
                    let comVisual = vizGroup.children.find((c: any) => c.name === '__com_visual__');
                    if (!comVisual) {
                        comVisual = new THREE.Group();
                        comVisual.name = '__com_visual__';
                        comVisual.userData = { isGizmo: true }; // Mark as gizmo
                        
                        const radius = 0.03; // Increased radius for visibility
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
                            mesh.renderOrder = 999; // Draw on top
                            mesh.userData = { isGizmo: true };
                            mesh.raycast = () => {}; // Disable raycasting
                            comVisual.add(mesh);
                        });
                        
                        // Small axes for orientation reference
                        const axes = new THREE.AxesHelper(0.1);
                        (axes.material as THREE.Material).depthTest = false;
                        (axes.material as THREE.Material).transparent = true;
                        axes.renderOrder = 999;
                        axes.userData = { isGizmo: true };
                        axes.raycast = () => {}; // Disable raycasting
                        comVisual.add(axes);

                        vizGroup.add(comVisual);
                    }
                    comVisual.visible = showCenterOfMass;
                    
                    // Remove old __com_axis__ if it exists to avoid clutter
                    const oldAxis = vizGroup.children.find((c: any) => c.name === '__com_axis__');
                    if (oldAxis) vizGroup.remove(oldAxis);

                    // --- 2. Inertia Box ---
                    let inertiaBox = vizGroup.children.find((c: any) => c.name === '__inertia_box__');
                    
                    // Only try to create/update box if we don't have one
                    if (!inertiaBox) {
                        // Use MathUtils to compute box from full inertia tensor
                        // This handles off-diagonal elements (rotations) correctly
                        const boxData = MathUtils.computeInertiaBox(inertialData);
                        
                        if (boxData) {
                            const { width, height, depth, rotation } = boxData;
                            const geom = new THREE.BoxGeometry(width, height, depth);
                            
                            // Create a group for the box + edges
                            inertiaBox = new THREE.Group();
                            inertiaBox.name = '__inertia_box__';
                            inertiaBox.userData = { isGizmo: true };

                            // Solid transparent mesh
                            const mat = new THREE.MeshBasicMaterial({ 
                                color: 0x4a9eff, 
                                transparent: true,
                                opacity: 0.2,
                                depthWrite: false,
                                depthTest: false  // Render on top of transparent objects
                            });
                            const mesh = new THREE.Mesh(geom, mat);
                            mesh.quaternion.copy(rotation); // Apply inertia tensor rotation
                            mesh.userData = { isGizmo: true };
                            mesh.raycast = () => {}; // Disable raycasting
                            mesh.renderOrder = 999; // Render after other objects
                            inertiaBox.add(mesh);

                            // Edges
                            const edges = new THREE.EdgesGeometry(geom);
                            const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ 
                                color: 0x4a9eff, 
                                transparent: true, 
                                opacity: 0.6,
                                depthWrite: false,
                                depthTest: false  // Render on top of transparent objects
                            }));
                            line.quaternion.copy(rotation); // Apply inertia tensor rotation
                            line.userData = { isGizmo: true };
                            line.raycast = () => {}; // Disable raycasting
                            line.renderOrder = 1000; // Render after other objects
                            inertiaBox.add(line);

                            vizGroup.add(inertiaBox);
                        }
                    }
                    
                    if (inertiaBox) {
                        inertiaBox.visible = showInertia;
                    }

                    // Apply Inertial Origin transform to the whole visual group
                    if (inertialData.origin) {
                        const origin = inertialData.origin;
                        const xyz = origin.xyz || { x: 0, y: 0, z: 0 };
                        const rpy = origin.rpy || { r: 0, p: 0, y: 0 };
                        vizGroup.position.set(xyz.x, xyz.y, xyz.z);
                        vizGroup.rotation.set(rpy.r, rpy.p, rpy.y);
                    }
                    
                    // Show group if either is enabled
                    vizGroup.visible = showInertia || showCenterOfMass;
                }
            }
        });
        
        console.log(`[URDFViewer] Found ${linkCount} links, ${inertialCount} with inertia data.`);

        // Request re-render
        invalidate();

    }, [robot, showInertia, showCenterOfMass, robotVersion, invalidate, robotLinks]);

    // Effect to handle Transparency, Origins, and Joint Axes
    useEffect(() => {
        if (!robot) return;

        const shouldBeTransparent = showCenterOfMass || showInertia;
        const transparencyOpacity = 0.3;

        robot.traverse((child: any) => {
            // Check if gizmo (or child of gizmo)
            let isGizmo = child.userData?.isGizmo;
            let p = child.parent;
            while (p && !isGizmo) {
                if (p.userData?.isGizmo) isGizmo = true;
                p = p.parent;
            }
            if (isGizmo) return; // Skip gizmos and their children from transparency logic

            // 1. Transparency Logic
            if (child.isMesh && !child.userData.isCollisionMesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach((mat: THREE.Material) => {
                    if (!mat.userData.originalProps) {
                        mat.userData.originalProps = {
                            transparent: mat.transparent,
                            opacity: mat.opacity,
                            depthWrite: mat.depthWrite
                        };
                    }
                    
                    if (shouldBeTransparent) {
                        mat.transparent = true;
                        mat.opacity = transparencyOpacity;
                        mat.depthWrite = false; // Disable depth write to prevent occlusion issues
                        mat.side = THREE.DoubleSide; // Ensure back faces are visible
                    } else {
                        // Restore original properties
                        if (mat.userData.originalProps) {
                            mat.transparent = mat.userData.originalProps.transparent;
                            mat.opacity = mat.userData.originalProps.opacity;
                            mat.depthWrite = mat.userData.originalProps.depthWrite;
                            // Note: We don't restore 'side' as DoubleSide is generally good for visualizer, 
                            // but if strictly needed we could store it too.
                        }
                    }
                    mat.needsUpdate = true;
                });
            }

            // 2. Origins (Axes) - Styled like robot_viewer with colored cylinder+cone axes
            if (child.isURDFLink || child.isURDFJoint) {
                let axes = child.children.find((c: any) => c.name === '__origin_axes__');
                if (showOrigins) {
                    if (!axes) {
                        axes = new THREE.Group();
                        axes.name = '__origin_axes__';
                        axes.userData = { isGizmo: true };
                        axes.raycast = () => {};
                        
                        const axisLength = 0.12;
                        const axisRadius = 0.003;  // Thinner axes
                        const coneLength = 0.03;
                        const coneRadius = 0.008;
                        
                        // Helper to create one axis (cylinder + cone)
                        const createAxis = (color: number, rotationAxis: THREE.Vector3, rotationAngle: number) => {
                            const group = new THREE.Group();
                            
                            // Cylinder (shaft)
                            const cylinderGeom = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 8);
                            const cylinderMat = new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
                            const cylinder = new THREE.Mesh(cylinderGeom, cylinderMat);
                            cylinder.position.y = axisLength / 2;
                            cylinder.userData = { isGizmo: true };
                            cylinder.raycast = () => {};
                            group.add(cylinder);
                            
                            // Cone (arrowhead)
                            const coneGeom = new THREE.ConeGeometry(coneRadius, coneLength, 8);
                            const coneMat = new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
                            const cone = new THREE.Mesh(coneGeom, coneMat);
                            cone.position.y = axisLength + coneLength / 2;
                            cone.userData = { isGizmo: true };
                            cone.raycast = () => {};
                            group.add(cone);
                            
                            // Rotate entire axis to point in correct direction
                            group.quaternion.setFromAxisAngle(rotationAxis, rotationAngle);
                            group.userData = { isGizmo: true };
                            
                            return group;
                        };
                        
                        // X axis (red) - rotate around Z by -90°
                        const xAxis = createAxis(0xff0000, new THREE.Vector3(0, 0, 1), -Math.PI / 2);
                        axes.add(xAxis);
                        
                        // Y axis (green) - no rotation needed (default is Y-up)
                        const yAxis = createAxis(0x00ff00, new THREE.Vector3(0, 0, 1), 0);
                        axes.add(yAxis);
                        
                        // Z axis (blue) - rotate around X by 90°
                        const zAxis = createAxis(0x0000ff, new THREE.Vector3(1, 0, 0), Math.PI / 2);
                        axes.add(zAxis);
                        
                        // Small sphere at origin
                        const sphereGeom = new THREE.SphereGeometry(axisRadius * 1.5, 8, 8);
                        const sphereMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: true });
                        const sphere = new THREE.Mesh(sphereGeom, sphereMat);
                        sphere.userData = { isGizmo: true };
                        sphere.raycast = () => {};
                        axes.add(sphere);
                        
                        child.add(axes);
                    }
                    axes.visible = true;
                } else if (axes) {
                    axes.visible = false;
                }
            }

            // 3. Joint Axes - Styled with cylinder+cone + rotation ring for revolute/continuous joints
            if (child.isURDFJoint && child.jointType !== 'fixed') {
                let arrow = child.children.find((c: any) => c.name === '__joint_axis__');
                if (showJointAxes) {
                    if (!arrow) {
                        // child.axis is the joint axis vector in local frame
                        const axis = child.axis || new THREE.Vector3(1, 0, 0);
                        const dir = axis.clone().normalize();
                        
                        arrow = new THREE.Group();
                        arrow.name = '__joint_axis__';
                        arrow.userData = { isGizmo: true };
                        arrow.raycast = () => {};
                        
                        const axisLength = 0.2;
                        const axisRadius = 0.004;  // Thinner axis
                        const coneLength = 0.04;
                        const coneRadius = 0.012;
                        const color = 0xffff00; // Yellow for joint axis
                        
                        // Cylinder (shaft)
                        const cylinderGeom = new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 8);
                        const cylinderMat = new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
                        const cylinder = new THREE.Mesh(cylinderGeom, cylinderMat);
                        cylinder.position.y = axisLength / 2;
                        cylinder.userData = { isGizmo: true };
                        cylinder.raycast = () => {};
                        arrow.add(cylinder);
                        
                        // Cone (arrowhead)
                        const coneGeom = new THREE.ConeGeometry(coneRadius, coneLength, 8);
                        const coneMat = new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
                        const cone = new THREE.Mesh(coneGeom, coneMat);
                        cone.position.y = axisLength + coneLength / 2;
                        cone.userData = { isGizmo: true };
                        cone.raycast = () => {};
                        arrow.add(cone);
                        
                        // Add rotation direction ring for revolute/continuous joints
                        if (child.jointType === 'revolute' || child.jointType === 'continuous') {
                            const ringRadius = 0.06;  // Ring radius
                            const tubeRadius = 0.003; // Ring tube thickness
                            // TorusGeometry lies in XY plane by default, ring around Z axis
                            const torusGeom = new THREE.TorusGeometry(ringRadius, tubeRadius, 8, 32, Math.PI * 1.5);
                            const torusMat = new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
                            const torus = new THREE.Mesh(torusGeom, torusMat);
                            // Position ring at midpoint of axis
                            torus.position.y = axisLength * 0.4;
                            // Rotate to be perpendicular to axis (ring in XZ plane, around Y axis)
                            torus.rotation.x = Math.PI / 2;
                            torus.userData = { isGizmo: true };
                            torus.raycast = () => {};
                            arrow.add(torus);
                            
                            // Add small arrowhead at end of ring to indicate rotation direction
                            const arrowHeadGeom = new THREE.ConeGeometry(tubeRadius * 2.5, tubeRadius * 6, 6);
                            const arrowHeadMat = new THREE.MeshBasicMaterial({ color, depthTest: true, depthWrite: true });
                            const arrowHead = new THREE.Mesh(arrowHeadGeom, arrowHeadMat);
                            // Position at end of arc (arc ends at 270° = 3π/2 from start)
                            arrowHead.position.set(ringRadius, axisLength * 0.4, 0);
                            arrowHead.rotation.z = -Math.PI / 2; // Point tangentially (counterclockwise direction)
                            arrowHead.userData = { isGizmo: true };
                            arrowHead.raycast = () => {};
                            arrow.add(arrowHead);
                        }
                        
                        // Rotate to align with joint axis
                        // Default cylinder is Y-up, we need to rotate to align with 'dir'
                        const up = new THREE.Vector3(0, 1, 0);
                        const quaternion = new THREE.Quaternion().setFromUnitVectors(up, dir);
                        arrow.quaternion.copy(quaternion);
                        
                        child.add(arrow);
                    }
                    arrow.visible = true;
                } else if (arrow) {
                    arrow.visible = false;
                }
            }
        });
        
        invalidate();
    }, [robot, showCenterOfMass, showInertia, showOrigins, showJointAxes, robotVersion, invalidate]);

    // Effect to handle external selection highlighting (Moved here to run AFTER visibility effects)
    useEffect(() => {
        if (!robot) return;
        
        // Clear previous selection highlight
        if (currentSelectionRef.current.id) {
            highlightGeometry(currentSelectionRef.current.id, true, currentSelectionRef.current.subType as any);
        }
        
        let targetId: string | null = null;
        let targetSubType = selection?.subType;

        // Determine what to highlight based on selection type
        if (selection?.type === 'link' && selection.id) {
            targetId = selection.id;
        } else if (selection?.type === 'joint' && selection.id) {
            // If a joint is selected, highlight its child link
            // Find the joint object in the robot hierarchy
            const jointObj = robot.getObjectByName(selection.id);
            if (jointObj) {
                // Find the child that is a URDFLink
                const childLink = jointObj.children.find((c: any) => c.isURDFLink);
                if (childLink) {
                    targetId = childLink.name;
                }
            }
        }
        
        // Apply new selection highlight
        if (targetId) {
            // Pass selection.subType (can be undefined), allow highlightGeometry to fallback to highlightMode
            highlightGeometry(targetId, false, targetSubType);
            currentSelectionRef.current = { id: targetId, subType: targetSubType || null };
        } else {
            currentSelectionRef.current = { id: null, subType: null };
        }
    }, [robot, selection?.type, selection?.id, selection?.subType, highlightGeometry, robotVersion, highlightMode, showCollision]);

    // Effect to handle external hover highlighting (Moved here to run AFTER visibility effects)
    useEffect(() => {
        if (!robot) return;
        
        // Clear previous hover highlight
        if (currentHoverRef.current.id) {
            // Only clear if it's NOT the current selection (selection has priority)
            if (currentHoverRef.current.id !== selection?.id || currentHoverRef.current.subType !== selection?.subType) {
                highlightGeometry(currentHoverRef.current.id, true, currentHoverRef.current.subType as any);
            }
        }
        
        // Apply new hover highlight
        if (hoveredSelection?.type === 'link' && hoveredSelection.id) {
            // Pass hoveredSelection.subType (can be undefined), allow highlightGeometry to fallback to highlightMode
            highlightGeometry(hoveredSelection.id, false, hoveredSelection.subType);
            currentHoverRef.current = { id: hoveredSelection.id, subType: hoveredSelection.subType || null };
        } else {
            currentHoverRef.current = { id: null, subType: null };
        }
    }, [robot, hoveredSelection?.id, hoveredSelection?.subType, selection?.id, selection?.subType, highlightGeometry, robotVersion]);

    useEffect(() => {
        if (!urdfContent) return;
        
        const loadRobot = async () => {
            try {
                // Extract URDF directory from assets paths for relative path resolution
                const urdfDir = '';
                
                const manager = createLoadingManager(assets, urdfDir);
                // Trigger updates when assets finish loading
                manager.onLoad = () => {
                    setRobotVersion(v => v + 1);
                    invalidate();
                };

                const loader = new URDFLoader(manager);
                
                // Enable collision parsing
                loader.parseCollision = true;
                
                // Setup custom mesh loader with urdfDir
                loader.loadMeshCb = createMeshLoader(assets, manager, urdfDir);
                
                // Setup package resolver
                loader.packages = (pkg: string) => {
                    // Return empty string since we handle paths in mesh loader
                    return '';
                };
                
                // Parse URDF from string
                const robotModel = loader.parse(urdfContent);
                
                if (robotModel) {
                    // Enhance materials for better rendering
                    enhanceMaterials(robotModel);
                    
                    // No rotation needed - camera already uses Z-up coordinate system
                    
                    // Mark collisions and set initial visibility for Groups to prevent flashing
                    // We must traverse and set visibility synchronously before React renders.
                    robotModel.traverse((child: any) => {
                        // Mark collision meshes (inner meshes of collider groups)
                        if (child.isURDFCollider) {
                            child.traverse((inner: any) => {
                                if (inner.isMesh) {
                                    inner.userData.isCollisionMesh = true;
                                }
                            });
                        }
                    });

                    // Set initial visibility based on refs
                    robotModel.traverse((child: any) => {
                        if (child.isURDFCollider) {
                            // Collision Group
                            child.visible = showCollisionRef.current;
                        } else if (child.parent && child.parent.isURDFLink && !child.isURDFJoint && !child.isURDFCollider) {
                            // This is likely a Visual Group (direct child of Link, not Joint/Collider)
                            child.visible = showVisualRef.current;
                        }
                    });
                    
                    setRobot(robotModel);
                    setError(null);
                    
                    if (onRobotLoaded) {
                        onRobotLoaded(robotModel);
                    }
                }
            } catch (err) {
                console.error('[URDFViewer] Failed to load URDF:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
            }
        };
        
        loadRobot();
        
        return () => {
            // Cleanup
            if (robot) {
                robot.traverse((child: any) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach((m: THREE.Material) => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
        };
    }, [urdfContent, assets]);
    
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
    
    // Note: onClick and onPointerDown are now handled via DOM events in the useEffect above
    return <primitive object={robot} />;
}

const JointInteraction = ({ joint, value, onChange }: { joint: any, value: number, onChange: (val: number) => void }) => {
    const transformRef = useRef<any>(null);
    const dummyRef = useRef<THREE.Object3D>(new THREE.Object3D());
    const lastRotation = useRef<number>(value);
    const isDragging = useRef(false);
    const [, forceUpdate] = useState(0);

    if (!joint) return null;
    
    // Get joint axis - ensure it's a proper Vector3
    const axisNormalized = useMemo(() => {
        const axis = joint.axis;
        if (axis instanceof THREE.Vector3) {
            return axis.clone().normalize();
        } else if (axis && typeof axis.x === 'number') {
            return new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
        }
        return new THREE.Vector3(1, 0, 0);
    }, [joint]);
    
    // Determine which rotation mode to use based on axis
    const rotationAxis = useMemo((): 'X' | 'Y' | 'Z' => {
        const absX = Math.abs(axisNormalized.x);
        const absY = Math.abs(axisNormalized.y);
        const absZ = Math.abs(axisNormalized.z);
        if (absX >= absY && absX >= absZ) return 'X';
        if (absY >= absX && absY >= absZ) return 'Y';
        return 'Z';
    }, [axisNormalized]);
    
    // Force update on mount to ensure TransformControls has the dummy object
    useEffect(() => {
        forceUpdate(n => n + 1);
    }, []);
    
    // Update dummy position and orientation each frame
    useFrame(() => {
        if (dummyRef.current && joint) {
            try {
                // Copy world position from joint
                joint.getWorldPosition(dummyRef.current.position);
                
                // Only update orientation if NOT dragging to prevent fighting with controls
                if (!isDragging.current) {
                    // Get parent's world quaternion (so gizmo doesn't spin with joint rotation)
                    const parent = joint.parent;
                    if (parent) {
                        parent.getWorldQuaternion(dummyRef.current.quaternion);
                    } else {
                        joint.getWorldQuaternion(dummyRef.current.quaternion);
                    }
                    
                    // Align the gizmo with the joint axis
                    const alignVector = new THREE.Vector3(1, 0, 0); // Default X
                    if (rotationAxis === 'Y') alignVector.set(0, 1, 0);
                    if (rotationAxis === 'Z') alignVector.set(0, 0, 1);
                    
                    const alignQ = new THREE.Quaternion().setFromUnitVectors(
                        alignVector,
                        axisNormalized
                    );
                    dummyRef.current.quaternion.multiply(alignQ);
                    
                    // Apply the current joint angle rotation
                    const rotQ = new THREE.Quaternion().setFromAxisAngle(alignVector, value); // Rotate around LOCAL axis
                    dummyRef.current.quaternion.multiply(rotQ);
                }
            } catch (e) {
                // Prevent crash on math error
            }
        }
    });
    
    const handleChange = useCallback(() => {
        if (!dummyRef.current || !isDragging.current) return;
        
        try {
            // Calculate the angle from the current quaternion relative to the zero-angle frame
            const parent = joint.parent;
            const parentQuat = new THREE.Quaternion();
            if (parent) {
                parent.getWorldQuaternion(parentQuat);
            } else {
                joint.getWorldQuaternion(parentQuat);
            }

            // Re-calculate alignment (same as in useFrame)
            const alignVector = new THREE.Vector3(1, 0, 0); 
            if (rotationAxis === 'Y') alignVector.set(0, 1, 0);
            if (rotationAxis === 'Z') alignVector.set(0, 0, 1);
            
            const alignQ = new THREE.Quaternion().setFromUnitVectors(
                alignVector,
                axisNormalized
            );
            
            // Q_zero = Q_parent * Q_align
            const zeroQuat = parentQuat.clone().multiply(alignQ);
            
            // Q_delta = Q_zero^-1 * Q_current
            const deltaQuat = zeroQuat.clone().invert().multiply(dummyRef.current.quaternion);
            
            // Extract angle from deltaQuat
            // 2 * atan2(q.component, q.w) gives the angle
            let newValue = 0;
            if (rotationAxis === 'X') newValue = 2 * Math.atan2(deltaQuat.x, deltaQuat.w);
            else if (rotationAxis === 'Y') newValue = 2 * Math.atan2(deltaQuat.y, deltaQuat.w);
            else newValue = 2 * Math.atan2(deltaQuat.z, deltaQuat.w);
            
            // Apply limits for revolute joints
            const limit = joint.limit || { lower: -Math.PI, upper: Math.PI };
            if (joint.jointType === 'revolute') {
                newValue = Math.max(limit.lower, Math.min(limit.upper, newValue));
            }
            
            if (Math.abs(newValue - lastRotation.current) > 0.001) {
                lastRotation.current = newValue;
                onChange(newValue);
            }
        } catch (e) {
            console.error("Error in JointInteraction handleChange:", e);
        }
    }, [joint, onChange, rotationAxis, axisNormalized]);
    
    // Reset lastRotation when value changes externally
    useEffect(() => {
        lastRotation.current = value;
    }, [value]);

    return (
        <>
            <primitive object={dummyRef.current} />
            <TransformControls
                ref={transformRef}
                object={dummyRef.current}
                mode="rotate"
                showX={rotationAxis === 'X'}
                showY={rotationAxis === 'Y'}
                showZ={rotationAxis === 'Z'}
                size={1.2}
                space="local"
                onMouseDown={() => { isDragging.current = true; }}
                onMouseUp={() => { isDragging.current = false; }}
                onObjectChange={handleChange}
            />
        </>
    );
};

// Scene lighting setup - inspired by robot_viewer EnvironmentManager
function SceneLighting() {
    const { scene, gl } = useThree();
    
    useEffect(() => {
        // Setup environment map for material reflections
        const pmremGenerator = new THREE.PMREMGenerator(gl);
        pmremGenerator.compileEquirectangularShader();
        
        // Create a simple environment scene
        const envScene = new THREE.Scene();
        const envLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        envScene.add(envLight);
        
        // Generate environment map
        const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
        envMap.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = envMap;
        
        return () => {
            pmremGenerator.dispose();
        };
    }, [scene, gl]);
    
    return (
        <>
            {/* Hemisphere light for ambient fill - increased intensity */}
            <hemisphereLight args={[0xffffff, 0x666666, 0.8]} position={[0, 0, 1]} />
            
            {/* Ambient light for base illumination */}
            <ambientLight intensity={0.4} />
            
            {/* Main directional light with shadows (front-top-right) */}
            <directionalLight
                position={[4, 4, 8]}
                intensity={Math.PI * 0.8}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
                shadow-camera-near={0.1}
                shadow-camera-far={50}
                shadow-camera-left={-5}
                shadow-camera-right={5}
                shadow-camera-top={5}
                shadow-camera-bottom={-5}
                shadow-normalBias={0.001}
            />
            
            {/* Fill light from back-left */}
            <directionalLight
                position={[-4, -4, 6]}
                intensity={Math.PI * 0.4}
            />
            
            {/* Fill light from front-left */}
            <directionalLight
                position={[-4, 4, 4]}
                intensity={Math.PI * 0.3}
            />
            
            {/* Fill light from back-right */}
            <directionalLight
                position={[4, -4, 4]}
                intensity={Math.PI * 0.3}
            />
            
            {/* Top light */}
            <directionalLight
                position={[0, 0, 10]}
                intensity={Math.PI * 0.2}
            />
            
            {/* Bottom fill light (subtle) */}
            <directionalLight
                position={[0, 0, -5]}
                intensity={Math.PI * 0.15}
            />
            
            {/* Ground plane for shadows - Z-up coordinate system */}
            <mesh 
                rotation={[0, 0, 0]} 
                position={[0, 0, -0.02]} 
                receiveShadow
            >
                <planeGeometry args={[100, 100]} />
                <shadowMaterial transparent opacity={0.15} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>
        </>
    );
}

// Component for individual joint control to handle local input state
const JointControlItem = ({ 
    name, 
    joint, 
    jointAngles, 
    angleUnit, 
    activeJoint, 
    setActiveJoint, 
    handleJointAngleChange,
    onSelect
}: { 
    name: string, 
    joint: any, 
    jointAngles: Record<string, number>, 
    angleUnit: 'rad' | 'deg', 
    activeJoint: string | null, 
    setActiveJoint: (name: string | null) => void, 
    handleJointAngleChange: (name: string, val: number) => void,
    onSelect?: (type: 'link' | 'joint', id: string) => void
}) => {
    const limit = joint.limit || { lower: -Math.PI, upper: Math.PI };
    const value = jointAngles[name] || 0;
    const itemRef = useRef<HTMLDivElement>(null);
    
    // Auto-scroll into view when active
    useEffect(() => {
        if (activeJoint === name && itemRef.current) {
            itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeJoint, name]);
    
    // Convert for display
    const displayValue = angleUnit === 'deg' ? value * 180 / Math.PI : value;
    const displayMin = angleUnit === 'deg' ? limit.lower * 180 / Math.PI : limit.lower;
    const displayMax = angleUnit === 'deg' ? limit.upper * 180 / Math.PI : limit.upper;
    const step = angleUnit === 'deg' ? 1 : 0.01;

    // Local state for the input field to allow free-form typing (e.g. deleting everything, typing minus sign)
    const [inputValue, setInputValue] = useState(displayValue.toFixed(2));

    // Update local state when external value changes (e.g. from dragging or unit switch)
    useEffect(() => {
        setInputValue(displayValue.toFixed(2));
    }, [displayValue]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const s = e.target.value;
        setInputValue(s);
        
        // Only update the actual joint if it's a valid number
        const val = parseFloat(s);
        if (!isNaN(val)) {
            const radVal = angleUnit === 'deg' ? val * Math.PI / 180 : val;
            handleJointAngleChange(name, radVal);
        }
    };

        return (

                        <div 

                            ref={itemRef}

                            onClick={() => {

                                setActiveJoint(name);

                                onSelect?.('joint', name);

                            }}

                            className={`space-y-1 p-2 rounded-lg transition-colors cursor-pointer ${

                                activeJoint === name 

                                    ? 'bg-blue-100/50 dark:bg-google-blue/20 border border-blue-300 dark:border-google-blue/50' 

                                    : 'bg-white/50 dark:bg-google-dark-bg/30 border border-transparent hover:bg-slate-100 dark:hover:bg-google-dark-bg/50'

                            }`}

                        >

                <div className="flex justify-between text-xs items-center">

                                        <span 

                                            className={`truncate cursor-pointer font-medium ${activeJoint === name ? 'text-blue-600 dark:text-google-blue' : 'text-slate-700 dark:text-slate-200'}`} 

                                            title={name}

                                            onClick={() => {

                                                setActiveJoint(name);

                                                onSelect?.('joint', name);

                                            }}

                                        >

                                            {name}

                                        </span>

                    <div className="flex items-center gap-1">

                        <input 

                            type="text" 

                            value={inputValue}

                            onChange={handleInputChange}

                            onBlur={() => setInputValue(displayValue.toFixed(2))}

                            className="w-16 bg-white dark:bg-google-dark-bg border border-slate-300 dark:border-google-dark-border rounded px-1 py-0.5 text-right text-xs text-slate-900 dark:text-white focus:border-google-blue outline-none"

                        />

                        <span className="text-slate-500 w-4">{angleUnit === 'deg' ? '°' : 'rad'}</span>

                    </div>

                </div>

                <div className="flex items-center gap-2">

                    <span className="text-[10px] text-slate-500 w-8 text-right">{displayMin.toFixed(1)}</span>

                    <input

                        type="range"

                        min={displayMin}

                        max={displayMax}

                        step={step}

                        value={displayValue}

                        onChange={(e) => {

                            const newVal = parseFloat(e.target.value);

                            const radVal = angleUnit === 'deg' ? newVal * Math.PI / 180 : newVal;

                            handleJointAngleChange(name, radVal);

                        }}

                        className="flex-1 h-1 bg-slate-300 dark:bg-google-dark-border rounded-lg appearance-none cursor-pointer accent-google-blue"

                    />

                    <span className="text-[10px] text-slate-500 w-8">{displayMax.toFixed(1)}</span>

                </div>

            </div>

        );

    };

export function URDFViewer({ urdfContent, assets, onJointChange, lang, mode = 'detail', onSelect, theme, selection, hoveredSelection, robotLinks, focusTarget }: URDFViewerProps) {
    const t = translations[lang];
    const [robot, setRobot] = useState<any>(null);
    const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
    
    // View settings - unified with Visualizer style
    const [showCollision, setShowCollision] = useState(false);
    const [showVisual, setShowVisual] = useState(true);
    const [showJointControls, setShowJointControls] = useState(true);
    const [showCenterOfMass, setShowCenterOfMass] = useState(false);
    const [showInertia, setShowInertia] = useState(false);
    const [showOrigins, setShowOrigins] = useState(false);
    const [showJointAxes, setShowJointAxes] = useState(false);
    
    // Highlight mode: 'link' (default) or 'collision'
    const [highlightMode, setHighlightMode] = useState<'link' | 'collision'>('link');
    
    // Automatically show collisions when collision highlight mode is selected
    useEffect(() => {
        // if (highlightMode === 'collision') {
        //     setShowCollision(true);
        // }
    }, [highlightMode]);
    
    // Automatically show collisions when collision tab is selected (legacy support for PropertyEditor)
    useEffect(() => {
        if (selection?.subType === 'collision') {
            // setShowCollision(true);
            setHighlightMode('collision');
        } else if (selection?.subType === 'visual') {
            setHighlightMode('link');
        }
    }, [selection?.subType]);

    // Draggable panel positions - use refs to track panel elements
    const containerRef = useRef<HTMLDivElement>(null);
    const optionsPanelRef = useRef<HTMLDivElement>(null);
    const jointPanelRef = useRef<HTMLDivElement>(null);
    const [optionsPanelPos, setOptionsPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [jointPanelPos, setJointPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [dragging, setDragging] = useState<'options' | 'joints' | null>(null);
    const dragStartRef = useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);
    const [isOptionsCollapsed, setIsOptionsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_options_collapsed');
            return saved === 'true';
        }
        return false;
    });
    const [isJointsCollapsed, setIsJointsCollapsed] = useState(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('urdf_viewer_joints_collapsed');
            return saved === 'true';
        }
        return false;
    });

    const toggleOptionsCollapsed = () => {
        setIsOptionsCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('urdf_viewer_options_collapsed', String(newState));
            return newState;
        });
    };

    const toggleJointsCollapsed = () => {
        setIsJointsCollapsed(prev => {
            const newState = !prev;
            localStorage.setItem('urdf_viewer_joints_collapsed', String(newState));
            return newState;
        });
    };
    
    // Joint control state
    const [jointAngles, setJointAngles] = useState<Record<string, number>>({});
    const [initialJointAngles, setInitialJointAngles] = useState<Record<string, number>>({});
    const [angleUnit, setAngleUnit] = useState<'rad' | 'deg'>('rad');
    const [activeJoint, setActiveJoint] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    
    // Ref to track if we just selected something via DOM events (to prevent onPointerMissed from deselecting)
    const justSelectedRef = useRef(false);
    
    const handleRobotLoaded = useCallback((loadedRobot: any) => {
        setRobot(loadedRobot);
        
        // Initialize joint angles
        if (loadedRobot.joints) {
            const angles: Record<string, number> = {};
            Object.keys(loadedRobot.joints).forEach(name => {
                angles[name] = loadedRobot.joints[name].angle || 0;
            });
            setJointAngles(angles);
            setInitialJointAngles(angles);
        }
    }, []);
    
    const handleJointAngleChange = useCallback((jointName: string, angle: number) => {
        if (!robot?.joints?.[jointName]) return;
        
        const joint = robot.joints[jointName];
        if (joint.setJointValue) {
            joint.setJointValue(angle);
        }
        
        setJointAngles(prev => ({ ...prev, [jointName]: angle }));
        
        if (onJointChange) {
            onJointChange(jointName, angle);
        }
    }, [robot, onJointChange]);

    const handleResetJoints = useCallback(() => {
        if (!robot || !robot.joints) return;
        
        // Iterate over all joints and reset
        Object.keys(jointAngles).forEach(name => {
            const initialAngle = initialJointAngles[name] || 0;
            handleJointAngleChange(name, initialAngle);
        });
    }, [robot, jointAngles, initialJointAngles, handleJointAngleChange]);

    const handleSelectWrapper = useCallback((type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => {
        if (onSelect) onSelect(type, id, subType || selection?.subType);
        
        if (type === 'link' && robot) {
            // Find the joint that drives this link
            // In urdf-loader, joint.child is the link object
            const jointName = Object.keys(robot.joints).find(name => {
                const joint = robot.joints[name];
                return joint?.child?.name === id && joint?.jointType !== 'fixed';
            });
            if (jointName) {
                setActiveJoint(jointName);
            } else {
                setActiveJoint(null);
            }
        } else if (type === 'joint') {
            setActiveJoint(id);
        } else {
            setActiveJoint(null);
        }
    }, [onSelect, robot, selection?.subType]);
    
    // Sync activeJoint with external selection
    useEffect(() => {
        if (!robot) return;

        if (selection?.type === 'joint' && selection.id) {
            setActiveJoint(selection.id);
        } else if (selection?.type === 'link' && selection.id) {
            // Find the joint that drives this link
            const jointName = Object.keys(robot.joints).find(name => {
                const joint = robot.joints[name];
                return joint?.child?.name === selection.id && joint?.jointType !== 'fixed';
            });
            if (jointName) {
                setActiveJoint(jointName);
            } else {
                setActiveJoint(null);
            }
        } else {
            setActiveJoint(null);
        }
    }, [selection, robot]);

    // Drag handlers for panels - fixed offset calculation
    const handleMouseDown = useCallback((panel: 'options' | 'joints', e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const panelRef = panel === 'options' ? optionsPanelRef : jointPanelRef;
        if (!panelRef.current || !containerRef.current) return;
        
        const rect = panelRef.current.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        dragStartRef.current = {
            mouseX: e.clientX,
            mouseY: e.clientY,
            panelX: rect.left - containerRect.left,
            panelY: rect.top - containerRect.top
        };
        setDragging(panel);
    }, []);
    
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!dragging || !dragStartRef.current || !containerRef.current) return;
        
        const panelRef = dragging === 'options' ? optionsPanelRef : jointPanelRef;
        if (!panelRef.current) return;
        
        const deltaX = e.clientX - dragStartRef.current.mouseX;
        const deltaY = e.clientY - dragStartRef.current.mouseY;
        
        const containerRect = containerRef.current.getBoundingClientRect();
        const panelRect = panelRef.current.getBoundingClientRect();
        
        // 计算新位置
        let newX = dragStartRef.current.panelX + deltaX;
        let newY = dragStartRef.current.panelY + deltaY;
        
        // 边界限制：确保面板不会超出容器
        const padding = 2;
        const maxX = containerRect.width - panelRect.width - padding;
        const maxY = containerRect.height - panelRect.height - padding;
        
        newX = Math.max(padding, Math.min(newX, Math.max(padding, maxX)));
        newY = Math.max(padding, Math.min(newY, Math.max(padding, maxY)));
        
        if (dragging === 'options') {
            setOptionsPanelPos({ x: newX, y: newY });
        } else {
            setJointPanelPos({ x: newX, y: newY });
        }
    }, [dragging]);
    
    const handleMouseUp = useCallback(() => {
        setDragging(null);
        dragStartRef.current = null;
    }, []);
    
    return (
        <div 
            ref={containerRef}
            className="flex-1 relative bg-google-light-bg dark:bg-google-dark-bg h-full min-w-0 overflow-hidden"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* Info overlay - unified with Visualizer style */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none select-none">
                <div className="text-slate-500 dark:text-slate-400 text-xs bg-white/50 dark:bg-google-dark-surface/50 backdrop-blur px-2 py-1 rounded border border-slate-200 dark:border-google-dark-border">
                    {mode === 'hardware' ? t.hardware : t.detail} {t.modeLabel}
                </div>
            </div>

            {/* Settings panel - draggable */}
            <div 
                ref={optionsPanelRef}
                className="absolute z-10 pointer-events-auto"
                style={optionsPanelPos 
                    ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto' }
                    : { top: '16px', right: '16px' }
                }
            >
                <div className="bg-white/80 dark:bg-google-dark-surface/80 backdrop-blur rounded-lg border border-slate-200 dark:border-google-dark-border flex flex-col w-48 shadow-xl overflow-hidden">
                    <div 
                        className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100/50 dark:bg-google-dark-bg/50 hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between"
                        onMouseDown={(e) => handleMouseDown('options', e)}
                    >
                        <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                            </svg>
                            {mode === 'hardware' ? t.hardwareOptions : t.detailOptions}
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); toggleOptionsCollapsed(); }}
                            className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                        >
                            {isOptionsCollapsed ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                            )}
                        </button>
                    </div>
                    
                    {!isOptionsCollapsed && (
                    <div className="px-2 pb-2 pt-1 flex flex-col gap-2">
                        <div className="border-b border-slate-200 dark:border-slate-700 pb-2 mb-1">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1.5 px-1">{t.highlightMode || "Selection Mode"}</div>
                            <div className="flex bg-slate-100 dark:bg-google-dark-bg rounded p-0.5">
                                <button
                                    onClick={() => setHighlightMode('link')}
                                    className={`flex-1 py-1 text-[10px] font-medium rounded transition-all ${highlightMode === 'link' ? 'bg-white dark:bg-google-dark-surface text-google-blue shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                >
                                    {t.linkMode || "Link"}
                                </button>
                                <button
                                    onClick={() => setHighlightMode('collision')}
                                    className={`flex-1 py-1 text-[10px] font-medium rounded transition-all ${highlightMode === 'collision' ? 'bg-white dark:bg-google-dark-surface text-google-blue shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'}`}
                                >
                                    {t.collisionMode || "Collision"}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg/50">
                                <input 
                                    type="checkbox" 
                                    checked={showJointControls} 
                                    onChange={(e) => setShowJointControls(e.target.checked)}
                                    className="rounded bg-white dark:bg-google-dark-bg border-slate-300 dark:border-google-dark-border text-google-blue focus:ring-google-blue focus:ring-offset-0"
                                />
                                {t.showJointControls}
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg/50">
                                <input 
                                    type="checkbox" 
                                    checked={showVisual} 
                                    onChange={(e) => setShowVisual(e.target.checked)}
                                    className="rounded bg-white dark:bg-google-dark-bg border-slate-300 dark:border-google-dark-border text-google-blue focus:ring-google-blue focus:ring-offset-0"
                                />
                                {t.showVisual}
                            </label>
                            
                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg/50">
                                <input 
                                    type="checkbox" 
                                    checked={showCollision} 
                                    onChange={(e) => setShowCollision(e.target.checked)}
                                    className="rounded bg-white dark:bg-google-dark-bg border-slate-300 dark:border-google-dark-border text-google-blue focus:ring-google-blue focus:ring-offset-0"
                                />
                                {t.showCollision}
                            </label>
                        </div>

                        <div className="border-t border-slate-200 dark:border-slate-700 pt-2 space-y-1">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1 px-1">Gizmos</div>
                            
                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg/50">
                                <input 
                                    type="checkbox" 
                                    checked={showOrigins} 
                                    onChange={(e) => setShowOrigins(e.target.checked)}
                                    className="rounded bg-white dark:bg-google-dark-bg border-slate-300 dark:border-google-dark-border text-google-blue focus:ring-google-blue focus:ring-offset-0"
                                />
                                <Move className="w-3 h-3 text-slate-500" />
                                {t.showOrigin || "Origins"}
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg/50">
                                <input 
                                    type="checkbox" 
                                    checked={showJointAxes} 
                                    onChange={(e) => setShowJointAxes(e.target.checked)}
                                    className="rounded bg-white dark:bg-google-dark-bg border-slate-300 dark:border-google-dark-border text-google-blue focus:ring-google-blue focus:ring-offset-0"
                                />
                                <ArrowUpRight className="w-3 h-3 text-slate-500" />
                                {t.showJointAxes || "Joint Axes"}
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg/50">
                                <input 
                                    type="checkbox" 
                                    checked={showCenterOfMass} 
                                    onChange={(e) => setShowCenterOfMass(e.target.checked)}
                                    className="rounded bg-white dark:bg-google-dark-bg border-slate-300 dark:border-google-dark-border text-google-blue focus:ring-google-blue focus:ring-offset-0"
                                />
                                <div className="w-3 h-3 rounded-full border border-slate-500 flex items-center justify-center">
                                    <div className="w-1 h-1 bg-slate-500 rounded-full"></div>
                                </div>
                                {t.showCenterOfMass}
                            </label>

                            <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer hover:text-slate-900 dark:hover:text-white px-1 py-0.5 rounded hover:bg-slate-50 dark:hover:bg-google-dark-bg/50">
                                <input 
                                    type="checkbox" 
                                    checked={showInertia} 
                                    onChange={(e) => setShowInertia(e.target.checked)}
                                    className="rounded bg-white dark:bg-google-dark-bg border-slate-300 dark:border-google-dark-border text-google-blue focus:ring-google-blue focus:ring-offset-0"
                                />
                                <div className="w-3 h-3 border border-dashed border-slate-500"></div>
                                {t.showInertia || "Show Inertia"}
                            </label>
                        </div>
                    </div>
                    )}
                </div>
            </div>
            
            {/* Joint controls panel - draggable */}
            {showJointControls && robot?.joints && Object.keys(robot.joints).length > 0 && (
                <div 
                    ref={jointPanelRef}
                    className="absolute z-10 bg-white/90 dark:bg-google-dark-surface/90 backdrop-blur rounded-lg border border-slate-200 dark:border-google-dark-border max-h-[50vh] overflow-hidden w-64 shadow-xl flex flex-col pointer-events-auto"
                    style={jointPanelPos 
                        ? { left: jointPanelPos.x, top: jointPanelPos.y, right: 'auto', bottom: 'auto' }
                        : { bottom: '16px', right: '16px' }
                    }
                >
                    <div 
                        className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100/50 dark:bg-google-dark-bg/50 hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between flex-shrink-0"
                        onMouseDown={(e) => handleMouseDown('joints', e)}
                    >
                        <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                            </svg>
                            {t.jointControls}
                        </div>
                        <div className="flex items-center gap-2">
                             <button
                                onClick={(e) => { e.stopPropagation(); handleResetJoints(); }}
                                className="p-1 rounded bg-slate-200 dark:bg-google-dark-bg hover:bg-slate-300 dark:hover:bg-google-dark-border text-slate-700 dark:text-white"
                                title="Reset Joints"
                            >
                                <RotateCcw className="w-3 h-3" />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); setAngleUnit(angleUnit === 'rad' ? 'deg' : 'rad'); }}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-google-dark-bg hover:bg-slate-300 dark:hover:bg-google-dark-border text-slate-700 dark:text-white font-mono"
                                title={t.switchUnit}
                            >
                                {angleUnit.toUpperCase()}
                            </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); toggleJointsCollapsed(); }}
                                                        className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                                                    >                                {isJointsCollapsed ? (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                                ) : (
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                                )}
                            </button>
                        </div>
                    </div>
                    {!isJointsCollapsed && (
                    <div className="p-3 overflow-y-auto flex-1">
                    <div className="space-y-2">
                        {Object.entries(robot.joints)
                            .filter(([_, joint]: [string, any]) => joint.jointType !== 'fixed')
                            .map(([name, joint]: [string, any]) => (
                                <JointControlItem 
                                    key={name}
                                    name={name}
                                    joint={joint}
                                    jointAngles={jointAngles}
                                    angleUnit={angleUnit}
                                    activeJoint={activeJoint}
                                    setActiveJoint={setActiveJoint}
                                    handleJointAngleChange={handleJointAngleChange}
                                    onSelect={onSelect}
                                />
                            ))}
                    </div>
                    </div>
                    )}
                </div>
            )}
            
            <Canvas
                camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 60 }}
                shadows
                gl={{
                    antialias: true,
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: 1.0,
                }}
                onPointerMissed={() => {
                    // Don't deselect if we just selected something via DOM events
                    if (justSelectedRef.current) return;
                    
                    // Clicked on empty space - deselect
                    if (onSelect) {
                        onSelect('link', '');
                    }
                    setActiveJoint(null);
                }}
            >
                <color attach="background" args={[theme === 'light' ? '#f8f9fa' : '#1f1f1f']} />
                <SceneLighting />
                <Environment files="/potsdamer_platz_1k.hdr" />
                
                <Suspense fallback={null}>
                    <RobotModel
                        urdfContent={urdfContent}
                        assets={assets}
                        onRobotLoaded={handleRobotLoaded}
                        showCollision={showCollision}
                        showVisual={showVisual}
                        onSelect={handleSelectWrapper}
                        onJointChange={handleJointAngleChange}
                        jointAngles={jointAngles}
                        setIsDragging={setIsDragging}
                        setActiveJoint={setActiveJoint}
                        justSelectedRef={justSelectedRef}
                        t={t}
                        mode={mode}
                        selection={selection}
                        hoveredSelection={hoveredSelection}
                        highlightMode={highlightMode}
                        showInertia={showInertia}
                        showCenterOfMass={showCenterOfMass}
                        showOrigins={showOrigins}
                        showJointAxes={showJointAxes}
                        robotLinks={robotLinks}
                        focusTarget={focusTarget}
                    />
                </Suspense>
                
                {activeJoint && robot?.joints?.[activeJoint] && (
                    <JointInteraction 
                        joint={robot.joints[activeJoint]} 
                        value={jointAngles[activeJoint] || 0}
                        onChange={(val) => handleJointAngleChange(activeJoint, val)}
                    />
                )}
                
                <Grid 
                    infiniteGrid 
                    fadeDistance={100}
                    sectionSize={1}
                    cellSize={0.1}
                    sectionThickness={1.5}
                    cellThickness={0.5}
                    cellColor={theme === 'light' ? '#cbd5e1' : '#444444'} 
                    sectionColor={theme === 'light' ? '#94a3b8' : '#555555'}
                    rotation={[Math.PI / 2, 0, 0]}
                    position={[0, 0, -0.01]}
                />
                
                <OrbitControls
                    makeDefault
                    enableDamping={false}
                    minDistance={0.5}
                    maxDistance={20}
                    enabled={!isDragging}
                />
                
                <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                    <GizmoViewport labelColor={theme === 'light' ? '#0f172a' : 'white'} axisHeadScale={1} />
                </GizmoHelper>
            </Canvas>
        </div>
    );
}

export default URDFViewer;