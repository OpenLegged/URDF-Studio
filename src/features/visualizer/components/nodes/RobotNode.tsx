import React, { memo, useState, useEffect } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { RobotState } from '@/types';
import { ThickerAxes, InertiaBox, LinkCenterOfMass } from '@/shared/components/3d';
import { Language } from '@/shared/i18n';
import { GeometryRenderer } from './GeometryRenderer';
import { JointNode } from './JointNode';

// Type definitions
interface CommonVisualizerProps {
  robot: RobotState;
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

interface RobotNodeProps extends CommonVisualizerProps {
  linkId: string;
  depth: number;
  onRegisterJointPivot?: (jointId: string, pivot: THREE.Group | null) => void;
  onRegisterCollisionRef?: (linkId: string, ref: THREE.Group | null) => void;
}

/**
 * RobotNode - Renders a link in the robot hierarchy
 *
 * Features:
 * - Renders visual and collision geometry using GeometryRenderer
 * - Manages link selection and hover states
 * - Displays inertia and center of mass visualization
 * - Recursively renders child joints via JointNode
 * - Supports skeleton, detail, and hardware visualization modes
 */
export const RobotNode = memo(function RobotNode({
  linkId,
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
}: RobotNodeProps) {

  if (depth > 50) return null;

  const link = robot.links[linkId];
  if (!link) return null;

  const handleLinkClick = (e: any, subType?: 'visual' | 'collision') => {
    e.stopPropagation();

    // Override subType if selectionTarget is set (global override)
    // Otherwise use the clicked subType (granular selection)
    const targetSubType = selectionTarget || subType;

    onSelect('link', linkId, targetSubType);
  };

  const childJoints = Object.values(robot.joints).filter(j => j.parentLinkId === linkId);
  const isSelected = robot.selection.type === 'link' && robot.selection.id === linkId;
  const selectionSubType = robot.selection.subType;
  const isRoot = linkId === robot.rootLinkId;

  // Refs for dragging geometry in Detail mode
  const [visualRef, setVisualRef] = useState<THREE.Group | null>(null);
  const [collisionRef, setCollisionRef] = useState<THREE.Group | null>(null);

  // Register collision ref with parent when selected
  const isCollisionSelected = isSelected && selectionSubType === 'collision';
  useEffect(() => {
    if (onRegisterCollisionRef && isCollisionSelected) {
      onRegisterCollisionRef(linkId, collisionRef);
    }
    return () => {
      if (onRegisterCollisionRef && isCollisionSelected) {
        onRegisterCollisionRef(linkId, null);
      }
    };
  }, [collisionRef, linkId, isCollisionSelected, onRegisterCollisionRef]);

  // Dragging logic for Detail Mode
  const activeGeometryRef = showCollision ? collisionRef : visualRef;
  const geometryTargetType = showCollision ? 'collision' : 'visual';

  const handleGeometryTransformEnd = () => {
    if (activeGeometryRef) {
      const pos = activeGeometryRef.position;
      const rot = activeGeometryRef.rotation;

      const currentData = geometryTargetType === 'collision' ? link.collision : link.visual;
      const newData = {
        ...currentData,
        origin: {
          xyz: { x: pos.x, y: pos.y, z: pos.z },
          rpy: { r: rot.x, p: rot.y, y: rot.z }
        }
      };

      onUpdate('link', linkId, {
        ...link,
        [geometryTargetType]: newData
      });
    }
  };

  const showRootAxes = isRoot && ((mode === 'skeleton' && showSkeletonOrigin) || (mode === 'detail' && showDetailOrigin) || (mode === 'hardware' && showHardwareOrigin));
  const shouldRenderGeometry = !(mode === 'skeleton' && !showGeometry && !showCollision);
  const showLinkLabel = (mode === 'detail' && showDetailLabels) || (mode === 'hardware' && showHardwareLabels);
  const showRootLabel = isRoot && ((mode === 'skeleton' && showLabels) || (mode === 'hardware' && showHardwareLabels));

  return (
    <group>
      {showRootAxes && (
        <group>
            <ThickerAxes size={frameSize} />
            {showRootLabel && (
                <Html position={[0.35, 0, 0]} className="pointer-events-none">
                    <div
                        style={{ transform: `scale(${labelScale})`, transformOrigin: 'left center' }}
                        onClick={handleLinkClick}
                        className={`
                            px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap shadow-xl
                            pointer-events-auto cursor-pointer select-none transition-colors
                            ${isSelected
                    ? 'bg-blue-600 text-white border-blue-400 z-50'
                    : 'bg-white dark:bg-[#151515] text-slate-800 dark:text-slate-200 border-slate-300 dark:border-[#000000] hover:bg-slate-100 dark:hover:bg-[#2C2C2E]'
                  }
                        `}
              >
                {link.name} (Base)
              </div>
            </Html>
          )}
        </group>
      )}

      {shouldRenderGeometry && (
        <>
          {/* Visual Geometry */}
          <GeometryRenderer
            isCollision={false}
            link={link}
            mode={mode}
            showGeometry={showGeometry}
            showCollision={showCollision}
            assets={assets}
            isSelected={isSelected}
            selectionSubType={selectionSubType}
            onLinkClick={handleLinkClick}
            setVisualRef={setVisualRef}
          />

          {/* Collision Geometry */}
          <GeometryRenderer
            isCollision={true}
            link={link}
            mode={mode}
            showGeometry={showGeometry}
            showCollision={showCollision}
            assets={assets}
            isSelected={isSelected}
            selectionSubType={selectionSubType}
            onLinkClick={handleLinkClick}
            setCollisionRef={setCollisionRef}
          />
        </>
      )}

      {/* Inertia Visualization */}
      {showInertia && <InertiaBox link={link} />}

      {/* Center of Mass Indicator */}
      {showCenterOfMass && <LinkCenterOfMass link={link} />}

      {/* Transform Controls for Link Geometry in Detail Mode - Disabled to prioritize Joint Controls
      {isSelected && mode === 'detail' && activeGeometryRef && (
          <TransformControls
              object={activeGeometryRef}
              mode={transformMode}
              space="local"
              size={1.3}
              onMouseUp={handleGeometryTransformEnd}
              depthTest={false}
          />
      )}
      */}

      {showLinkLabel && (
        <Html position={[0, 0, 0]} className="pointer-events-none" zIndexRange={[100, 0]}>
          <div
            style={{ transform: `scale(${labelScale})`, transformOrigin: 'center center' }}
            onClick={handleLinkClick}
            className={`
                    px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap shadow-xl
                    pointer-events-auto cursor-pointer select-none transition-colors opacity-90 hover:opacity-100
                    ${isSelected
                ? 'bg-blue-600 text-white border-blue-400 z-50'
                : 'bg-white dark:bg-[#151515] text-blue-700 dark:text-blue-200 border-slate-300 dark:border-[#000000] hover:bg-slate-100 dark:hover:bg-[#2C2C2E]'
              }
                `}
          >
            {link.name}
          </div>
        </Html>
      )}

      {childJoints.map(joint => (
        <JointNode
          key={joint.id}
          joint={joint}
          robot={robot}
          onSelect={onSelect}
          onUpdate={onUpdate}
          mode={mode}
          showGeometry={showGeometry}
          showVisual={showVisual}
          selectionTarget={selectionTarget}
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
      ))}
    </group>
  );
});
