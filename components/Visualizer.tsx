
import React, { Suspense, useState, useMemo, useRef, useEffect } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport, Html, Line, TransformControls } from '@react-three/drei';
import { RobotState, GeometryType, UrdfJoint, JointType } from '../types';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader';
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
}

interface JointNodeProps extends CommonVisualizerProps {
  joint: UrdfJoint;
  depth: number;
  key?: React.Key;
}

interface RobotNodeProps extends CommonVisualizerProps {
  linkId: string;
  depth: number;
}

const STLRenderer = ({ url, material }: { url: string, material: THREE.Material }) => {
    const geometry = useLoader(STLLoader, url);
    const clone = useMemo(() => geometry.clone(), [geometry]);
    // URDF uses Z-up, Three.js uses Y-up. Rotate -90 degrees around X-axis to convert
    return <mesh geometry={clone} material={material} rotation={[0, 0, 0]} />;
};

const OBJRenderer = ({ url, material, color }: { url: string, material: THREE.Material, color: string }) => {
    const obj = useLoader(OBJLoader, url);
    const clone = useMemo(() => {
        const c = obj.clone();
        c.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                (child as THREE.Mesh).material = material;
            }
        });
        return c;
    }, [obj, material]);
    // URDF uses Z-up, Three.js uses Y-up. Rotate -90 degrees around X-axis to convert
    return <group rotation={[0, 0, 0]}><primitive object={clone} /></group>;
};

