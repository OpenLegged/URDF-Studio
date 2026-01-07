import React, { Suspense, useState, useMemo, useRef, useEffect } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport, Html, Line, TransformControls } from '@react-three/drei';
import { RobotState, GeometryType, UrdfJoint, JointType, Theme } from '../types';
import * as THREE from 'three';
// @ts-ignore - three.js loaders are JS files without type definitions
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
// @ts-ignore
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
// @ts-ignore
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { translations, Language } from '../services/i18n';

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
  onSelect: (type: 'link' | 'joint', id: string) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: 'skeleton' | 'detail' | 'hardware';
  showGeometry: boolean;
  showLabels: boolean;
  showJointAxes: boolean;
  showDetailOrigin: boolean;
  showDetailLabels: boolean;
  showCollision: boolean;
  showHardwareOrigin: boolean;
  showHardwareLabels: boolean;
  transformMode: 'translate' | 'rotate';
  assets: Record<string, string>;
  lang: Language;
  onRegisterJointPivot?: (jointId: string, pivot: THREE.Group | null) => void;
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
}

const useLoadingManager = (assets: Record<string, string>) => {
  const manager = useMemo(() => {
    const m = new THREE.LoadingManager();
    m.setURLModifier((url) => {
      if (url.startsWith('blob:') || url.startsWith('data:')) return url;
      
      // Normalize path separators
      const normalizedUrl = url.replace(/\\/g, '/');
      const filename = normalizedUrl.split('/').pop();
      
      if (filename) {
          // Try exact match in assets
          if (assets[filename]) return assets[filename];
          
          // Try case-insensitive match
          const lowerFilename = filename.toLowerCase();
          const foundKey = Object.keys(assets).find(k => k.toLowerCase().endsWith(lowerFilename));
          if (foundKey) return assets[foundKey];
      }
      
      return url;
    });
    return m;
  }, [assets]);
  return manager;
};

const STLRenderer = ({ url, material, scale }: { url: string, material: THREE.Material, scale?: { x: number, y: number, z: number } }) => {
    const geometry = useLoader(STLLoader, url);
    const clone = useMemo(() => geometry.clone(), [geometry]);
    const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];
    // URDF uses Z-up, Three.js uses Y-up. Rotate -90 degrees around X-axis to convert
    return <mesh geometry={clone} material={material} rotation={[0, 0, 0]} scale={scaleArr} />;
};

const OBJRenderer = ({ url, material, color, assets, scale }: { url: string, material: THREE.Material, color: string, assets: Record<string, string>, scale?: { x: number, y: number, z: number } }) => {
    const manager = useLoadingManager(assets);
    const obj = useLoader(OBJLoader, url, (loader) => {
        loader.manager = manager;
    });
    const clone = useMemo(() => {
        const c = obj.clone();
        c.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                // Only override if the mesh doesn't have a texture map
                const mesh = child as THREE.Mesh;
                const mat = mesh.material as THREE.MeshStandardMaterial;
                if (!mat || !mat.map) {
                    mesh.material = material;
                }
            }
        });
        return c;
    }, [obj, material]);
    const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];
    // URDF uses Z-up, Three.js uses Y-up. Rotate -90 degrees around X-axis to convert
    return <group rotation={[0, 0, 0]} scale={scaleArr}><primitive object={clone} /></group>;
};

const DAERenderer = ({ url, material, assets, scale }: { url: string, material: THREE.Material, assets: Record<string, string>, scale?: { x: number, y: number, z: number } }) => {
    const manager = useLoadingManager(assets);
    // Load DAE file
    const dae = useLoader(ColladaLoader, url, (loader) => {
        loader.manager = manager;
    });
    const clone = useMemo(() => {
        const c = dae.scene.clone();
        // Reset any rotation that ColladaLoader may have applied for Z-UP conversion
        // Since we're working in URDF's native Z-UP coordinate system, we don't need the conversion
        c.rotation.set(0, 0, 0);
        c.updateMatrix();
        
        c.traverse((child: any) => {
            if (child.isMesh) {
                const mesh = child as THREE.Mesh;
                const originalMat = mesh.material;
                
                // Check if original material has texture
                let hasTexture = false;
                if (Array.isArray(originalMat)) {
                    hasTexture = originalMat.some((m: any) => m.map || m.emissiveMap);
                } else {
                    const mat = originalMat as any;
                    hasTexture = !!mat.map || !!mat.emissiveMap;
                }

                // If no texture, apply URDF material
                if (!hasTexture) {
                    mesh.material = material;
                }
            }
        });
        return c;
    }, [dae, material]);
    const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];
    // No rotation needed - we're using Z-UP coordinate system throughout
    return <group scale={scaleArr}><primitive object={clone} /></group>;
};


