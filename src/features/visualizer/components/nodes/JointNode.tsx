import React, { memo, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { UrdfJoint } from '@/types';
import { ThickerAxes, JointAxesVisual } from '@/shared/components/3d';
import { Language } from '@/shared/i18n';
import { RobotNode } from './RobotNode';

// Type definitions
interface CommonVisualizerProps {
  robot: any; // RobotState type
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: 'skeleton' | 'detail' | 'hardware';
  showGeometry: boolean;
  showVisual: boolean;
  selectionTarget?: 'visual' | 'collision';
  showLabels: boolean;
  showJointAxes: boolean;
  jointAxisSize: number;
  frameSize: number;
  labelScale: number;
  showSkeletonOrigin: boolean;
  showDetailOrigin: boolean;
  showDetailLabels: boolean;
  showCollision: boolean;
  showHardwareOrigin: boolean;
  showHardwareLabels: boolean;
  showInertia: boolean;
  showCenterOfMass: boolean;
  transformMode: 'translate' | 'rotate';
  assets: Record<string, string>;
  lang: Language;
  onRegisterJointPivot?: (jointId: string, pivot: THREE.Group | null) => void;
  onRegisterCollisionRef?: (linkId: string, ref: THREE.Group | null) => void;
}

interface JointNodeProps extends CommonVisualizerProps {
  joint: UrdfJoint;
  depth: number;
  key?: React.Key;
  onRegisterJointPivot?: (jointId: string, pivot: THREE.Group | null) => void;
}

/**
 * JointNode - Renders a joint in the robot hierarchy
 *
 * Features:
 * - Displays joint origin, axes, and labels
 * - Manages joint pivot for TransformControls
 * - Recursively renders child link via RobotNode
 * - Supports skeleton, detail, and hardware visualization modes
 */
export const JointNode = memo(function JointNode({
  joint,
  robot,
  onSelect,
  onUpdate,
  mode,
  showGeometry,
  showVisual,
  selectionTarget,
  showLabels,
  showJointAxes,
  jointAxisSize,
  frameSize,
  labelScale,
  showSkeletonOrigin,
  showDetailOrigin,
  showDetailLabels,
  showCollision,
  showHardwareOrigin,
  showHardwareLabels,
  showInertia,
  showCenterOfMass,
  transformMode,
  depth,
  assets,
  lang,
  onRegisterJointPivot,
  onRegisterCollisionRef
}: JointNodeProps & { onRegisterCollisionRef?: (linkId: string, ref: THREE.Group | null) => void }) {

  if (depth > 50) return null;

  const isSelected = robot.selection.type === 'joint' && robot.selection.id === joint.id;

  const { x, y, z } = joint.origin.xyz;
  const { r, p, y: yaw } = joint.origin.rpy;

  const showAxes = (mode === 'skeleton' && showSkeletonOrigin) || (mode === 'detail' && showDetailOrigin) || (mode === 'hardware' && showHardwareOrigin);
  const showJointLabel = (mode === 'skeleton' && showLabels) || (mode === 'hardware' && showHardwareLabels);

  // Joint pivot: represents joint origin in parent-local space
  // TransformControls attaches to this, modifying its position in parent-local frame
  const [jointPivot, setJointPivot] = useState<THREE.Group | null>(null);
  // Joint group: contains visualization, positioned at [0,0,0] relative to pivot
  const [jointGroup, setJointGroup] = useState<THREE.Group | null>(null);

  // Register pivot with parent Visualizer component
  useEffect(() => {
    if (onRegisterJointPivot && isSelected) {
      onRegisterJointPivot(joint.id, jointPivot);
    }
    return () => {
      if (onRegisterJointPivot) {
        onRegisterJointPivot(joint.id, null);
      }
    };
  }, [jointPivot, joint.id, isSelected, onRegisterJointPivot]);

  return (
    <group>
      {mode === 'skeleton' && showGeometry && (
        <>
          {/* Only render line if distance is significant (> 0.001m) to avoid rendering glitches */}
          {(Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001) && (
            <Line
              points={[[0, 0, 0], [x, y, z]]}
              color={isSelected ? "#fbbf24" : "#94a3b8"}
              lineWidth={1}
              dashed
              dashSize={0.02}
              gapSize={0.01}
            />
          )}
        </>
      )}

        {/* Joint pivot: represents joint origin in parent-local space */}
        {/* TransformControls attaches here, modifies position in parent-local frame */}
        <group
            ref={setJointPivot}
            position={[x, y, z]}
            rotation={[r, p, yaw]}
        >
            {/* Joint group: at origin relative to pivot, contains visualization and child link */}
            <group
                ref={setJointGroup}
                position={[0, 0, 0]}
                rotation={[0, 0, 0]}
            >
                {showAxes && (
                    <ThickerAxes
                        size={frameSize}
                        onClick={(mode === 'skeleton' || mode === 'hardware') ? (e) => {
                            e.stopPropagation();
                            onSelect('joint', joint.id);
                        } : undefined}
                    />
                )}

          {(mode === 'skeleton' || mode === 'hardware') && (
            <group>
              {showJointLabel && (
                <Html position={[0.25, 0, 0]} className="pointer-events-none">
                  <div
                    style={{ transform: `scale(${labelScale})`, transformOrigin: 'left center' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect('joint', joint.id);
                    }}
                    className={`
                                        px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap shadow-xl
                                        pointer-events-auto cursor-pointer select-none transition-colors
                                        ${isSelected
                        ? 'bg-blue-600 text-white border-blue-400 z-50'
                        : 'bg-white/90 dark:bg-[#1C1C1E] text-orange-700 dark:text-orange-200 border-orange-200 dark:border-[#000000] hover:bg-orange-50 dark:hover:bg-[#3A3A3C]'
                      }
                                    `}
                  >
                    {joint.name}
                  </div>
                </Html>
              )}
              {mode === 'skeleton' && showJointAxes && joint.type !== 'fixed' && <JointAxesVisual joint={joint} scale={jointAxisSize / 0.35} />}
            </group>
          )}

          {mode !== 'skeleton' && (
            <mesh onClick={(e: any) => { e.stopPropagation(); onSelect('joint', joint.id); }}>
              <sphereGeometry args={[0.02, 16, 16]} />
              <meshBasicMaterial color={isSelected ? "orange" : "white"} opacity={isSelected ? 1 : 0} transparent />
            </mesh>
          )}

          <RobotNode
            linkId={joint.childLinkId}
            robot={robot}
            onSelect={onSelect}
            onUpdate={onUpdate}
            mode={mode}
            showGeometry={showGeometry}
            showVisual={showVisual}
            showLabels={showLabels}
            showJointAxes={showJointAxes}
            jointAxisSize={jointAxisSize}
            frameSize={frameSize}
            labelScale={labelScale}
            showSkeletonOrigin={showSkeletonOrigin}
            showDetailOrigin={showDetailOrigin}
            showDetailLabels={showDetailLabels}
            showCollision={showCollision}
            showHardwareOrigin={showHardwareOrigin}
            showHardwareLabels={showHardwareLabels}
            showInertia={showInertia}
            showCenterOfMass={showCenterOfMass}
            transformMode={transformMode}
            depth={depth + 1}
            assets={assets}
            lang={lang}
            onRegisterJointPivot={onRegisterJointPivot}
            onRegisterCollisionRef={onRegisterCollisionRef}
          />
        </group>
      </group>
    </group>
  );
});