const DAERenderer = ({ url, material }: { url: string, material: THREE.Material }) => {
    const dae = useLoader(ColladaLoader, url, (loader: ColladaLoader) => {
        // Collada meshes in URDFs are authored in Z-up; keep that frame so the URDF
        // origin rpy is still valid instead of letting the loader force Y-up.
        loader.options.convertUpAxis = false;
    });
    const clone = useMemo(() => {
        const c = dae.scene.clone();
        c.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                (child as THREE.Mesh).material = material;
            }
        });
        return c;
    }, [dae, material]);
    // URDF uses Z-up, Three.js uses Y-up. Rotate -90 degrees around X-axis to convert
    return <group rotation={[1.57, 0, 0]}><primitive object={clone} /></group>;
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
  lang
}: JointNodeProps) {
  
  if (depth > 50) return null;

  const isSelected = robot.selection.type === 'joint' && robot.selection.id === joint.id;
  const { x, y, z } = joint.origin.xyz;
  const { r, p, y: yaw } = joint.origin.rpy;
  
  const showAxes = mode === 'skeleton' || (mode === 'detail' && showDetailOrigin) || (mode === 'hardware' && showHardwareOrigin);
  const showJointLabel = (mode === 'skeleton' && showLabels) || (mode === 'hardware' && showHardwareLabels);
  
  // Use state ref for TransformControls target
  const [jointGroup, setJointGroup] = useState<THREE.Group | null>(null);

  const handleTransformEnd = () => {
    if (jointGroup) {
      const pos = jointGroup.position;
      const rot = jointGroup.rotation;
      onUpdate('joint', joint.id, {
        ...joint,
        origin: {
          xyz: { x: pos.x, y: pos.y, z: pos.z },
          rpy: { r: rot.x, p: rot.y, y: rot.z }
        }
      });
    }
  };

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

        <group 
            ref={setJointGroup}
            position={[x, y, z]} 
            rotation={[r, p, yaw]}
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
                                        : 'bg-slate-900/90 text-orange-200 border-orange-900/50 hover:bg-slate-800'
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
            />
        </group>

        {/* Transform Controls - must be outside jointGroup to control it */}
        {isSelected && mode === 'skeleton' && jointGroup && (
            <TransformControls 
                object={jointGroup}
                mode={transformMode}
                size={0.7}
                space="world"
                onMouseUp={handleTransformEnd}
            />
        )}
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
  lang
}: RobotNodeProps) {
  
  if (depth > 50) return null;

  const link = robot.links[linkId];
  if (!link) return null;

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

    const isSkeleton = mode === 'skeleton';
    
    // Collision styling
    const colColor = '#ef4444';
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
        side: THREE.DoubleSide
    });

    const wrapperProps = {
        onClick: (e: any) => { if(!isCollision) { e.stopPropagation(); onSelect('link', linkId); } },
        position: origin ? new THREE.Vector3(origin.xyz.x, origin.xyz.y, origin.xyz.z) : undefined,
        rotation: origin ? new THREE.Euler(origin.rpy.r, origin.rpy.p, origin.rpy.y) : undefined,
        ref: isCollision ? setCollisionRef : setVisualRef // Capture ref for TransformControls
    };

    let geometryNode;
    let rotation: [number, number, number] = [0, 0, 0];

    if (type === GeometryType.BOX) {
         geometryNode = <mesh rotation={rotation} geometry={new THREE.BoxGeometry(dimensions.x, dimensions.y, dimensions.z)} material={material} />;
    } else if (type === GeometryType.CYLINDER) {
         // IMPORTANT: Rotate cylinder 90 deg on X to align with URDF Z-axis standard
         rotation = [Math.PI / 2, 0, 0];
         geometryNode = <mesh rotation={rotation} geometry={new THREE.CylinderGeometry(dimensions.x, dimensions.x, dimensions.y, 32)} material={material} />;
    } else if (type === GeometryType.SPHERE) {
         geometryNode = <mesh rotation={rotation} geometry={new THREE.SphereGeometry(dimensions.x, 32, 32)} material={material} />;
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
                 geometryNode = <STLRenderer url={url} material={material} />;
             } else if (ext === 'obj') {
                 geometryNode = <OBJRenderer url={url} material={material} color={finalColor} />;
             } else if (ext === 'dae') {
                 geometryNode = <DAERenderer url={url} material={material} />;
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
        <group {...wrapperProps}>
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
                        onClick={(e) => { e.stopPropagation(); onSelect('link', linkId); }}
                        className={`
                            px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap shadow-xl
                            pointer-events-auto cursor-pointer select-none transition-colors
                            ${isSelected 
                                ? 'bg-blue-600 text-white border-blue-400 z-50' 
                                : 'bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800'
                            }
                        `}
                    >
                        {link.name} (Base)
                    </div>
                </Html>
            )}
        </group>
      )}

      {renderGeometry(false)} 
      {renderGeometry(true)}

      {/* Transform Controls for Link Geometry in Detail Mode */}
      {isSelected && mode === 'detail' && activeGeometryRef && (
          <TransformControls
              object={activeGeometryRef}
              mode={transformMode}
              space="local"
              size={0.6}
              onMouseUp={handleGeometryTransformEnd}
          />
      )}

      {showLinkLabel && (
         <Html position={[0, 0, 0]} className="pointer-events-none" zIndexRange={[100, 0]}>
            <div 
                onClick={(e) => { e.stopPropagation(); onSelect('link', linkId); }}
                className={`
                    px-1.5 py-0.5 text-[10px] font-mono rounded border whitespace-nowrap shadow-xl backdrop-blur-sm
                    pointer-events-auto cursor-pointer select-none transition-colors opacity-90 hover:opacity-100
                    ${isSelected 
                        ? 'bg-blue-600/90 text-white border-blue-400 z-50' 
                        : 'bg-slate-800/80 text-blue-200 border-slate-600 hover:bg-slate-700'
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
         />
      ))}
    </group>
  );
}

export const Visualizer = ({ robot, onSelect, onUpdate, mode, assets, lang }: { robot: RobotState; onSelect: any; onUpdate: any; mode: 'skeleton' | 'detail' | 'hardware', assets: Record<string, string>, lang: Language }) => {
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

  return (
    <div className="flex-1 relative bg-slate-900 h-full overflow-hidden">
        <div className="absolute top-4 left-4 z-10 pointer-events-none select-none">
             <div className="text-slate-400 text-xs bg-slate-900/50 backdrop-blur px-2 py-1 rounded border border-slate-800">
              {t.instruction} <br/>
              {mode === 'skeleton' ? (showLabels ? t.clickLabels : t.enableLabels) : t.clickToSelect}
           </div>
        </div>

        <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
           {mode === 'skeleton' && (
              <div className="bg-slate-800/80 backdrop-blur p-2 rounded border border-slate-700 pointer-events-auto flex flex-col gap-2 w-48 shadow-xl">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-1 mb-1">{t.skeletonOptions}</div>
                 
                 <div className="flex bg-slate-700 rounded p-0.5 mb-2">
                    <button 
                        onClick={() => setTransformMode('translate')}
                        className={`flex-1 py-1 text-xs rounded ${transformMode === 'translate' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        {t.move}
                    </button>
                    <button 
                        onClick={() => setTransformMode('rotate')}
                        className={`flex-1 py-1 text-xs rounded ${transformMode === 'rotate' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        {t.rotate}
                    </button>
                 </div>

                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showGeometry} onChange={(e) => setShowGeometry(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showGeometry}
                 </label>
                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showLabels}
                 </label>
                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showJointAxes} onChange={(e) => setShowJointAxes(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showJointAxes}
                 </label>
              </div>
           )}

           {mode === 'detail' && (
              <div className="bg-slate-800/80 backdrop-blur p-2 rounded border border-slate-700 pointer-events-auto flex flex-col gap-2 w-48 shadow-xl">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-1 mb-1">{t.detailOptions}</div>
                 
                  <div className="flex bg-slate-700 rounded p-0.5 mb-2">
                    <button 
                        onClick={() => setTransformMode('translate')}
                        className={`flex-1 py-1 text-xs rounded ${transformMode === 'translate' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        {t.move}
                    </button>
                    <button 
                        onClick={() => setTransformMode('rotate')}
                        className={`flex-1 py-1 text-xs rounded ${transformMode === 'rotate' ? 'bg-blue-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
                    >
                        {t.rotate}
                    </button>
                 </div>

                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showDetailOrigin} onChange={(e) => setShowDetailOrigin(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showOrigin}
                 </label>
                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showDetailLabels} onChange={(e) => setShowDetailLabels(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showLabels}
                 </label>
                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showCollision} onChange={(e) => setShowCollision(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showCollision}
                 </label>
              </div>
           )}

           {mode === 'hardware' && (
              <div className="bg-slate-800/80 backdrop-blur p-2 rounded border border-slate-700 pointer-events-auto flex flex-col gap-2 w-48 shadow-xl">
                 <div className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-1 mb-1">{t.hardwareOptions}</div>
                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showHardwareOrigin} onChange={(e) => setShowHardwareOrigin(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showOrigin}
                 </label>
                 <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-200 select-none hover:text-white">
                    <input type="checkbox" checked={showHardwareLabels} onChange={(e) => setShowHardwareLabels(e.target.checked)} className="rounded border-slate-600 bg-slate-700 text-blue-600" />
                    {t.showLabels}
                 </label>
              </div>
           )}
        </div>
        
      <Canvas shadows camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 50 }}>
        <Suspense fallback={null}>
            <OrbitControls makeDefault />
            <Environment preset="city" />
            
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
                 />
            </group>

            <Grid 
                infiniteGrid 
                fadeDistance={10} 
                cellColor={'#475569'} 
                sectionColor={'#64748b'} 
                rotation={[Math.PI / 2, 0, 0]}
                position={[0, 0, -0.01]} 
            />
            
            <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" />
            </GizmoHelper>
        </Suspense>
      </Canvas>
    </div>
  );
};
