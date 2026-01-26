import React, { useState, useMemo, useRef, useEffect, useCallback, memo } from 'react';
import { useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { MeasureToolProps } from '../types';
import { throttle } from '@/shared/utils';

// ============================================================
// PERFORMANCE: Module-level object pool to eliminate GC pressure
// ============================================================
const _pooledRay = new THREE.Ray();
// Minimum pixel movement threshold before triggering raycast
const MOUSE_MOVE_THRESHOLD = 2;
// Throttle interval in ms (~30fps)
const THROTTLE_INTERVAL = 33;

// Memoized measurement item to avoid creating new Vector3 on each render
const MeasurementItem = memo(({
    pair,
    idx,
    isHovered,
    onHover,
    onLeave,
    onDelete
}: {
    pair: [THREE.Vector3, THREE.Vector3];
    idx: number;
    isHovered: boolean;
    onHover: () => void;
    onLeave: () => void;
    onDelete: () => void;
}) => {
    // Cache midpoint calculation - only recalculate when pair changes
    const midpoint = useMemo(() =>
        new THREE.Vector3().addVectors(pair[0], pair[1]).multiplyScalar(0.5),
        [pair]
    );

    const distance = useMemo(() => pair[0].distanceTo(pair[1]).toFixed(4), [pair]);
    const color = isHovered ? "#ef4444" : "#22c55e";

    return (
        <group>
            <mesh position={pair[0]}>
                <sphereGeometry args={[0.0025, 16, 16]} />
                <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.8} />
            </mesh>
            <mesh position={pair[1]}>
                <sphereGeometry args={[0.0025, 16, 16]} />
                <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.8} />
            </mesh>
            <Line points={[pair[0], pair[1]]} color={color} lineWidth={2} depthTest={false} />
            <Html position={midpoint}>
                <div
                    className={`bg-black/70 text-white px-2 py-1 rounded text-xs whitespace-nowrap font-mono cursor-pointer transition-colors group flex items-center gap-1 ${isHovered ? 'bg-red-600/90' : 'hover:bg-slate-700'}`}
                    onMouseEnter={onHover}
                    onMouseLeave={onLeave}
                    onClick={(e) => { e.stopPropagation(); onDelete(); }}
                    title="点击删除此测量"
                >
                    {distance}m
                    <svg className={`w-3 h-3 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </div>
            </Html>
        </group>
    );
});

// Current measurement preview (in progress)
const CurrentMeasurementPreview = memo(({ points }: { points: THREE.Vector3[] }) => {
    const midpoint = useMemo(() => {
        if (points.length !== 2) return null;
        return new THREE.Vector3().addVectors(points[0], points[1]).multiplyScalar(0.5);
    }, [points]);

    const distance = useMemo(() => {
        if (points.length !== 2) return null;
        return points[0].distanceTo(points[1]).toFixed(4);
    }, [points]);

    return (
        <>
            {points.map((p, i) => (
                <mesh key={`current-${i}`} position={p}>
                    <sphereGeometry args={[0.0025, 16, 16]} />
                    <meshBasicMaterial color="#ef4444" depthTest={false} transparent opacity={0.8} />
                </mesh>
            ))}
            {points.length === 2 && midpoint && (
                <>
                    <Line points={[points[0], points[1]]} color="#ef4444" lineWidth={2} depthTest={false} />
                    <Html position={midpoint}>
                        <div className="bg-black/70 text-white px-2 py-1 rounded text-xs whitespace-nowrap pointer-events-none font-mono">
                            {distance}m
                        </div>
                    </Html>
                </>
            )}
        </>
    );
});

export const MeasureTool: React.FC<MeasureToolProps> = ({
    active,
    robot,
    measureState,
    setMeasureState
}) => {
    const { camera, gl } = useThree();
    const [hoveredMeasurementIdx, setHoveredMeasurementIdx] = useState<number | null>(null);
    const raycaster = useMemo(() => new THREE.Raycaster(), []);
    const mouse = useRef(new THREE.Vector2());

    // PERFORMANCE: Track last mouse position for state locking
    const lastMousePosRef = useRef({ x: 0, y: 0 });
    // PERFORMANCE: Cached robot bounding box for two-phase detection
    const robotBoundingBoxRef = useRef<THREE.Box3 | null>(null);

    const { measurements, currentPoints, tempPoint } = measureState;

    // PERFORMANCE: Get/update robot bounding box (cached)
    const getRobotBoundingBox = useCallback(() => {
        if (!robot) return null;
        if (!robotBoundingBoxRef.current) {
            robotBoundingBoxRef.current = new THREE.Box3();
        }
        robotBoundingBoxRef.current.setFromObject(robot);
        robotBoundingBoxRef.current.expandByScalar(0.05);
        return robotBoundingBoxRef.current;
    }, [robot]);

    // PERFORMANCE: Two-phase detection - check bounding box first
    const rayIntersectsBoundingBox = useCallback((raycasterInstance: THREE.Raycaster): boolean => {
        const bbox = getRobotBoundingBox();
        if (!bbox) return false;
        _pooledRay.copy(raycasterInstance.ray);
        return _pooledRay.intersectsBox(bbox);
    }, [getRobotBoundingBox]);

    // Only clear temp state when deactivating, keep measurements
    useEffect(() => {
        if (!active) {
            setMeasureState(prev => ({ ...prev, currentPoints: [], tempPoint: null }));
        }
    }, [active, setMeasureState]);

    // Keyboard shortcuts
    useEffect(() => {
        if (!active) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            // Escape: cancel current measurement in progress
            if (event.key === 'Escape') {
                if (currentPoints.length > 0) {
                    setMeasureState(prev => ({ ...prev, currentPoints: [], tempPoint: null }));
                }
            }
            // Backspace or Delete: remove last measurement
            if (event.key === 'Backspace' || event.key === 'Delete') {
                if (currentPoints.length > 0) {
                    setMeasureState(prev => ({ ...prev, currentPoints: [], tempPoint: null }));
                } else if (measurements.length > 0) {
                    setMeasureState(prev => ({ ...prev, measurements: prev.measurements.slice(0, -1) }));
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [active, currentPoints, measurements, setMeasureState]);

    // Ref to track current points for throttled handler (avoids stale closure)
    const currentPointsRef = useRef(currentPoints);
    useEffect(() => { currentPointsRef.current = currentPoints; }, [currentPoints]);

    // Throttled mouse move ref for proper cleanup
    const throttledMouseMoveRef = useRef<ReturnType<typeof throttle> | null>(null);

    useEffect(() => {
        if (!active || !robot) {
            // Cleanup throttled handler when deactivating
            if (throttledMouseMoveRef.current) {
                throttledMouseMoveRef.current.cancel();
                throttledMouseMoveRef.current = null;
            }
            return;
        }

        // Create throttled mouse move handler
        const handleMouseMoveCore = (event: MouseEvent) => {
            // PERFORMANCE: State locking - skip if mouse moved less than threshold
            const dx = event.clientX - lastMousePosRef.current.x;
            const dy = event.clientY - lastMousePosRef.current.y;
            const distSq = dx * dx + dy * dy;

            if (distSq < MOUSE_MOVE_THRESHOLD * MOUSE_MOVE_THRESHOLD) {
                return; // Skip - mouse hasn't moved enough
            }

            // Update last position
            lastMousePosRef.current.x = event.clientX;
            lastMousePosRef.current.y = event.clientY;

            const rect = gl.domElement.getBoundingClientRect();
            mouse.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            if (currentPointsRef.current.length === 1) {
                 raycaster.setFromCamera(mouse.current, camera);

                 // PERFORMANCE: Two-phase detection - check bounding box first
                 if (!rayIntersectsBoundingBox(raycaster)) {
                     setMeasureState(prev => ({ ...prev, tempPoint: null }));
                     return;
                 }

                 const intersects = raycaster.intersectObject(robot, true);
                 if (intersects.length > 0) {
                     setMeasureState(prev => ({ ...prev, tempPoint: intersects[0].point.clone() }));
                 } else {
                     setMeasureState(prev => ({ ...prev, tempPoint: null }));
                 }
            }
        };

        const throttledMouseMove = throttle(handleMouseMoveCore, THROTTLE_INTERVAL);
        throttledMouseMoveRef.current = throttledMouseMove;

        const handleClick = (event: MouseEvent) => {
             // Ignore clicks on UI elements or context menu
             if ((event.target as HTMLElement).closest('.urdf-toolbar') ||
                 (event.target as HTMLElement).closest('.urdf-options-panel') ||
                 (event.target as HTMLElement).closest('.urdf-joint-panel') ||
                 (event.target as HTMLElement).closest('.measure-context-menu') ||
                 (event.target as HTMLElement).closest('.measure-panel')) return;

             raycaster.setFromCamera(mouse.current, camera);

             // PERFORMANCE: Two-phase detection - check bounding box first
             if (!rayIntersectsBoundingBox(raycaster)) {
                 return; // Click missed robot entirely
             }

             const intersects = raycaster.intersectObject(robot, true);

             if (intersects.length > 0) {
                 const point = intersects[0].point.clone();

                 if (currentPointsRef.current.length === 0) {
                     // First point of new measurement
                     setMeasureState(prev => ({ ...prev, currentPoints: [point] }));
                 } else if (currentPointsRef.current.length === 1) {
                     // Second point - complete measurement
                     setMeasureState(prev => ({
                         ...prev,
                         measurements: [...prev.measurements, [prev.currentPoints[0], point]],
                         currentPoints: [],
                         tempPoint: null
                     }));
                 }
             }
        };

        gl.domElement.addEventListener('mousemove', throttledMouseMove);
        gl.domElement.addEventListener('click', handleClick);

        return () => {
            throttledMouseMove.cancel();
            gl.domElement.removeEventListener('mousemove', throttledMouseMove);
            gl.domElement.removeEventListener('click', handleClick);
            throttledMouseMoveRef.current = null;
        };
    }, [active, robot, camera, gl, raycaster, setMeasureState, rayIntersectsBoundingBox]);

    const handleDeleteMeasurement = (idx: number) => {
        setMeasureState(prev => ({ ...prev, measurements: prev.measurements.filter((_, i) => i !== idx) }));
    };

    // Render current measurement in progress
    const renderCurrentPoints = [...currentPoints];
    if (currentPoints.length === 1 && tempPoint) {
        renderCurrentPoints.push(tempPoint);
    }

    return (
        <group>
            {/* Render all completed measurements using memoized component */}
            {measurements.map((pair, idx) => (
                <MeasurementItem
                    key={`measurement-${idx}`}
                    pair={pair}
                    idx={idx}
                    isHovered={hoveredMeasurementIdx === idx}
                    onHover={() => setHoveredMeasurementIdx(idx)}
                    onLeave={() => setHoveredMeasurementIdx(null)}
                    onDelete={() => handleDeleteMeasurement(idx)}
                />
            ))}

            {/* Render current measurement in progress using memoized component */}
            {active && <CurrentMeasurementPreview points={renderCurrentPoints} />}
        </group>
    );
};