const JointAxesVisual = ({ joint }: { joint: UrdfJoint }) => {
  const { type, axis } = joint;
  
  const quaternion = useMemo(() => {
    const axisVec = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVec);
  }, [axis.x, axis.y, axis.z]);

  if (type === JointType.FIXED) return null;

  const color = "#d946ef";

  return (
    <group quaternion={quaternion}>
      <arrowHelper args={[new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 0.35, color, 0.08, 0.05]} />
      {(type === JointType.REVOLUTE || type === JointType.CONTINUOUS) && (
        <group>
            <mesh>
                <torusGeometry args={[0.15, 0.005, 8, 32, type === JointType.REVOLUTE ? Math.PI * 1.5 : Math.PI * 2]} />
                <meshBasicMaterial color={color} />
            </mesh>
            <mesh position={[0.15, 0, 0]} rotation={[Math.PI / 2, 0, -Math.PI / 2]}>
                <coneGeometry args={[0.015, 0.04, 8]} />
                <meshBasicMaterial color={color} />
            </mesh>
        </group>
      )}
      {type === JointType.PRISMATIC && (
         <group>
             <arrowHelper args={[new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 0.35, color, 0.08, 0.05]} />
         </group>
      )}
    </group>
  );
};

function JointNode({
  joint,
  robot,
  onSelect,
  onUpdate,
  mode,
  showGeometry,
  showLabels,
  showJointAxes,
  showDetailOrigin,
  showDetailLabels,
  showCollision,
  showHardwareOrigin,
  showHardwareLabels,
  transformMode,
  depth,
  assets,
  lang,
  onRegisterJointPivot
}: JointNodeProps) {
  
  if (depth > 50) return null;

  const isSelected = robot.selection.type === 'joint' && robot.selection.id === joint.id;
  const { x, y, z } = joint.origin.xyz;
  const { r, p, y: yaw } = joint.origin.rpy;
  
  const showAxes = mode === 'skeleton' || (mode === 'detail' && showDetailOrigin) || (mode === 'hardware' && showHardwareOrigin);
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
        {mode === 'skeleton' && (
            <Line
                points={[[0, 0, 0], [x, y, z]]}
                color={isSelected ? "#fbbf24" : "#94a3b8"} 
                lineWidth={2}
                dashed
                dashScale={10}
            />
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
                {showAxes && <axesHelper args={[0.2]} />}

                {(mode === 'skeleton' || mode === 'hardware') && (
                    <group>
                        {showJointLabel && (
                            <Html position={[0.25, 0, 0]} className="pointer-events-none">
                                <div 
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
                        {mode === 'skeleton' && showJointAxes && <JointAxesVisual joint={joint} />}
                    </group>
                )}

                {mode !== 'skeleton' && (
                    <mesh onClick={(e) => { e.stopPropagation(); onSelect('joint', joint.id); }}>
                        <sphereGeometry args={[0.02, 16, 16]} />
                        <meshBasicMaterial color={isSelected ? "orange" : "transparent"} opacity={isSelected ? 1 : 0} transparent />
                    </mesh>
                )}

                <RobotNode 
                    linkId={joint.childLinkId} 
                    robot={robot} 
                    onSelect={onSelect} 
                    onUpdate={onUpdate}
                    mode={mode}
                    showGeometry={showGeometry}
                    showLabels={showLabels}
                    showJointAxes={showJointAxes}
                    showDetailOrigin={showDetailOrigin}
                    showDetailLabels={showDetailLabels}
                    showCollision={showCollision}
                    showHardwareOrigin={showHardwareOrigin}
                    showHardwareLabels={showHardwareLabels}
                    transformMode={transformMode}
                    depth={depth + 1}
                    assets={assets}
                    lang={lang}
                    onRegisterJointPivot={onRegisterJointPivot}
                />
            </group>
        </group>
    </group>
  );
}

function RobotNode({
  linkId, 
  robot, 
  onSelect,
  onUpdate,
  mode,
  showGeometry,
  showLabels,
  showJointAxes,
  showDetailOrigin,
  showDetailLabels,
  showCollision,
  showHardwareOrigin,
  showHardwareLabels,
  transformMode,
  depth,
  assets,
  lang,
  onRegisterJointPivot
}: RobotNodeProps) {
  
  if (depth > 50) return null;

  const link = robot.links[linkId];
  if (!link) return null;

  const handleLinkClick = (e: any) => {
      e.stopPropagation();
      // Select the link directly. JointNode will detect this via childLinkId and show controls.
      if (robot.selection.type !== 'link' || robot.selection.id !== linkId) {
          onSelect('link', linkId);
      }
  };

  const childJoints = Object.values(robot.joints).filter(j => j.parentLinkId === linkId);
  const isSelected = robot.selection.type === 'link' && robot.selection.id === linkId;
  const isRoot = linkId === robot.rootLinkId;
  
  // Refs for dragging geometry in Detail mode
  const [visualRef, setVisualRef] = useState<THREE.Group | null>(null);
  const [collisionRef, setCollisionRef] = useState<THREE.Group | null>(null);

  // Render Visual or Collision Geometry
  const renderGeometry = (isCollision: boolean) => {
    const data = isCollision ? link.collision : link.visual;
    // Fallback if collision data doesn't exist yet (for older state compatibility)
    if (isCollision && !data) return null;

    if (mode === 'skeleton' && !showGeometry && !isCollision) return null;
    if (isCollision && !showCollision) return null;
    if (isCollision && mode !== 'detail') return null;

    const { type, dimensions, color, origin, meshPath } = data;
    
    // IF TYPE IS NONE, RENDER NOTHING
    if (type === GeometryType.NONE) return null;

    // Create a unique key based on geometry properties to force re-render when they change
    const geometryKey = `${isCollision ? 'col' : 'vis'}-${type}-${dimensions.x}-${dimensions.y}-${dimensions.z}-${meshPath || 'none'}`;

    const isSkeleton = mode === 'skeleton';
    
    // Collision styling - Purple wireframe
    const colColor = '#a855f7'; // Purple-500
    const matOpacity = isCollision ? 0.3 : (isSkeleton ? 0.2 : 1.0);
    const matWireframe = isCollision ? true : isSkeleton;
    const finalColor = isCollision ? colColor : (isSelected ? '#60a5fa' : color);

    const material = new THREE.MeshStandardMaterial({
        color: finalColor,
        roughness: 0.3,
        metalness: 0.2,
        emissive: isSelected && !isCollision ? '#1e40af' : '#000000',
        emissiveIntensity: 0.5,
        transparent: isSkeleton || isCollision,
        opacity: matOpacity,
        wireframe: matWireframe,
        side: isCollision ? THREE.FrontSide : THREE.DoubleSide,
        polygonOffset: isCollision,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1
    });

    const wrapperProps = {
        onClick: (e: any) => { handleLinkClick(e); },
        position: origin ? new THREE.Vector3(origin.xyz.x, origin.xyz.y, origin.xyz.z) : undefined,
        // URDF uses rpy (roll-pitch-yaw) which is rotation around X, Y, Z in that order
        rotation: origin ? new THREE.Euler(origin.rpy.r, origin.rpy.p, origin.rpy.y, 'XYZ') : undefined,
        ref: isCollision ? setCollisionRef : setVisualRef // Capture ref for TransformControls
    };

    let geometryNode;
    // For cylinder, we need to rotate to align with Z-up
    // This rotation is applied to the mesh itself, separate from origin rotation
    let meshRotation: [number, number, number] = [0, 0, 0];

    if (type === GeometryType.BOX) {
         // Box dimensions: x=width (along X), y=depth (along Y), z=height (along Z)
         geometryNode = (
           <mesh>
             <boxGeometry args={[dimensions.x, dimensions.y, dimensions.z, 2, 2, 2]} />
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
             <cylinderGeometry args={[dimensions.x, dimensions.x, dimensions.y, 32, 1]} />
             <primitive object={material} attach="material" />
           </mesh>
         );
    } else if (type === GeometryType.SPHERE) {
         geometryNode = (
           <mesh>
             <sphereGeometry args={[dimensions.x, 32, 32]} />
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

  const showRootAxes = isRoot && (mode === 'skeleton' || (mode === 'detail' && showDetailOrigin) || (mode === 'hardware' && showHardwareOrigin));
  const showLinkLabel = (mode === 'detail' && showDetailLabels) || (mode === 'hardware' && showHardwareLabels);
  const showRootLabel = isRoot && ((mode === 'skeleton' && showLabels) || (mode === 'hardware' && showHardwareLabels));

  return (
    <group>
      {showRootAxes && (
        <group>
            <axesHelper args={[0.3]} />
            {showRootLabel && (
                <Html position={[0.35, 0, 0]} className="pointer-events-none">
                    <div 
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

      {/* Visual Geometry - key forces re-render on data change */}
      <React.Fragment key={`visual-${link.visual?.type}-${link.visual?.dimensions?.x}-${link.visual?.dimensions?.y}-${link.visual?.dimensions?.z}`}>
        {renderGeometry(false)}
      </React.Fragment>
      
      {/* Collision Geometry - key forces re-render on data change */}
      <React.Fragment key={`collision-${link.collision?.type}-${link.collision?.dimensions?.x}-${link.collision?.dimensions?.y}-${link.collision?.dimensions?.z}`}>
        {renderGeometry(true)}
      </React.Fragment>

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
            showLabels={showLabels}
            showJointAxes={showJointAxes}
            showDetailOrigin={showDetailOrigin}
            showDetailLabels={showDetailLabels}
            showCollision={showCollision}
            showHardwareOrigin={showHardwareOrigin}
            showHardwareLabels={showHardwareLabels}
            transformMode={transformMode}
            depth={depth + 1}
            assets={assets}
            lang={lang}
            onRegisterJointPivot={onRegisterJointPivot}
         />
      ))}
    </group>
  );
}

export const Visualizer = ({ robot, onSelect, onUpdate, mode, assets, lang, theme }: { robot: RobotState; onSelect: any; onUpdate: any; mode: 'skeleton' | 'detail' | 'hardware', assets: Record<string, string>, lang: Language, theme: Theme }) => {
  const t = translations[lang];

  // Skeleton Settings
  const [showGeometry, setShowGeometry] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showJointAxes, setShowJointAxes] = useState(false);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');

  // Detail Settings
  const [showDetailOrigin, setShowDetailOrigin] = useState(false);
  const [showDetailLabels, setShowDetailLabels] = useState(false);
  const [showCollision, setShowCollision] = useState(false);

  // Hardware Settings
  const [showHardwareOrigin, setShowHardwareOrigin] = useState(false);
  const [showHardwareLabels, setShowHardwareLabels] = useState(false);

  // Joint pivot refs for TransformControls at root level
  const [jointPivots, setJointPivots] = useState<Record<string, THREE.Group | null>>({});
  
  const handleRegisterJointPivot = (jointId: string, pivot: THREE.Group | null) => {
    setJointPivots(prev => ({ ...prev, [jointId]: pivot }));
  };
  
  const selectedJointPivot = robot.selection.type === 'joint' && robot.selection.id
    ? jointPivots[robot.selection.id] 
    : null;

  // Draggable panel state
  const containerRef = React.useRef<HTMLDivElement>(null);
  const optionsPanelRef = React.useRef<HTMLDivElement>(null);
  const [optionsPanelPos, setOptionsPanelPos] = React.useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragStartRef = React.useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);
  const [isOptionsCollapsed, setIsOptionsCollapsed] = React.useState(false);

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
              {t.instruction} <br/>
              {mode === 'skeleton' ? (showLabels ? t.clickLabels : t.enableLabels) : t.clickToSelect}
           </div>
        </div>

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
                       <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                     </svg>
                     {t.skeletonOptions}
                   </div>
                   <button 
                     onMouseDown={(e) => e.stopPropagation()}
                     onClick={(e) => { e.stopPropagation(); setOptionsPanelPos(null); setIsOptionsCollapsed(!isOptionsCollapsed); }}
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

                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showGeometry} onChange={(e) => setShowGeometry(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showGeometry}
                     </label>
                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showLabels}
                     </label>
                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showJointAxes} onChange={(e) => setShowJointAxes(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showJointAxes}
                     </label>
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
                       <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                     </svg>
                     {t.detailOptions}
                   </div>
                   <button 
                     onMouseDown={(e) => e.stopPropagation()}
                     onClick={(e) => { e.stopPropagation(); setOptionsPanelPos(null); setIsOptionsCollapsed(!isOptionsCollapsed); }}
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

                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showDetailOrigin} onChange={(e) => setShowDetailOrigin(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showOrigin}
                     </label>
                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showDetailLabels} onChange={(e) => setShowDetailLabels(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showLabels}
                     </label>
                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showCollision} onChange={(e) => setShowCollision(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showCollision}
                     </label>
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
                       <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                     </svg>
                     {t.hardwareOptions}
                   </div>
                   <button 
                     onMouseDown={(e) => e.stopPropagation()}
                     onClick={(e) => { e.stopPropagation(); setOptionsPanelPos(null); setIsOptionsCollapsed(!isOptionsCollapsed); }}
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
                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showHardwareOrigin} onChange={(e) => setShowHardwareOrigin(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showOrigin}
                     </label>
                     <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-200 select-none hover:text-slate-900 dark:hover:text-white">
                        <input type="checkbox" checked={showHardwareLabels} onChange={(e) => setShowHardwareLabels(e.target.checked)} className="rounded border-slate-300 dark:border-google-dark-border bg-white dark:bg-google-dark-bg text-google-blue" />
                        {t.showLabels}
                     </label>
                   </div>
                 </div>
              </div>
           )}
        </div>
        
      <Canvas 
        shadows 
        camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 60 }} 
        onCreated={(state) => console.log('Canvas created', state)}
      >
        <color attach="background" args={[theme === 'light' ? '#f8f9fa' : '#1f1f1f']} />
        <Suspense fallback={null}>
            <OrbitControls makeDefault />
            <ambientLight intensity={0.8} />
            <directionalLight position={[10, 10, 10]} intensity={1.5} />
            <directionalLight position={[-10, -10, -5]} intensity={1} />
            <Environment files="/potsdamer_platz_1k.hdr" />
            
            <group position={[0, 0, 0]}>
                 <RobotNode 
                    linkId={robot.rootLinkId} 
                    robot={robot} 
                    onSelect={onSelect} 
                    onUpdate={onUpdate}
                    mode={mode} 
                    showGeometry={showGeometry}
                    showLabels={showLabels}
                    showJointAxes={showJointAxes}
                    showDetailOrigin={showDetailOrigin}
                    showDetailLabels={showDetailLabels}
                    showCollision={showCollision}
                    showHardwareOrigin={showHardwareOrigin}
                    showHardwareLabels={showHardwareLabels}
                    transformMode={transformMode}
                    depth={0}
                    assets={assets}
                    lang={lang}
                    onRegisterJointPivot={handleRegisterJointPivot}
                 />
            </group>
            
            {/* TransformControls at root Canvas level - not nested in hierarchy */}
            {mode === 'skeleton' && selectedJointPivot && robot.selection.type === 'joint' && robot.selection.id && (() => {
              const jointId = robot.selection.id!;
              const joint = robot.joints[jointId];
              
              if (!joint) return null;
              
              const handleTransformEnd = () => {
                if (selectedJointPivot) {
                  // selectedJointPivot.position is the joint origin in parent-local space
                  const pos = selectedJointPivot.position;
                  const rot = selectedJointPivot.rotation;
                  
                  // Update joint origin directly from pivot's local position
                  onUpdate('joint', jointId, {
                    ...joint,
                    origin: {
                      xyz: { x: pos.x, y: pos.y, z: pos.z },
                      rpy: { r: rot.x, p: rot.y, y: rot.z }
                    }
                  });
                }
              };
              
              return (
                <TransformControls 
                    object={selectedJointPivot}
                    mode={transformMode}
                    size={0.7}
                    space="local"
                    onMouseUp={handleTransformEnd}
                />
              );
            })()}

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
            
            <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor={theme === 'light' ? '#0f172a' : 'white'} />
            </GizmoHelper>
        </Suspense>
      </Canvas>
    </div>
  );
};