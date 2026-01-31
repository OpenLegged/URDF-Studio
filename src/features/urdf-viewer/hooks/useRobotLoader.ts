import { useState, useEffect, useRef, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
// @ts-ignore
import URDFLoader from 'urdf-loader';
import { disposeObject3D } from '../utils/dispose';
import { enhanceMaterials, collisionBaseMaterial } from '../utils/materials';
import { parseURDFMaterials, applyURDFMaterials } from '../utils/urdfMaterials';
import { offsetRobotToGround } from '../utils/robotPositioning';
import { SHARED_MATERIALS } from '../constants';
import { createLoadingManager, createMeshLoader } from '@/core/loaders';
import { loadMJCFToThreeJS, isMJCFContent } from '@/core/parsers/mjcf';

export interface UseRobotLoaderOptions {
    urdfContent: string;
    assets: Record<string, string>;
    showCollision: boolean;
    showVisual: boolean;
    onRobotLoaded?: (robot: THREE.Object3D) => void;
}

export interface UseRobotLoaderResult {
    robot: THREE.Object3D | null;
    error: string | null;
    robotVersion: number;
    robotRef: React.MutableRefObject<THREE.Object3D | null>;
    linkMeshMapRef: React.MutableRefObject<Map<string, THREE.Mesh[]>>;
}

export function useRobotLoader({
    urdfContent,
    assets,
    showCollision,
    showVisual,
    onRobotLoaded
}: UseRobotLoaderOptions): UseRobotLoaderResult {
    const [robot, setRobot] = useState<THREE.Object3D | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [robotVersion, setRobotVersion] = useState(0);
    const { invalidate } = useThree();

    // Ref to track current robot for proper cleanup (avoids stale closure issues)
    const robotRef = useRef<THREE.Object3D | null>(null);
    // Track if component is mounted to prevent state updates after unmount
    const isMountedRef = useRef(true);
    // Track loading abort controller to cancel duplicate loads
    const loadAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

    // Refs for visibility state (used in loading callback)
    const showVisualRef = useRef(showVisual);
    const showCollisionRef = useRef(showCollision);

    // PERFORMANCE: Pre-built map of linkName -> meshes for O(1) highlight lookup
    const linkMeshMapRef = useRef<Map<string, THREE.Mesh[]>>(new Map());

    // Keep refs in sync
    useEffect(() => { showVisualRef.current = showVisual; }, [showVisual]);
    useEffect(() => { showCollisionRef.current = showCollision; }, [showCollision]);

    // Track component mount state for preventing state updates after unmount
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

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
    }, [urdfContent, assets, invalidate, onRobotLoaded]);

    return {
        robot,
        error,
        robotVersion,
        robotRef,
        linkMeshMapRef
    };
}
