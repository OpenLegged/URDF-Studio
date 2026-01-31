import { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { throttle } from '@/shared/utils';
import { MOUSE_MOVE_THRESHOLD, THROTTLE_INTERVAL } from '../constants';
import type { ToolMode } from '../types';

export interface UseMouseInteractionOptions {
    robot: THREE.Object3D | null;
    toolMode: ToolMode;
    mode?: 'detail' | 'hardware';
    highlightMode: 'link' | 'collision';
    showCollision: boolean;
    showVisual: boolean;
    onSelect?: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
    onJointChange?: (name: string, angle: number) => void;
    onJointChangeCommit?: (name: string, angle: number) => void;
    setIsDragging?: (dragging: boolean) => void;
    setActiveJoint?: (jointName: string | null) => void;
    justSelectedRef?: React.MutableRefObject<boolean>;
    isOrbitDragging?: React.MutableRefObject<boolean>;
    highlightGeometry: (
        linkName: string | null,
        revert: boolean,
        subType?: 'visual' | 'collision',
        meshToHighlight?: THREE.Object3D | null
    ) => void;
}

export interface UseMouseInteractionResult {
    mouseRef: React.MutableRefObject<THREE.Vector2>;
    raycasterRef: React.MutableRefObject<THREE.Raycaster>;
    hoveredLinkRef: React.MutableRefObject<string | null>;
    isDraggingJoint: React.MutableRefObject<boolean>;
    needsRaycastRef: React.MutableRefObject<boolean>;
    lastMousePosRef: React.MutableRefObject<{ x: number; y: number }>;
}

export function useMouseInteraction({
    robot,
    toolMode,
    mode,
    highlightMode,
    showCollision,
    showVisual,
    onSelect,
    onJointChange,
    onJointChangeCommit,
    setIsDragging,
    setActiveJoint,
    justSelectedRef,
    isOrbitDragging,
    highlightGeometry
}: UseMouseInteractionOptions): UseMouseInteractionResult {
    const { camera, gl, invalidate } = useThree();

    const mouseRef = useRef(new THREE.Vector2(-1000, -1000));
    const raycasterRef = useRef(new THREE.Raycaster());
    const hoveredLinkRef = useRef<string | null>(null);

    // PERFORMANCE: Track last mouse position for state locking (skip small movements)
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    // OPTIMIZATION: Signal that raycast is needed on next frame
    const needsRaycastRef = useRef(false);

    const isDraggingJoint = useRef(false);
    const dragJoint = useRef<any>(null);
    const dragHitDistance = useRef(0);
    const lastRayRef = useRef(new THREE.Ray());

    // Keep refs up to date
    const onJointChangeRef = useRef(onJointChange);
    const onJointChangeCommitRef = useRef(onJointChangeCommit);
    const setIsDraggingRef = useRef(setIsDragging);
    const setActiveJointRef = useRef(setActiveJoint);
    const invalidateRef = useRef(invalidate);

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
         */
        const findParentJoint = (linkObject: THREE.Object3D | null): any => {
            if (!linkObject) return null;

            let current: THREE.Object3D | null = linkObject.parent;

            while (current && current !== robot) {
                if ((current as any).isURDFJoint || (current as any).type === 'URDFJoint') {
                    const jointType = (current as any).jointType;

                    // Skip fixed joints
                    if (jointType === 'fixed') {
                        let parentLink: THREE.Object3D | null = current.parent;
                        while (parentLink && parentLink !== robot) {
                            if ((parentLink as any).isURDFLink || (parentLink as any).type === 'URDFLink') {
                                return findParentJoint(parentLink);
                            }
                            parentLink = parentLink.parent;
                        }
                        return null;
                    }

                    return current;
                }

                current = current.parent;
            }

            return null;
        };

        const getRevoluteDelta = (joint: any, startPt: THREE.Vector3, endPt: THREE.Vector3): number => {
            const axis = joint.axis || new THREE.Vector3(0, 0, 1);

            const worldQuat = new THREE.Quaternion();
            if (joint.bodyOffsetGroup) {
                joint.bodyOffsetGroup.getWorldQuaternion(worldQuat);
            } else if (joint.parent) {
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

            const worldQuat = new THREE.Quaternion();
            if (joint.bodyOffsetGroup) {
                joint.bodyOffsetGroup.getWorldQuaternion(worldQuat);
            } else if (joint.parent) {
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

            // CRITICAL: Only allow selection if the corresponding display option is enabled
            const isCollisionMode = highlightMode === 'collision';
            if ((isCollisionMode && !showCollision) || (!isCollisionMode && !showVisual)) {
                return;
            }

            const rect = gl.domElement.getBoundingClientRect();
            const mouse = new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1
            );

            raycasterRef.current.setFromCamera(mouse, camera);

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

                // Find the parent joint of the clicked link
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

            if (hoveredLinkRef.current) {
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
    }, [gl, camera, robot, onSelect, highlightGeometry, highlightMode, toolMode, mode, justSelectedRef, isOrbitDragging, showCollision, showVisual]);

    return {
        mouseRef,
        raycasterRef,
        hoveredLinkRef,
        isDraggingJoint,
        needsRaycastRef,
        lastMousePosRef
    };
}
