import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MathUtils } from '@/shared/utils';
import { collisionBaseMaterial, emptyRaycast } from '../utils/materials';
import {
    createJointAxisVisualization,
    createOriginAxes,
    createJointAxisViz,
    createCoMVisual,
    createInertiaBox
} from '../utils/visualizationFactories';
import type { UrdfLink } from '@/types';
import type { ToolMode, URDFViewerProps } from '../types';

export interface UseVisualizationEffectsOptions {
    robot: THREE.Object3D | null;
    robotVersion: number;
    showCollision: boolean;
    showVisual: boolean;
    highlightMode: 'link' | 'collision';
    showInertia: boolean;
    showInertiaOverlay?: boolean;
    showCenterOfMass: boolean;
    showCoMOverlay?: boolean;
    centerOfMassSize: number;
    showOrigins: boolean;
    showOriginsOverlay?: boolean;
    originSize: number;
    showJointAxes: boolean;
    showJointAxesOverlay?: boolean;
    jointAxisSize: number;
    modelOpacity: number;
    robotLinks?: Record<string, UrdfLink>;
    toolMode: ToolMode;
    selection?: URDFViewerProps['selection'];
    hoveredSelection?: URDFViewerProps['selection'];
    highlightGeometry: (
        linkName: string | null,
        revert: boolean,
        subType?: 'visual' | 'collision',
        meshToHighlight?: THREE.Object3D | null
    ) => void;
    highlightedMeshesRef: React.MutableRefObject<Map<THREE.Mesh, THREE.Material | THREE.Material[]>>;
}

