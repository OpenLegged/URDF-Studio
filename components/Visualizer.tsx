import React, { Suspense, useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport, Html, Line, TransformControls } from '@react-three/drei';
import { RobotState, GeometryType, UrdfJoint, JointType, Theme } from '../types';
import * as THREE from 'three';
import { translations, Language } from '../services/i18n';

import { RotateCcw, Move, ArrowUpRight } from 'lucide-react';
import {
  CheckboxOption,
  SliderOption,
  ToggleButtonGroup,
  OptionsPanelHeader,
  OptionsPanelContent,
  OptionsPanelContainer
} from './ui/OptionsPanel';
import {
  STLRenderer,
  OBJRenderer,
  DAERenderer,
  useLoadingManager,
  SnapshotManager,
  SceneLighting,
  ThickerAxes,
  JointAxesVisual,
  InertiaBox,
  LinkCenterOfMass
} from './shared';


// Fix for missing JSX types in strict environments or when global types are not picked up
// Augmenting both global and React module JSX namespaces to ensure compatibility
declare global {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      primitive: any;
      arrowHelper: any;
      axesHelper: any;
      torusGeometry: any;
      coneGeometry: any;
      sphereGeometry: any;
      boxGeometry: any;
      cylinderGeometry: any;
      meshBasicMaterial: any;
      meshStandardMaterial: any;
    }
  }
}

// ============================================================
// MATERIAL CACHE - Prevents shader recompilation on every render
// ============================================================
const materialCache = new Map<string, THREE.Material>();

function getCachedMaterial(
  key: string,
  isSkeleton: boolean,
  finalColor: string,
  matOpacity: number,
  matWireframe: boolean,
  isCollision: boolean,
  emissiveColor: string,
  emissiveIntensity: number
): THREE.Material {
  // Generate a unique cache key based on all material properties
  const cacheKey = `${key}-${isSkeleton}-${finalColor}-${matOpacity}-${matWireframe}-${isCollision}-${emissiveColor}-${emissiveIntensity}`;

  let material = materialCache.get(cacheKey);
  if (!material) {
    if (isSkeleton) {
      material = new THREE.MeshBasicMaterial({
        color: finalColor,
        transparent: true,
        opacity: matOpacity,
        wireframe: matWireframe,
        side: isCollision ? THREE.FrontSide : THREE.DoubleSide,
        polygonOffset: isCollision,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
    } else {
      material = new THREE.MeshPhysicalMaterial({
        color: finalColor,
        roughness: 0.15,
        metalness: 0.3,
        clearcoat: 0.3,
        clearcoatRoughness: 0.1,
        reflectivity: 0.8,
        emissive: emissiveColor,
        emissiveIntensity: emissiveIntensity,
        transparent: isCollision,
        opacity: matOpacity,
        wireframe: matWireframe,
        side: isCollision ? THREE.FrontSide : THREE.DoubleSide,
        polygonOffset: isCollision,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
      });
    }
    materialCache.set(cacheKey, material);
  }
  return material;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      group: any;
      mesh: any;
      primitive: any;
      arrowHelper: any;
      axesHelper: any;
      torusGeometry: any;
      coneGeometry: any;
      sphereGeometry: any;
      boxGeometry: any;
      cylinderGeometry: any;
      meshBasicMaterial: any;
      meshStandardMaterial: any;
    }
  }
}

