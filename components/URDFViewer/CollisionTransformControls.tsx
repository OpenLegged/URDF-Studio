import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { TransformControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import { CollisionTransformControlsProps } from './types';
import { translations } from '../../services/i18n';

// ============================================================
// PERFORMANCE: Module-level pooled objects to eliminate GC pressure
// ============================================================
const _pooledEuler = new THREE.Euler();
const _pooledColor = new THREE.Color();

export const CollisionTransformControls: React.FC<CollisionTransformControlsProps> = ({
    robot,
    selection,
    transformMode,
    setIsDragging,
    onTransformEnd,
    robotLinks,
    lang = 'en'
}) => {
    const t = translations[lang];
    const transformRef = useRef<any>(null);
    const { invalidate } = useThree();
    const [targetObject, setTargetObject] = useState<THREE.Object3D | null>(null);
    
    // Pending edit state - shown after drag ends, waiting for confirm/cancel
    const [pendingEdit, setPendingEdit] = useState<{
        axis: string;
        value: number;
        startValue: number;
        isRotate: boolean;
    } | null>(null);
    
    // Force re-render when pendingEdit changes
    const [, forceUpdate] = useState(0);
    
    // Store original transform for cancel
    const originalPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
    const originalRotationRef = useRef<THREE.Euler>(new THREE.Euler());
    
    // Track if currently dragging
    const isDraggingRef = useRef(false);
    const currentAxisRef = useRef<string | null>(null);
    const startValueRef = useRef<number>(0);

    // Store original axis colors to prevent highlight color changes
    const axisColorsRef = useRef<Map<any, THREE.Color>>(new Map());
    
    // Reset all axis materials to prevent any highlight effects
    // This is called on every frame to override TransformControls' internal highlighting
    const resetAxisMaterials = useCallback((gizmo: any) => {
        if (!gizmo) return;

        gizmo.traverse((child: any) => {
            if (!child.material || !child.material.color) return;

            // Store original color on first encounter
            if (!axisColorsRef.current.has(child)) {
                axisColorsRef.current.set(child, child.material.color.clone());
            }

            // Restore original color (prevents yellow highlight on hover)
            const originalColor = axisColorsRef.current.get(child);
            if (originalColor && !child.material.color.equals(originalColor)) {
                child.material.color.copy(originalColor);
            }

            // Keep full opacity, no transparency
            child.material.opacity = 1.0;
            child.material.transparent = false;
            child.material.needsUpdate = true;
        });
    }, []);
    
    // Use frame loop to continuously reset materials - this completely disables highlight
    useFrame(() => {
        const controls = transformRef.current;
        if (!controls || !targetObject) return;
        
        const gizmo = (controls as any).children?.[0];
        if (gizmo) {
            resetAxisMaterials(gizmo);
        }
    });

    // Setup event listeners for TransformControls
    useEffect(() => {
        const controls = transformRef.current;
        if (!controls || !targetObject) return;

        const handleDraggingChange = (event: any) => {
            const dragging = event.value;

            if (dragging) {
                // Start dragging
                isDraggingRef.current = true;
                setIsDragging(true);
                setIsDraggingAxis(true);

                // Store original position/rotation
                originalPositionRef.current.copy(targetObject.position);
                originalRotationRef.current.copy(targetObject.rotation);

                // Get current axis from controls
                const axis = controls.axis;
                currentAxisRef.current = axis;

                // Gizmo materials are reset via useFrame, no need for manual update here

                // Get start value
                const isRotate = transformMode === 'rotate';
                if (isRotate) {
                    const val = axis === 'X' ? targetObject.rotation.x :
                               axis === 'Y' ? targetObject.rotation.y :
                               axis === 'Z' ? targetObject.rotation.z : 0;
                    startValueRef.current = val;
                } else {
                    const val = axis === 'X' ? targetObject.position.x :
                               axis === 'Y' ? targetObject.position.y :
                               axis === 'Z' ? targetObject.position.z : 0;
                    startValueRef.current = val;
                }
            } else if (isDraggingRef.current) {
                // End dragging
                isDraggingRef.current = false;
                setIsDragging(false);
                setIsDraggingAxis(false);

                const axis = currentAxisRef.current;
                const isRotate = transformMode === 'rotate';

                // Gizmo materials are reset via useFrame, no need for manual update here

                // Get current value after drag
                let currentVal = 0;
                if (isRotate) {
                    currentVal = axis === 'X' ? targetObject.rotation.x :
                                axis === 'Y' ? targetObject.rotation.y :
                                axis === 'Z' ? targetObject.rotation.z : 0;
                } else {
                    currentVal = axis === 'X' ? targetObject.position.x :
                                axis === 'Y' ? targetObject.position.y :
                                axis === 'Z' ? targetObject.position.z : 0;
                }

                const delta = currentVal - startValueRef.current;

                // Show confirm UI if value changed (check for any change, positive or negative)
                if (Math.abs(delta) > 0.0001 && axis) {
                    setPendingEdit({
                        axis,
                        value: currentVal,
                        startValue: startValueRef.current,
                        isRotate
                    });
                    forceUpdate(n => n + 1);
                }
            }
            invalidate();
        };

        controls.addEventListener('dragging-changed', handleDraggingChange);

        return () => {
            controls.removeEventListener('dragging-changed', handleDraggingChange);
        };
    }, [targetObject, transformMode, setIsDragging, invalidate, pendingEdit]);
    
    // Find the selected collision mesh
    useEffect(() => {
        if (!robot || !selection?.id || selection.subType !== 'collision' || transformMode === 'select') {
            setTargetObject(null);
            setPendingEdit(null);
            return;
        }
        
        const linkName = selection.id;
        const linkObj = (robot as any).links?.[linkName];
        
        if (!linkObj) {
            setTargetObject(null);
            return;
        }
        
        let collisionGroup: THREE.Object3D | null = null;
        linkObj.traverse((child: any) => {
            if (!collisionGroup && child.isURDFCollider) {
                collisionGroup = child;
            }
        });
        
        if (collisionGroup) {
            const cg = collisionGroup as THREE.Object3D;
            setTargetObject(cg);
            // Store original position/rotation when target changes
            originalPositionRef.current.copy(cg.position);
            originalRotationRef.current.copy(cg.rotation);
        } else {
            setTargetObject(null);
        }
    }, [robot, selection, transformMode]);
    
    // Clear pending edit when selection changes or transformMode changes
    useEffect(() => {
        // When selection changes, cancel any pending edit by restoring original transform
        if (pendingEdit && targetObject) {
            targetObject.position.copy(originalPositionRef.current);
            targetObject.rotation.copy(originalRotationRef.current);
        }
        setPendingEdit(null);
    }, [selection?.id, selection?.type, selection?.subType, transformMode]);

    // Clear pending edit and restore when switching away from collision selection
    useEffect(() => {
        return () => {
            // Cleanup: if component unmounts with pending edit, restore original transform
            if (pendingEdit && targetObject) {
                targetObject.position.copy(originalPositionRef.current);
                targetObject.rotation.copy(originalRotationRef.current);
                invalidate();
            }
        };
    }, [pendingEdit, targetObject]);
    
    // Track hovered/dragged axis for single-axis highlight effect
    const [currentAxis, setCurrentAxis] = useState<string | null>(null);
    const [isDraggingAxis, setIsDraggingAxis] = useState(false);

    // Customize TransformControls appearance - thicker axes and disable highlight
    useEffect(() => {
        const controls = transformRef.current;
        if (!controls) return;

        // Access the gizmo to customize axis appearance
        const gizmo = (controls as any).children?.[0];
        if (!gizmo) return;

        // Make axes thicker by scaling line width and clone materials for independent control
        const updateAxisAppearance = () => {
            gizmo.traverse((child: any) => {
                if (child.isMesh || child.isLine) {
                    if (child.material) {
                        // PERFORMANCE FIX: Clone material to prevent shared material transparency issues
                        // This ensures each axis has its own material instance
                        if (!child.userData.materialCloned && child.material.clone) {
                            child.material = child.material.clone();
                            child.userData.materialCloned = true;
                        }
                        
                        if (child.material.linewidth !== undefined) {
                            child.material.linewidth = 3;
                        }
                        // Scale up the geometry for thicker appearance
                        if (!child.userData.scaled) {
                            if (child.isLine) {
                                child.scale.multiplyScalar(1.5);
                            }
                            child.userData.scaled = true;
                        }
                    }
                }
            });
        };

        updateAxisAppearance();

        // Disable the internal highlight behavior by overriding the gizmo's highlight method
        if (gizmo.highlight) {
            gizmo.highlight = () => {};
        }

        // Listen for axis changes (for currentAxis state tracking only)
        const handleAxisChanged = (event: any) => {
            if (pendingEdit) return;
            setCurrentAxis(event.value);
            invalidate();
        };

        controls.addEventListener('axis-changed', handleAxisChanged);

        return () => {
            controls.removeEventListener('axis-changed', handleAxisChanged);
            // Clear stored colors on cleanup
            axisColorsRef.current.clear();
        };
    }, [targetObject, transformMode, invalidate, pendingEdit]);

    // Handle transform change (live update during drag)
    const handleObjectChange = useCallback(() => {
        invalidate();
    }, [invalidate]);
    
    // Handle confirm - save to history
    const handleConfirm = useCallback(() => {
        if (!targetObject || !selection?.id || !onTransformEnd || !pendingEdit) return;
        
        // Apply the edited value (in case user modified in text field)
        const axis = pendingEdit.axis;
        if (pendingEdit.isRotate) {
            if (axis === 'X') targetObject.rotation.x = pendingEdit.value;
            else if (axis === 'Y') targetObject.rotation.y = pendingEdit.value;
            else if (axis === 'Z') targetObject.rotation.z = pendingEdit.value;
        } else {
            if (axis === 'X') targetObject.position.x = pendingEdit.value;
            else if (axis === 'Y') targetObject.position.y = pendingEdit.value;
            else if (axis === 'Z') targetObject.position.z = pendingEdit.value;
        }
        
        // Call onTransformEnd to save to history (use pooled euler)
        const pos = targetObject.position;
        _pooledEuler.setFromQuaternion(targetObject.quaternion, 'XYZ');
        
        onTransformEnd(
            selection.id,
            { x: pos.x, y: pos.y, z: pos.z },
            { r: _pooledEuler.x, p: _pooledEuler.y, y: _pooledEuler.z }
        );
        
        // Update original refs for next operation
        originalPositionRef.current.copy(targetObject.position);
        originalRotationRef.current.copy(targetObject.rotation);
        
        setPendingEdit(null);
        invalidate();
    }, [targetObject, selection?.id, onTransformEnd, pendingEdit, invalidate]);
    
    // Handle cancel - restore original transform
    const handleCancel = useCallback(() => {
        if (targetObject) {
            targetObject.position.copy(originalPositionRef.current);
            targetObject.rotation.copy(originalRotationRef.current);
        }
        setPendingEdit(null);
        invalidate();
    }, [targetObject, invalidate]);
    
    // Convert radians to degrees for display
    const radToDeg = (rad: number) => rad * (180 / Math.PI);
    const degToRad = (deg: number) => deg * (Math.PI / 180);
    
    // Get display value (degrees for rotation, meters for translation)
    const getDisplayValue = useCallback(() => {
        if (!pendingEdit) return '0';
        if (pendingEdit.isRotate) {
            return radToDeg(pendingEdit.value).toFixed(2);
        }
        return pendingEdit.value.toFixed(4);
    }, [pendingEdit]);
    
    // Get delta display value
    const getDeltaDisplay = useCallback(() => {
        if (!pendingEdit) return '0';
        const delta = pendingEdit.value - pendingEdit.startValue;
        if (pendingEdit.isRotate) {
            const degDelta = radToDeg(delta);
            return (degDelta >= 0 ? '+' : '') + degDelta.toFixed(2);
        }
        return (delta >= 0 ? '+' : '') + delta.toFixed(4);
    }, [pendingEdit]);
    
    // Handle value change in text field
    const handleValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const inputVal = parseFloat(e.target.value);
        if (!isNaN(inputVal) && pendingEdit) {
            // Convert degrees to radians for rotation
            const val = pendingEdit.isRotate ? degToRad(inputVal) : inputVal;
            setPendingEdit({ ...pendingEdit, value: val });
            
            // Live preview
            if (targetObject) {
                const axis = pendingEdit.axis;
                if (pendingEdit.isRotate) {
                    if (axis === 'X') targetObject.rotation.x = val;
                    else if (axis === 'Y') targetObject.rotation.y = val;
                    else if (axis === 'Z') targetObject.rotation.z = val;
                } else {
                    if (axis === 'X') targetObject.position.x = val;
                    else if (axis === 'Y') targetObject.position.y = val;
                    else if (axis === 'Z') targetObject.position.z = val;
                }
                invalidate();
            }
        }
    }, [pendingEdit, targetObject, invalidate]);
    
    // Handle Enter key to confirm
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleConfirm();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            handleCancel();
        }
    }, [handleConfirm, handleCancel]);
    
    if (!targetObject || transformMode === 'select') {
        return null;
    }
    
    // Get axis color
    const getAxisColor = (axis: string | null) => {
        if (axis === 'X') return '#ef4444';
        if (axis === 'Y') return '#22c55e';
        if (axis === 'Z') return '#3b82f6';
        return '#94a3b8';
    };
    
    // Determine the mode for TransformControls
    const getControlMode = () => {
        if (transformMode === 'translate') return 'translate';
        if (transformMode === 'rotate') return 'rotate';
        return 'translate';
    };
    
    return (
        <>
            {/* Main TransformControls - disabled when pending edit exists */}
            <TransformControls
                ref={transformRef}
                object={targetObject}
                mode={getControlMode()}
                size={0.8}
                enabled={!pendingEdit}
                onChange={handleObjectChange}
            />

            {/* For universal mode, add rotation gizmo */}
            {transformMode === 'universal' && (
                <TransformControls
                    object={targetObject}
                    mode="rotate"
                    size={1.2}
                    enabled={!pendingEdit}
                    onChange={handleObjectChange}
                />
            )}

            {/* Confirm/Cancel UI after drag ends - Fusion360 style */}
            {pendingEdit && (
                <Html
                    position={targetObject.position.toArray()}
                    style={{ pointerEvents: 'auto' }}
                    center
                    zIndexRange={[100, 0]}
                >
                    <div
                        className="flex flex-col items-center gap-1 transform -translate-y-16"
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                    >
                        {/* Compact input with axis indicator */}
                        <div className="flex items-center gap-1">
                            <span
                                className="w-5 h-5 rounded text-white text-xs font-bold flex items-center justify-center shadow"
                                style={{ backgroundColor: getAxisColor(pendingEdit.axis) }}
                            >
                                {pendingEdit.axis}
                            </span>
                            <input
                                type="number"
                                step={pendingEdit.isRotate ? "1" : "0.001"}
                                value={getDisplayValue()}
                                onChange={handleValueChange}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                className="w-20 px-1.5 py-0.5 text-xs font-mono bg-white/90 dark:bg-slate-800/90 border border-slate-300 dark:border-slate-600 rounded text-slate-800 dark:text-white focus:outline-none focus:border-blue-500 shadow"
                            />
                            <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                {pendingEdit.isRotate ? '°' : 'm'} ({getDeltaDisplay()})
                            </span>
                        </div>

                        {/* Compact confirm/cancel buttons */}
                        <div className="flex gap-1">
                            <button
                                onClick={handleConfirm}
                                className="w-6 h-6 bg-green-500 hover:bg-green-600 text-white rounded shadow flex items-center justify-center transition-colors"
                                title={t.confirmEnter}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </button>
                            <button
                                onClick={handleCancel}
                                className="w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded shadow flex items-center justify-center transition-colors"
                                title={t.cancelEsc}
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </Html>
            )}
        </>
    );
};