export function useVisualizationEffects({
    robot,
    robotVersion,
    showCollision,
    showVisual,
    highlightMode,
    showInertia,
    showInertiaOverlay = true,
    showCenterOfMass,
    showCoMOverlay = true,
    centerOfMassSize,
    showOrigins,
    showOriginsOverlay = true,
    originSize,
    showJointAxes,
    showJointAxesOverlay = true,
    jointAxisSize,
    modelOpacity,
    robotLinks,
    toolMode,
    selection,
    hoveredSelection,
    highlightGeometry,
    highlightedMeshesRef
}: UseVisualizationEffectsOptions): void {
    const { invalidate, scene } = useThree();

    // Track current selection/hover for cleanup
    const currentSelectionRef = useRef<{ id: string | null; subType: string | null }>({ id: null, subType: null });
    const currentHoverRef = useRef<{ id: string | null; subType: string | null }>({ id: null, subType: null });

    // Refs for visibility state
    const showVisualRef = useRef(showVisual);
    const showCollisionRef = useRef(showCollision);

    useEffect(() => { showVisualRef.current = showVisual; }, [showVisual]);
    useEffect(() => { showCollisionRef.current = showCollision; }, [showCollision]);

    // Clean up all tracked highlights on unmount
    useEffect(() => {
        return () => {
            highlightedMeshesRef.current.forEach((origMaterial, mesh) => {
                mesh.material = origMaterial;
            });
            highlightedMeshesRef.current.clear();
        };
    }, [highlightedMeshesRef]);

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
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            // Handle visual group containers (from MJCF loader)
            if (child.userData?.isVisualGroup) {
                child.visible = showVisual;
                return;
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
                        break;
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

            // Handle joint axis helpers
            if (child.name === '__joint_axis_helper__') {
                child.visible = showJointAxes;
                const scale = jointAxisSize || 1.0;
                child.scale.set(scale, scale, scale);
            }

            // Handle debug AxesHelper for joint pivot verification
            if (child.name === '__debug_joint_axes__') {
                child.visible = showJointAxes;
                const scale = jointAxisSize || 1.0;
                child.scale.set(scale, scale, scale);
            }

            // Handle URDF joint axis visualization
            if (child.isURDFJoint && child.axis) {
                let axisHelper = child.children.find((c: any) => c.name === '__joint_axis_helper__');
                if (!axisHelper && showJointAxes) {
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

            // Apply model opacity to VISUAL meshes only
            if (child.isMesh) {
                if (child.userData?.isGizmo) return;

                const isCollision = child.isURDFCollider ||
                    child.userData?.isCollisionMesh ||
                    child.userData?.isCollision;
                if (isCollision) return;

                let parent = child.parent;
                while (parent && parent !== robot) {
                    if (parent.userData?.isGizmo ||
                        parent.isURDFCollider ||
                        parent.userData?.isCollisionMesh ||
                        parent.name === '__inertia_visual__' ||
                        parent.name === '__com_visual__' ||
                        parent.name === '__inertia_box__' ||
                        parent.name === '__origin_axes__' ||
                        parent.name === '__joint_axis_helper__') {
                        return;
                    }
                    parent = parent.parent;
                }

                if (child.material) {
                    const materials = Array.isArray(child.material) ? child.material : [child.material];
                    materials.forEach((mat: any) => {
                        if (mat &&
                            !mat.userData?.isSharedMaterial &&
                            !mat.userData?.isCollisionMaterial &&
                            mat.depthTest !== false) {
                            const isTransparent = modelOpacity < 1.0;
                            mat.transparent = isTransparent;
                            mat.opacity = modelOpacity;
                            mat.depthWrite = true;
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
            if (child.parent && child.parent.isURDFLink && !child.isURDFJoint && !child.isURDFCollider && child.userData?.isGizmo !== true) {
                const linkName = child.parent.name;
                const isLinkVisible = robotLinks?.[linkName]?.visible !== false;
                child.visible = isLinkVisible;
            }
            if (child.isMesh && !child.isURDFCollider && !child.userData.isCollisionMesh && child.userData?.isGizmo !== true) {
                let linkName = '';
                if (child.parent && child.parent.isURDFLink) linkName = child.parent.name;
                else if (child.parent && child.parent.parent && child.parent.parent.isURDFLink) linkName = child.parent.parent.name;

                const isLinkVisible = linkName ? (robotLinks?.[linkName]?.visible !== false) : true;
                child.visible = isLinkVisible;
            }
        });
    }, [robot, robotVersion, robotLinks]);

    // Effect to handle inertia and CoM visualization
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (!child.isURDFLink) return;

            const linkName = child.name;
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
                    comVisual = createCoMVisual();
                    vizGroup.add(comVisual);
                }

                // Apply size scale based on centerOfMassSize
                const sizeScale = centerOfMassSize / 0.01;
                comVisual.scale.set(sizeScale, sizeScale, sizeScale);

                comVisual.visible = showCenterOfMass;
                if (showCenterOfMass) {
                    comVisual.traverse((c: any) => {
                        if (c.material) {
                            c.material.opacity = 0.95;
                            c.material.transparent = true;
                            // When showCoMOverlay is true, disable depth test to show on top
                            c.material.depthTest = !showCoMOverlay;
                            c.material.depthWrite = !showCoMOverlay;
                        }
                        if (c.isMesh) {
                            c.renderOrder = showCoMOverlay ? 10001 : 0;
                        }
                    });
                }

                // Inertia Box
                let inertiaBox = vizGroup.children.find((c: any) => c.name === '__inertia_box__');

                if (!inertiaBox) {
                    let maxLinkSize: number | undefined;
                    try {
                        const linkBox = new THREE.Box3().setFromObject(child);
                        const linkSize = linkBox.getSize(new THREE.Vector3());
                        maxLinkSize = Math.max(linkSize.x, linkSize.y, linkSize.z);
                        if (!isFinite(maxLinkSize) || maxLinkSize <= 0) {
                            maxLinkSize = undefined;
                        }
                    } catch (e) {
                        maxLinkSize = undefined;
                    }

                    const boxData = MathUtils.computeInertiaBox(inertialData, maxLinkSize);

                    if (boxData) {
                        const { width, height, depth, rotation } = boxData;
                        inertiaBox = createInertiaBox(width, height, depth, rotation);
                        vizGroup.add(inertiaBox);
                    }
                }

                if (inertiaBox) {
                    inertiaBox.visible = showInertia;
                    if (showInertia) {
                        inertiaBox.traverse((c: any) => {
                            if (c.material) {
                                const baseMat = c.material as THREE.Material & { opacity?: number };
                                if (c.type === 'Mesh') {
                                    baseMat.opacity = 0.25;
                                } else if (c.type === 'LineSegments') {
                                    baseMat.opacity = 0.6;
                                }

                                // Apply overlay settings
                                baseMat.transparent = true;
                                baseMat.depthTest = !showInertiaOverlay;
                                baseMat.depthWrite = !showInertiaOverlay;
                            }
                            if (c.isMesh || c.type === 'LineSegments') {
                                c.renderOrder = showInertiaOverlay ? 10001 : 0;
                            }
                        });
                    }
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
        });

        invalidate();
    }, [robot, showInertia, showInertiaOverlay, showCenterOfMass, showCoMOverlay, centerOfMassSize, robotVersion, invalidate, robotLinks]);

    // Effect to handle origin axes visualization for each link
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (child.isURDFLink) {
                let originAxes = child.children.find((c: any) => c.name === '__origin_axes__');

                if (!originAxes && showOrigins) {
                    originAxes = createOriginAxes(originSize);
                    child.add(originAxes);
                }

                if (originAxes) {
                    originAxes.visible = showOrigins;
                    if (showOrigins) {
                        const currentSize = originSize;
                        originAxes.scale.setScalar(1);

                        // Checks and recreation if size changed
                        const existingAxisMesh = originAxes.children[0];
                        if (existingAxisMesh && existingAxisMesh.geometry) {
                            const params = (existingAxisMesh.geometry as THREE.CylinderGeometry).parameters;
                            if (params && Math.abs(params.height - currentSize) > 0.001) {
                                while (originAxes.children.length > 0) {
                                    const c = originAxes.children[0];
                                    originAxes.remove(c);
                                    if ((c as any).geometry) (c as any).geometry.dispose();
                                    if ((c as any).material) (c as any).material.dispose();
                                }

                                const newAxes = createOriginAxes(currentSize);
                                newAxes.children.forEach((c: any) => originAxes.add(c.clone()));
                            }
                        }

                        // Update overlay state via traversal (Applied AFTER potential recreation)
                        originAxes.traverse((c: any) => {
                            if (c.material) {
                                // If overlay is true, disable depth test to show on top
                                c.material.depthTest = !showOriginsOverlay;
                                c.material.depthWrite = !showOriginsOverlay;
                                // FORCE transparent = true when overlay is on.
                                // This ensures these meshes are rendered in the transparent queue (after opaque objects).
                                // Combined with high renderOrder, this guarantees they appear on top of transparent robot parts.
                                c.material.transparent = showOriginsOverlay ? true : false;
                                c.material.needsUpdate = true;
                            }
                            if (c.isMesh) {
                                c.renderOrder = showOriginsOverlay ? 10001 : 0;
                            }
                        });
                    }
                }
            }
        });

        invalidate();
    }, [robot, showOrigins, showOriginsOverlay, originSize, robotVersion, invalidate]);

    // Effect to handle joint axes visualization
    useEffect(() => {
        if (!robot) return;

        robot.traverse((child: any) => {
            if (child.isURDFJoint && child.jointType !== 'fixed') {
                let jointAxisViz = child.children.find((c: any) => c.name === '__joint_axis__');

                if (!jointAxisViz && showJointAxes) {
                    const axis = child.axis || new THREE.Vector3(0, 0, 1);
                    jointAxisViz = createJointAxisViz(child.jointType, axis, jointAxisSize);
                    child.add(jointAxisViz);
                }

                if (jointAxisViz) {
                    jointAxisViz.visible = showJointAxes;

                    if (showJointAxes) {
                        if (!jointAxisViz.userData.originalScale) {
                            jointAxisViz.userData.originalScale = jointAxisSize;
                        }

                        const currentScale = jointAxisSize;
                        const originalScale = jointAxisViz.userData.originalScale;

                        if (Math.abs(currentScale - originalScale) > 0.01) {
                            child.remove(jointAxisViz);
                            jointAxisViz.traverse((obj: any) => {
                                if (obj.geometry) obj.geometry.dispose();
                                if (obj.material) obj.material.dispose();
                            });

                            const axis = child.axis || new THREE.Vector3(0, 0, 1);
                            const newJointAxisViz = createJointAxisViz(child.jointType, axis, currentScale);
                            child.add(newJointAxisViz);
                            // Important: Update the reference so the traversal below applies to the NEW object
                            jointAxisViz = newJointAxisViz;
                        }

                        // Update overlay state via traversal (Applied AFTER potential recreation)
                        jointAxisViz.traverse((c: any) => {
                            if (c.material) {
                                // If overlay is true, disable depth test to show on top
                                c.material.depthTest = !showJointAxesOverlay;
                                c.material.depthWrite = !showJointAxesOverlay;
                                // FORCE transparent = true when overlay is on.
                                // This ensures these meshes are rendered in the transparent queue (after opaque objects).
                                // Combined with high renderOrder, this guarantees they appear on top of transparent robot parts.
                                c.material.transparent = showJointAxesOverlay ? true : false;
                                if (showJointAxesOverlay && c.material.opacity === undefined) {
                                     c.material.opacity = 1.0;
                                }
                                c.material.needsUpdate = true;
                            }
                            if (c.isMesh) {
                                c.renderOrder = showJointAxesOverlay ? 10001 : 0;
                            }
                        });
                    }
                }
            }
        });

        invalidate();
    }, [robot, showJointAxes, showJointAxesOverlay, jointAxisSize, robotVersion, invalidate]);

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
    }, [robot, selection?.type, selection?.id, selection?.subType, highlightGeometry, robotVersion, highlightMode, showCollision, showVisual, toolMode]);

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
    }, [robot, hoveredSelection?.id, hoveredSelection?.subType, selection?.id, selection?.subType, highlightGeometry, robotVersion, toolMode, highlightMode, showVisual, showCollision]);
}