interface CommonVisualizerProps {
  robot: RobotState;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: 'skeleton' | 'detail' | 'hardware';
  showGeometry: boolean; // For Skeleton mode
  showVisual: boolean;   // For Detail mode
  selectionTarget?: 'visual' | 'collision'; // For Detail mode selection override
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

interface RobotNodeProps extends CommonVisualizerProps {
  linkId: string;
  depth: number;
  onRegisterJointPivot?: (jointId: string, pivot: THREE.Group | null) => void;
  onRegisterCollisionRef?: (linkId: string, ref: THREE.Group | null) => void;
}

const JointNode = memo(function JointNode({
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
                        size={frameSize * 0.12}
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
                        : 'bg-white/90 dark:bg-slate-900/90 text-orange-700 dark:text-orange-200 border-orange-200 dark:border-orange-900/50 hover:bg-orange-50 dark:hover:bg-slate-800'
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

const RobotNode = memo(function RobotNode({
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

  // Hover State for highlighting before selection
  const [hoveredType, setHoveredType] = useState<'visual' | 'collision' | null>(null);

  // Render Visual or Collision Geometry
  const renderGeometry = (isCollision: boolean) => {
    const data = isCollision ? link.collision : link.visual;
    // Fallback if collision data doesn't exist yet (for older state compatibility)
    if (isCollision && !data) return null;

    if (mode === 'skeleton' && !showGeometry && !isCollision) return null;

    if (mode === 'detail') {
      if (isCollision && !showCollision) return null;
      if (!isCollision && (link.visible === false)) return null;
    } else {
      if (isCollision && !showCollision) return null;
      if (isCollision) return null;
    }

    const { type, dimensions, color, origin, meshPath } = data;

    // IF TYPE IS NONE, RENDER NOTHING
    if (type === GeometryType.NONE) return null;

    // Create a unique key based on geometry properties to force re-render when they change
    const geometryKey = `${isCollision ? 'col' : 'vis'}-${type}-${dimensions.x}-${dimensions.y}-${dimensions.z}-${meshPath || 'none'}`;

    const isSkeleton = mode === 'skeleton';

    // Interaction States
    const isHovered = hoveredType === (isCollision ? 'collision' : 'visual');
    const isVisualHighlight = !isCollision && isSelected && (selectionSubType === 'visual' || !selectionSubType);
    const isCollisionHighlight = isCollision && isSelected && selectionSubType === 'collision';

    // Collision styling - Purple wireframe default
    const colColor = '#a855f7'; // Purple-500

    // Opacity: Higher if selected or hovered
    const matOpacity = isCollision ? ((isCollisionHighlight || isHovered) ? 0.6 : 0.3) : (isSkeleton ? 0.2 : 1.0);
    // Wireframe: Fill if selected or hovered (for collision)
    const matWireframe = isCollision ? (!isCollisionHighlight && !isHovered) : isSkeleton;

    const baseColor = isCollision ? colColor : color;

    // Colors
    const selectionColorVisual = '#60a5fa'; // Blue-400
    const selectionColorCollision = '#d946ef'; // Fuchsia-500
    const hoverColorVisual = '#93c5fd'; // Blue-300 (Lighter)
    const hoverColorCollision = '#e879f9'; // Fuchsia-400 (Lighter)

    let finalColor = baseColor;
    if (isVisualHighlight) finalColor = selectionColorVisual;
    else if (isCollisionHighlight) finalColor = selectionColorCollision;
    else if (isHovered) finalColor = isCollision ? hoverColorCollision : hoverColorVisual; // Hover color

    // Emissive Logic
    let emissiveColor = '#000000';
    let emissiveIntensity = 0;

    if (isVisualHighlight) {
      emissiveColor = '#1e40af';
      emissiveIntensity = 0.5;
    } else if (isCollisionHighlight) {
      emissiveColor = '#86198f';
      emissiveIntensity = 0.5;
    } else if (isHovered) {
      emissiveColor = isCollision ? '#d946ef' : '#3b82f6';
      emissiveIntensity = 0.3; // Mild glow on hover
    }

    // Use cached material to avoid shader recompilation
    const material = getCachedMaterial(
      geometryKey,
      isSkeleton,
      finalColor,
      matOpacity,
      matWireframe,
      isCollision,
      emissiveColor,
      emissiveIntensity
    );

    // Use array format for position/rotation to avoid creating new objects
    const wrapperProps = {
      onClick: (e: any) => { handleLinkClick(e, isCollision ? 'collision' : 'visual'); },
      onPointerOver: (e: any) => {
        e.stopPropagation();
        setHoveredType(isCollision ? 'collision' : 'visual');
      },
      onPointerOut: (e: any) => {
        e.stopPropagation();
        setHoveredType(null);
      },
      // Use array format instead of new THREE.Vector3/Euler to avoid object creation
      position: origin ? [origin.xyz.x, origin.xyz.y, origin.xyz.z] as [number, number, number] : undefined,
      rotation: origin ? [origin.rpy.r, origin.rpy.p, origin.rpy.y] as [number, number, number] : undefined,
      ref: isCollision ? setCollisionRef : setVisualRef
    };

    let geometryNode;
    const radialSegments = isSkeleton ? 8 : 32;
    const boxSegments = isSkeleton ? 1 : 2;
    // For cylinder, we need to rotate to align with Z-up
    // This rotation is applied to the mesh itself, separate from origin rotation
    let meshRotation: [number, number, number] = [0, 0, 0];

    if (type === GeometryType.BOX) {
      // Box dimensions: x=width (along X), y=depth (along Y), z=height (along Z)
      geometryNode = (
        <mesh>
          <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z, boxSegments, boxSegments, boxSegments]} />
          <primitive object={material} attach="material" />
        </mesh>
      );
    } else if (type === GeometryType.CYLINDER) {
      // Three.js CylinderGeometry is Y-axis aligned by default (extends along +Y)
      // Our scene uses Z-up coordinate system
      // To align cylinder along +Z: rotate -90 degrees around X axis
      // This transforms: +Y -> +Z
      meshRotation = [-Math.PI / 2, 0, 0];
      // args: [radiusTop, radiusBottom, height, radialSegments]
      // dimensions.x = radius, dimensions.y = height/length
      geometryNode = (
        <mesh rotation={meshRotation}>
          <cylinderGeometry args={[dimensions.x, dimensions.x, dimensions.y, radialSegments, 1]} />
          <primitive object={material} attach="material" />
        </mesh>
      );
    } else if (type === GeometryType.SPHERE) {
      geometryNode = (
        <mesh>
          <sphereGeometry args={[dimensions.x, radialSegments, radialSegments]} />
          <primitive object={material} attach="material" />
        </mesh>
      );
    } else if (type === GeometryType.MESH) {
      let assetUrl = meshPath ? assets[meshPath] : undefined;

      // Case insensitive fallback lookup
      if (!assetUrl && meshPath) {
        const lowerPath = meshPath.toLowerCase();
        const foundKey = Object.keys(assets).find(k => k.toLowerCase() === lowerPath);
        if (foundKey) assetUrl = assets[foundKey];
      }

      if (meshPath && assetUrl) {
        const url = assetUrl;
        const ext = meshPath.split('.').pop()?.toLowerCase();

        if (ext === 'stl') {
          geometryNode = <STLRenderer url={url} material={material} scale={dimensions} />;
        } else if (ext === 'obj') {
          geometryNode = <OBJRenderer url={url} material={material} color={finalColor} assets={assets} scale={dimensions} />;
        } else if (ext === 'dae') {
          geometryNode = <DAERenderer url={url} material={material} assets={assets} scale={dimensions} />;
        } else {
          // Fallback for unknown extension
          geometryNode = <mesh geometry={new THREE.BoxGeometry(0.1, 0.1, 0.1)} material={material} />;
        }
      } else {
        // Placeholder if no mesh loaded
        geometryNode = (
          <mesh>
            <boxGeometry args={[0.1, 0.1, 0.1]} />
            <meshStandardMaterial color={isCollision ? "red" : "gray"} wireframe />
          </mesh>
        );
      }
    }

    return (
      <group key={geometryKey} {...wrapperProps}>
        {geometryNode}
      </group>
    );
  };

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
            <ThickerAxes size={frameSize * 0.12} />
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
                    : 'bg-white/90 dark:bg-slate-900/90 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
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
          {renderGeometry(false)}
          {/* Collision Geometry */}
          {renderGeometry(true)}
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
                    px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap shadow-xl backdrop-blur-sm
                    pointer-events-auto cursor-pointer select-none transition-colors opacity-90 hover:opacity-100
                    ${isSelected
                ? 'bg-blue-600/90 text-white border-blue-400 z-50'
                : 'bg-white/80 dark:bg-slate-800/80 text-blue-700 dark:text-blue-200 border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700'
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

export const Visualizer = ({ robot, onSelect, onUpdate, mode, assets, lang, theme, os, showVisual: propShowVisual, setShowVisual: propSetShowVisual, snapshotAction, showOptionsPanel = true, setShowOptionsPanel }: { robot: RobotState; onSelect: any; onUpdate: any; mode: 'skeleton' | 'detail' | 'hardware', assets: Record<string, string>, lang: Language, theme: Theme, os?: 'mac' | 'win', showVisual?: boolean, setShowVisual?: (show: boolean) => void, snapshotAction?: React.MutableRefObject<(() => void) | null>, showOptionsPanel?: boolean, setShowOptionsPanel?: (show: boolean) => void }) => {
  const t = translations[lang];

  // Skeleton Settings
  const [showGeometry, setShowGeometry] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showJointAxes, setShowJointAxes] = useState(false);
  const [showSkeletonOrigin, setShowSkeletonOrigin] = useState(true);
  const [jointAxisSize, setJointAxisSize] = useState(0.35);
  const [frameSize, setFrameSize] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('urdf_viewer_origin_size');
      return saved ? Math.min(parseFloat(saved), 0.8) : 0.15;
    }
    return 0.15;
  });

  // Save frameSize to localStorage to sync with detail mode
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('urdf_viewer_origin_size', frameSize.toString());
    }
  }, [frameSize]);
  const [labelScale, setLabelScale] = useState(1.0);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');

  // Detail Settings
  const [showDetailOrigin, setShowDetailOrigin] = useState(false);
  const [showDetailLabels, setShowDetailLabels] = useState(false);
  const [showCollision, setShowCollision] = useState(false);

  // Handle showVisual (controlled or uncontrolled)
  const [localShowVisual, setLocalShowVisual] = useState(true);
  const showVisual = propShowVisual !== undefined ? propShowVisual : localShowVisual;
  const setShowVisual = propSetShowVisual || setLocalShowVisual;

  // Hardware Settings
  const [showHardwareOrigin, setShowHardwareOrigin] = useState(false);
  const [showHardwareLabels, setShowHardwareLabels] = useState(false);

  // Inertia and Center of Mass Settings
  const [showInertia, setShowInertia] = useState(false);
  const [showCenterOfMass, setShowCenterOfMass] = useState(false);

  // Joint pivot refs for TransformControls at root level
  const [jointPivots, setJointPivots] = useState<Record<string, THREE.Group | null>>({});

  // Memoized callback to avoid triggering re-renders when value hasn't changed
  const handleRegisterJointPivot = useCallback((jointId: string, pivot: THREE.Group | null) => {
    setJointPivots(prev => {
      if (prev[jointId] === pivot) return prev; // No change, return same object
      return { ...prev, [jointId]: pivot };
    });
  }, []);

  const selectedJointPivot = robot.selection.type === 'joint' && robot.selection.id
    ? jointPivots[robot.selection.id]
    : null;

  // Collision geometry refs for TransformControls at root level
  const [collisionRefs, setCollisionRefs] = useState<Record<string, THREE.Group | null>>({});

  const handleRegisterCollisionRef = (linkId: string, ref: THREE.Group | null) => {
    setCollisionRefs(prev => ({ ...prev, [linkId]: ref }));
  };

  const selectedCollisionRef = robot.selection.type === 'link' && robot.selection.id && robot.selection.subType === 'collision'
    ? collisionRefs[robot.selection.id]
    : null;

  // Transform Controls state - using same pattern as CollisionTransformControls
  const transformControlRef = useRef<any>(null);
  const [pendingEdit, setPendingEdit] = useState<{
    axis: string;
    value: number;
    startValue: number;
    isRotate: boolean;
  } | null>(null);

  const originalPositionRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const originalRotationRef = useRef<THREE.Euler>(new THREE.Euler());
  const isDraggingControlRef = useRef(false);
  const currentAxisRef = useRef<string | null>(null);
  const startValueRef = useRef<number>(0);
  const [currentAxis, setCurrentAxis] = useState<string | null>(null);
  const [isDraggingAxis, setIsDraggingAxis] = useState(false);

  // Clear pending edit when selection changes
  useEffect(() => {
    // When selection changes, cancel any pending edit by restoring original transform
    if (pendingEdit && selectedJointPivot) {
      selectedJointPivot.position.copy(originalPositionRef.current);
      selectedJointPivot.rotation.copy(originalRotationRef.current);
    }
    setPendingEdit(null);
  }, [robot.selection.id, robot.selection.type]);

  // Clear pending edit and restore when component unmounts or selection changes
  useEffect(() => {
    return () => {
      // Cleanup: if component unmounts with pending edit, restore original transform
      if (pendingEdit && selectedJointPivot) {
        selectedJointPivot.position.copy(originalPositionRef.current);
        selectedJointPivot.rotation.copy(originalRotationRef.current);
      }
    };
  }, [pendingEdit, selectedJointPivot]);

  // Update original refs when target object changes
  useEffect(() => {
    if (selectedJointPivot) {
      originalPositionRef.current.copy(selectedJointPivot.position);
      originalRotationRef.current.copy(selectedJointPivot.rotation);
    }
  }, [selectedJointPivot]);

  // Helper functions for transform controls - matching CollisionTransformControls pattern
  const radToDeg = (rad: number) => rad * (180 / Math.PI);
  const degToRad = (deg: number) => deg * (Math.PI / 180);

  const getDisplayValue = useCallback(() => {
    if (!pendingEdit) return '0';
    if (pendingEdit.isRotate) {
      return radToDeg(pendingEdit.value).toFixed(2);
    }
    return pendingEdit.value.toFixed(4);
  }, [pendingEdit]);

  const getDeltaDisplay = useCallback(() => {
    if (!pendingEdit) return '0';
    const delta = pendingEdit.value - pendingEdit.startValue;
    if (pendingEdit.isRotate) {
      const degDelta = radToDeg(delta);
      return (degDelta >= 0 ? '+' : '') + degDelta.toFixed(2);
    }
    return (delta >= 0 ? '+' : '') + delta.toFixed(4);
  }, [pendingEdit]);

  const handleValueChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const inputVal = parseFloat(e.target.value);
    if (!isNaN(inputVal) && pendingEdit && selectedJointPivot) {
      const val = pendingEdit.isRotate ? degToRad(inputVal) : inputVal;
      setPendingEdit({ ...pendingEdit, value: val });

      // Live preview
      const axis = pendingEdit.axis;
      if (pendingEdit.isRotate) {
        if (axis === 'X') selectedJointPivot.rotation.x = val;
        else if (axis === 'Y') selectedJointPivot.rotation.y = val;
        else if (axis === 'Z') selectedJointPivot.rotation.z = val;
      } else {
        if (axis === 'X') selectedJointPivot.position.x = val;
        else if (axis === 'Y') selectedJointPivot.position.y = val;
        else if (axis === 'Z') selectedJointPivot.position.z = val;
      }
    }
  }, [pendingEdit, selectedJointPivot]);

  const handleConfirm = useCallback(() => {
    if (!selectedJointPivot || !robot.selection.id || !pendingEdit) return;

    const jointId = robot.selection.id;
    const joint = robot.joints[jointId];
    if (!joint) return;

    // Apply the edited value
    const axis = pendingEdit.axis;
    if (pendingEdit.isRotate) {
      if (axis === 'X') selectedJointPivot.rotation.x = pendingEdit.value;
      else if (axis === 'Y') selectedJointPivot.rotation.y = pendingEdit.value;
      else if (axis === 'Z') selectedJointPivot.rotation.z = pendingEdit.value;
    } else {
      if (axis === 'X') selectedJointPivot.position.x = pendingEdit.value;
      else if (axis === 'Y') selectedJointPivot.position.y = pendingEdit.value;
      else if (axis === 'Z') selectedJointPivot.position.z = pendingEdit.value;
    }

    // Save to state
    const pos = selectedJointPivot.position;
    const rot = selectedJointPivot.rotation;
    onUpdate('joint', jointId, {
      ...joint,
      origin: {
        xyz: { x: pos.x, y: pos.y, z: pos.z },
        rpy: { r: rot.x, p: rot.y, y: rot.z }
      }
    });

    // Update original refs
    originalPositionRef.current.copy(selectedJointPivot.position);
    originalRotationRef.current.copy(selectedJointPivot.rotation);

    setPendingEdit(null);
  }, [selectedJointPivot, robot.selection.id, robot.joints, pendingEdit, onUpdate]);

  const handleCancel = useCallback(() => {
    if (selectedJointPivot) {
      selectedJointPivot.position.copy(originalPositionRef.current);
      selectedJointPivot.rotation.copy(originalRotationRef.current);
    }
    setPendingEdit(null);
  }, [selectedJointPivot]);

  // Handle object change during drag for live preview
  const handleObjectChange = useCallback(() => {
    // Trigger re-render during drag for visual feedback
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  }, [handleConfirm, handleCancel]);

  const getAxisColor = (axis: string | null) => {
    if (axis === 'X') return '#ef4444';
    if (axis === 'Y') return '#22c55e';
    if (axis === 'Z') return '#3b82f6';
    return '#94a3b8';
  };

  // Update axis opacity based on active axis and dragging state
  const updateAxisOpacity = useCallback((gizmo: any, axis: string | null, isDragging: boolean) => {
    gizmo.traverse((child: any) => {
      if (child.material && child.material.color) {
        // Check axis by material color (R=X, G=Y, B=Z)
        const color = child.material.color;
        const isXAxis = color.r > 0.5 && color.g < 0.4 && color.b < 0.4;
        const isYAxis = color.g > 0.5 && color.r < 0.4 && color.b < 0.4;
        const isZAxis = color.b > 0.5 && color.r < 0.4 && color.g < 0.4;

        const isActiveAxis = !axis ||
          (axis === 'X' && isXAxis) ||
          (axis === 'Y' && isYAxis) ||
          (axis === 'Z' && isZAxis);

        // When dragging: active axis stays full opacity, others become very transparent
        // When hovering: active axis stays full opacity, others become slightly transparent
        if (axis && !isActiveAxis) {
          child.material.opacity = isDragging ? 0.15 : 0.3;
          child.material.transparent = true;
        } else {
          child.material.opacity = 1.0;
          child.material.transparent = false;
        }
        child.material.needsUpdate = true;
      }
    });
  }, []);

  // Setup event listeners for TransformControls - matching CollisionTransformControls
  useEffect(() => {
    const controls = transformControlRef.current;
    if (!controls || !selectedJointPivot || mode !== 'skeleton') return;

    const handleDraggingChange = (event: any) => {
      const dragging = event.value;

      if (dragging) {
        // Start dragging
        isDraggingControlRef.current = true;
        setIsDraggingAxis(true);
        originalPositionRef.current.copy(selectedJointPivot.position);
        originalRotationRef.current.copy(selectedJointPivot.rotation);

        // Get current axis
        const axis = controls.axis;
        currentAxisRef.current = axis;

        // Update axis opacity for dragging state
        const gizmo = (controls as any).children?.[0];
        if (gizmo && axis) {
          updateAxisOpacity(gizmo, axis, true);
        }

        const isRotate = transformMode === 'rotate';
        let startValue = 0;

        if (isRotate) {
          startValue = axis === 'X' ? selectedJointPivot.rotation.x :
            axis === 'Y' ? selectedJointPivot.rotation.y :
              axis === 'Z' ? selectedJointPivot.rotation.z : 0;
        } else {
          startValue = axis === 'X' ? selectedJointPivot.position.x :
            axis === 'Y' ? selectedJointPivot.position.y :
              axis === 'Z' ? selectedJointPivot.position.z : 0;
        }

        // Store start value for later comparison
        startValueRef.current = startValue;
      } else if (isDraggingControlRef.current) {
        // End dragging
        isDraggingControlRef.current = false;
        setIsDraggingAxis(false);

        const axis = currentAxisRef.current;

        // Reset axis opacity to hover state
        const gizmo = (controls as any).children?.[0];
        if (gizmo && axis) {
          updateAxisOpacity(gizmo, axis, false);
        }

        const isRotate = transformMode === 'rotate';
        let currentVal = 0;

        if (isRotate) {
          currentVal = axis === 'X' ? selectedJointPivot.rotation.x :
            axis === 'Y' ? selectedJointPivot.rotation.y :
              axis === 'Z' ? selectedJointPivot.rotation.z : 0;
        } else {
          currentVal = axis === 'X' ? selectedJointPivot.position.x :
            axis === 'Y' ? selectedJointPivot.position.y :
              axis === 'Z' ? selectedJointPivot.position.z : 0;
        }

        const delta = currentVal - startValueRef.current;

        // Show confirm UI if value changed
        if (Math.abs(delta) > 0.0001 && axis) {
          setPendingEdit({
            axis,
            value: currentVal,
            startValue: startValueRef.current,
            isRotate
          });
        }
      }
    };

    controls.addEventListener('dragging-changed', handleDraggingChange);

    return () => {
      controls.removeEventListener('dragging-changed', handleDraggingChange);
    };
  }, [selectedJointPivot, transformMode, mode, updateAxisOpacity]);

  // Customize TransformControls appearance
  useEffect(() => {
    const controls = transformControlRef.current;
    if (!controls || mode !== 'skeleton') return;

    const gizmo = (controls as any).children?.[0];
    if (!gizmo) return;

    // Make axes thicker
    const updateAxisAppearance = () => {
      gizmo.traverse((child: any) => {
        if (child.isMesh || child.isLine) {
          if (child.material) {
            if (child.material.linewidth !== undefined) {
              child.material.linewidth = 3;
            }
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

    // Listen for axis changes
    const handleAxisChanged = (event: any) => {
      if (pendingEdit) return;

      const axis = event.value;
      setCurrentAxis(axis);

      // Update opacity based on current axis and dragging state
      updateAxisOpacity(gizmo, axis, isDraggingAxis);
    };

    controls.addEventListener('axis-changed', handleAxisChanged);

    return () => {
      controls.removeEventListener('axis-changed', handleAxisChanged);
    };
  }, [selectedJointPivot, transformMode, mode, pendingEdit, isDraggingAxis, updateAxisOpacity]);

  // Draggable panel state
  const containerRef = React.useRef<HTMLDivElement>(null);
  const optionsPanelRef = React.useRef<HTMLDivElement>(null);
  const [optionsPanelPos, setOptionsPanelPos] = React.useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragStartRef = React.useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);
  const [isOptionsCollapsed, setIsOptionsCollapsed] = React.useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('visualizer_options_collapsed');
      return saved === 'true';
    }
    return false;
  });

  const toggleOptionsCollapsed = () => {
    setIsOptionsCollapsed(prev => {
      const newState = !prev;
      localStorage.setItem('visualizer_options_collapsed', String(newState));
      return newState;
    });
  };

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!optionsPanelRef.current || !containerRef.current) return;

    const rect = optionsPanelRef.current.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();

    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: rect.left - containerRect.left,
      panelY: rect.top - containerRect.top
    };
    setDragging(true);
  }, []);

  const handleMouseMove = React.useCallback((e: React.MouseEvent) => {
    if (!dragging || !dragStartRef.current || !containerRef.current || !optionsPanelRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.mouseX;
    const deltaY = e.clientY - dragStartRef.current.mouseY;

    const containerRect = containerRef.current.getBoundingClientRect();
    const panelRect = optionsPanelRef.current.getBoundingClientRect();

    // 计算新位置
    let newX = dragStartRef.current.panelX + deltaX;
    let newY = dragStartRef.current.panelY + deltaY;

    // 边界限制：确保面板不会超出容器
    const padding = 2;
    const maxX = containerRect.width - panelRect.width - padding;
    const maxY = containerRect.height - panelRect.height - padding;

    // Ensure newX and newY are within [padding, max] range
    // Also ensure we don't go negative (if panel is bigger than container)
    newX = Math.max(padding, Math.min(newX, Math.max(padding, maxX)));
    newY = Math.max(padding, Math.min(newY, Math.max(padding, maxY)));

    setOptionsPanelPos({ x: newX, y: newY });
  }, [dragging]);

  const handleMouseUp = React.useCallback(() => {
    setDragging(false);
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
      <div className="absolute top-4 left-4 z-10 pointer-events-none select-none">
        <div className="text-slate-500 dark:text-slate-400 text-xs bg-white/50 dark:bg-google-dark-surface/50 backdrop-blur px-2 py-1 rounded border border-slate-200 dark:border-google-dark-border">
          {os === 'mac' ? t.instructionMac : t.instructionWin} <br />
          {mode === 'skeleton' ? (showLabels ? t.clickLabels : t.enableLabels) : t.clickToSelect}
        </div>
      </div>

      {showOptionsPanel && (
        <div
          ref={optionsPanelRef}
          className="absolute z-10 pointer-events-auto"
          style={optionsPanelPos
            ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto' }
            : { top: '16px', right: '16px' }
          }
        >
          {mode === 'skeleton' && (
            <div className="bg-white/80 dark:bg-google-dark-surface/80 backdrop-blur rounded-lg border border-slate-200 dark:border-google-dark-border flex flex-col w-48 shadow-xl overflow-hidden">
              <div
                className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100/50 dark:bg-google-dark-bg/50 hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between"
                onMouseDown={handleMouseDown}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                  </svg>
                  {t.skeletonOptions}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setOptionsPanelPos(null); toggleOptionsCollapsed(); }}
                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                    title={isOptionsCollapsed ? t.expand : t.collapse}
                  >
                    {isOptionsCollapsed ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    )}
                  </button>
                  {setShowOptionsPanel && (
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setShowOptionsPanel(false); }}
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                      title={t.close}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              </div>

              <div className={`transition-all duration-200 ease-in-out overflow-hidden ${isOptionsCollapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'}`}>
                <div className="p-2 flex flex-col gap-2">
                  <div className="flex bg-slate-100 dark:bg-google-dark-bg rounded-lg p-0.5 mb-1">
                    <button
                      onClick={() => setTransformMode('translate')}
                      className={`flex-1 py-1 text-xs rounded-md ${transformMode === 'translate' ? 'bg-google-blue text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                      {t.move}
                    </button>
                    <button
                      onClick={() => setTransformMode('rotate')}
                      className={`flex-1 py-1 text-xs rounded-md ${transformMode === 'rotate' ? 'bg-google-blue text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                      {t.rotate}
                    </button>
                  </div>

                  <CheckboxOption checked={showGeometry} onChange={setShowGeometry} label={t.showGeometry} />

                     <CheckboxOption checked={showSkeletonOrigin} onChange={setShowSkeletonOrigin} label={t.showOrigin} />
                     {showSkeletonOrigin && (
                        <SliderOption label={t.frameSize} value={frameSize} onChange={setFrameSize} min={0.01} max={0.5} step={0.01} />
                     )}

                  <CheckboxOption checked={showLabels} onChange={setShowLabels} label={t.showLabels} />
                  {showLabels && (
                    <SliderOption label={t.labelScale} value={labelScale} onChange={setLabelScale} min={0.1} max={2.0} step={0.1} decimals={1} />
                  )}

                  <CheckboxOption checked={showJointAxes} onChange={setShowJointAxes} label={t.showJointAxes} />
                  {showJointAxes && (
                    <SliderOption label={t.jointAxisSize} value={jointAxisSize} onChange={setJointAxisSize} min={0.01} max={1.0} step={0.01} />
                  )}
                </div>
              </div>
            </div>
          )}

          {mode === 'detail' && (
            <div className="bg-white/80 dark:bg-google-dark-surface/80 backdrop-blur rounded-lg border border-slate-200 dark:border-google-dark-border flex flex-col w-48 shadow-xl overflow-hidden">
              <div
                className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100/50 dark:bg-google-dark-bg/50 hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between"
                onMouseDown={handleMouseDown}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                  </svg>
                  {t.detailOptions}
                </div>
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setOptionsPanelPos(null); toggleOptionsCollapsed(); }}
                  className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                >
                  {isOptionsCollapsed ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                  )}
                </button>
              </div>

              <div className={`transition-all duration-200 ease-in-out overflow-hidden ${isOptionsCollapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'}`}>
                <div className="p-2 flex flex-col gap-2">
                  <div className="flex bg-slate-100 dark:bg-google-dark-bg rounded-lg p-0.5 mb-1">
                    <button
                      onClick={() => setTransformMode('translate')}
                      className={`flex-1 py-1 text-xs rounded-md ${transformMode === 'translate' ? 'bg-google-blue text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                      {t.move}
                    </button>
                    <button
                      onClick={() => setTransformMode('rotate')}
                      className={`flex-1 py-1 text-xs rounded-md ${transformMode === 'rotate' ? 'bg-google-blue text-white shadow' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                    >
                      {t.rotate}
                    </button>
                  </div>

                  <CheckboxOption checked={showDetailOrigin} onChange={setShowDetailOrigin} label={t.showOrigin} />
                  <CheckboxOption checked={showDetailLabels} onChange={setShowDetailLabels} label={t.showLabels} />
                  <CheckboxOption checked={showVisual} onChange={setShowVisual} label={t.showVisual} />
                  <CheckboxOption checked={showCollision} onChange={setShowCollision} label={t.showCollision} />
                  <CheckboxOption checked={showInertia} onChange={setShowInertia} label={t.showInertia} />
                  <CheckboxOption checked={showCenterOfMass} onChange={setShowCenterOfMass} label={t.showCenterOfMass} />
                </div>
              </div>
            </div>
          )}

          {mode === 'hardware' && (
            <div className="bg-white/80 dark:bg-google-dark-surface/80 backdrop-blur rounded-lg border border-slate-200 dark:border-google-dark-border flex flex-col w-48 shadow-xl overflow-hidden">
              <div
                className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-100/50 dark:bg-google-dark-bg/50 hover:bg-slate-100 dark:hover:bg-google-dark-bg select-none flex items-center justify-between"
                onMouseDown={handleMouseDown}
              >
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
                  </svg>
                  {t.hardwareOptions}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setOptionsPanelPos(null); toggleOptionsCollapsed(); }}
                    className="text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                    title={isOptionsCollapsed ? t.expand : t.collapse}
                  >
                    {isOptionsCollapsed ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                    )}
                  </button>
                  {setShowOptionsPanel && (
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setShowOptionsPanel(false); }}
                      className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 p-1 hover:bg-slate-200 dark:hover:bg-google-dark-border rounded"
                      title={t.close}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              </div>
              <div className={`transition-all duration-200 ease-in-out overflow-hidden ${isOptionsCollapsed ? 'max-h-0 opacity-0' : 'max-h-96 opacity-100'}`}>
                <div className="p-2 flex flex-col gap-2">
                  <CheckboxOption checked={showHardwareOrigin} onChange={setShowHardwareOrigin} label={t.showOrigin} />
                  <CheckboxOption checked={showHardwareLabels} onChange={setShowHardwareLabels} label={t.showLabels} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <Canvas
        shadows
        frameloop="demand"
        camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 60 }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          preserveDrawingBuffer: true,
        }}
      >
        <color attach="background" args={[theme === 'light' ? '#f8f9fa' : '#1f1f1f']} />
        <Suspense fallback={null}>
          <OrbitControls makeDefault enableDamping={false} />
          <SceneLighting />
          <Environment files="/potsdamer_platz_1k.hdr" environmentIntensity={1.2} />
          <SnapshotManager actionRef={snapshotAction} robotName={robot?.name || 'robot'} />

          <group position={[0, 0, 0]}>
            <RobotNode
              linkId={robot.rootLinkId}
              robot={robot}
              onSelect={onSelect}
              onUpdate={onUpdate}
              mode={mode}
              showGeometry={showGeometry}
              showVisual={showVisual}
              showLabels={showLabels}
              showJointAxes={showJointAxes}
              showSkeletonOrigin={showSkeletonOrigin}
              jointAxisSize={jointAxisSize}
              frameSize={frameSize}
              labelScale={labelScale}
              showDetailOrigin={showDetailOrigin}
              showDetailLabels={showDetailLabels}
              showCollision={showCollision}
              showHardwareOrigin={showHardwareOrigin}
              showHardwareLabels={showHardwareLabels}
              showInertia={showInertia}
              showCenterOfMass={showCenterOfMass}
              transformMode={transformMode}
              depth={0}
              assets={assets}
              lang={lang}
              onRegisterJointPivot={handleRegisterJointPivot}
              onRegisterCollisionRef={handleRegisterCollisionRef}
            />
          </group>

          {/* TransformControls at root Canvas level - not nested in hierarchy */}
          {/* Skip fixed joints - they cannot be transformed */}
          {mode === 'skeleton' && selectedJointPivot && robot.selection.type === 'joint' && robot.selection.id && (() => {
            const jointId = robot.selection.id!;
            const joint = robot.joints[jointId];

            if (!joint) return null;

            // Don't show TransformControls for fixed joints
            const jointTypeStr = String(joint.type).toLowerCase();
            if (jointTypeStr === 'fixed' || joint.type === JointType.FIXED) return null;

            return (
              <TransformControls
                ref={transformControlRef}
                object={selectedJointPivot}
                mode={transformMode}
                size={0.7}
                space="local"
                enabled={!pendingEdit}
                onChange={handleObjectChange}
              />
            );
          })()}

          {/* Confirm/Cancel UI matching CollisionTransformControls style */}
          {mode === 'skeleton' && pendingEdit && selectedJointPivot && (() => {
            // Get world position for correct placement
            const worldPos = new THREE.Vector3();
            selectedJointPivot.getWorldPosition(worldPos);

            return (
              <Html
                position={worldPos.toArray()}
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
                      title="Cancel (Esc)"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              </Html>
            );
          })()}

          {/* TransformControls for collision geometry in detail mode */}
          {mode === 'detail' && selectedCollisionRef && robot.selection.type === 'link' && robot.selection.id && robot.selection.subType === 'collision' && (() => {
            const linkId = robot.selection.id!;
            const link = robot.links[linkId];

            if (!link) return null;

            const handleCollisionTransformEnd = () => {
              if (selectedCollisionRef) {
                const pos = selectedCollisionRef.position;
                const rot = selectedCollisionRef.rotation;

                onUpdate('link', linkId, {
                  ...link,
                  collision: {
                    ...link.collision,
                    origin: {
                      xyz: { x: pos.x, y: pos.y, z: pos.z },
                      rpy: { r: rot.x, p: rot.y, y: rot.z }
                    }
                  }
                });
              }
            };

            return (
              <TransformControls
                object={selectedCollisionRef}
                mode={transformMode}
                size={0.7}
                space="local"
                onMouseUp={handleCollisionTransformEnd}
              />
            );
          })()}

          <Grid
            name="ReferenceGrid"
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
            userData={{ isGizmo: true }}
          />

          <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
            <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor={theme === 'light' ? '#0f172a' : 'white'} />
          </GizmoHelper>
        </Suspense>
      </Canvas>
    </div>
  );
};