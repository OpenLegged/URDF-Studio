import React, { useState, useEffect, useRef, useCallback } from 'react';
import { RobotState, JointType, GeometryType, AppMode, UrdfLink, MotorSpec, Theme } from '../types';
import { Upload, File, Wand, ExternalLink, ChevronRight, PanelRightOpen } from 'lucide-react';
import * as THREE from 'three';
import { translations, Language } from '../services/i18n';

interface PropertyEditorProps {
  robot: RobotState;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: AppMode;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
  theme: Theme;
}

const InputGroup = ({ label, children }: { label: string, children?: React.ReactNode }) => (
  <div className="mb-4">
    <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">{label}</label>
    {children}
  </div>
);

const NumberInput = ({ value, onChange, label, step = 0.1 }: { value: number, onChange: (val: number) => void, label?: string, step?: number }) => {
  const [localValue, setLocalValue] = useState<string>(value?.toString() || '0');

  useEffect(() => {
    setLocalValue(value?.toString() || '0');
  }, [value]);

  const handleBlur = () => {
    const parsed = parseFloat(localValue);
    if (!isNaN(parsed) && isFinite(parsed)) {
      if (parsed !== value) {
        onChange(parsed);
      }
      setLocalValue(parsed.toString());
    } else {
      setLocalValue(value?.toString() || '0');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value);
  };

  return (
    <div className="flex flex-col">
      {label && <span className="text-[10px] text-slate-500 mb-0.5">{label}</span>}
      <input
        type="number"
        step={step}
        value={localValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onFocus={(e) => e.target.select()}
        onKeyDown={handleKeyDown}
        className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-google-blue w-full"
      />
    </div>
  );
};

const Vec3Input = ({ value, onChange, labels, keys = ['x', 'y', 'z'] }: any) => (
  <div className="grid grid-cols-3 gap-2">
    <NumberInput 
        label={labels[0]} 
        value={value[keys[0]]} 
        onChange={(v: number) => onChange({ ...value, [keys[0]]: v })} 
    />
    <NumberInput 
        label={labels[1]} 
        value={value[keys[1]]} 
        onChange={(v: number) => onChange({ ...value, [keys[1]]: v })} 
    />
    <NumberInput 
        label={labels[2]} 
        value={value[keys[2]]} 
        onChange={(v: number) => onChange({ ...value, [keys[2]]: v })} 
    />
  </div>
);

// Helper for Visual/Collision Geometry Editor
const GeometryEditor = ({ 
  data, 
  robot,
  category, 
  onUpdate,
  assets,
  onUploadAsset,
  t
}: { 
  data: any, 
  robot: RobotState,
  category: 'visual' | 'collision', 
  onUpdate: (d: any) => void,
  assets: Record<string, string>,
  onUploadAsset: (file: File) => void,
  t: any
}) => {
    const geomData = data[category] || {};
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    // Ensure nested objects exist if they are missing
    const update = (newData: any) => {
        onUpdate({ ...data, [category]: { ...geomData, ...newData } });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onUploadAsset(e.target.files[0]);
        }
    };

    const calculateAutoAlign = () => {
       // Find the child joint connected to this link
       const childJoint = Object.values(robot.joints).find(j => j.parentLinkId === data.id);
       
       if (!childJoint) return null;

       // Vector from Parent (Link Origin 0,0,0) to Child Joint
       const start = new THREE.Vector3(0, 0, 0);
       const end = new THREE.Vector3(childJoint.origin.xyz.x, childJoint.origin.xyz.y, childJoint.origin.xyz.z);
       const vector = new THREE.Vector3().subVectors(end, start);
       const length = vector.length();
       const midpoint = vector.clone().multiplyScalar(0.5);

       // Calculate Rotation to align Z-axis with the vector
       const zAxis = new THREE.Vector3(0, 0, 1);
       const direction = vector.clone().normalize();
       
       const quaternion = new THREE.Quaternion();
       if (direction.y === 0 && direction.x === 0 && direction.z === -1) {
            quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
       } else {
            quaternion.setFromUnitVectors(zAxis, direction);
       }
       
       const euler = new THREE.Euler().setFromQuaternion(quaternion);

       return {
           dimensions: { y: length }, // Only length is determined by joint distance
           origin: {
               xyz: { x: midpoint.x, y: midpoint.y, z: midpoint.z },
               rpy: { r: euler.x, p: euler.y, y: euler.z }
           }
       };
    };

    const handleAutoAlign = () => {
       const result = calculateAutoAlign();
       if (!result) return;

       const currentDims = geomData.dimensions || { x: 0.05, y: 0.5, z: 0.05 };
       // Keep existing radius (x, z) but update length (y)
       const newDims = { ...currentDims, y: result.dimensions.y };

       update({
          dimensions: newDims,
          origin: result.origin
       });
    };

    return (
        <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 capitalize">{category === 'visual' ? t.visualGeometry : t.collisionGeometry}</h3>
                {geomData.type === GeometryType.CYLINDER && (
                    <button 
                        onClick={handleAutoAlign}
                        className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
                        title={t.autoAlign}
                    >
                        <Wand className="w-4 h-4" />
                    </button>
                )}
            </div>

            <InputGroup label={t.type}>
                <select 
                    value={geomData.type || GeometryType.CYLINDER}
                    onChange={(e) => {
                        const newType = e.target.value;
                        const currentDims = geomData.dimensions || { x: 0.1, y: 0.5, z: 0.1 };
                        let newDims = { ...currentDims };
                        let newOrigin = geomData.origin || { xyz: {x:0,y:0,z:0}, rpy: {r:0,p:0,y:0} };
                        
                        // Adjust dimensions when switching geometry types
                        if (newType === GeometryType.CYLINDER) {
                            // Smart conversion: Detect dominant axis and rotate cylinder to match
                            // Preserve existing rotation by composing it
                            const { x, y, z } = currentDims;
                            const maxDim = Math.max(x, y, z);
                            
                            let length = maxDim;
                            let radius = 0.1;
                            
                            // Get current rotation
                            const currentRpy = geomData.origin?.rpy || { r: 0, p: 0, y: 0 };
                            const currentQuat = new THREE.Quaternion().setFromEuler(
                                new THREE.Euler(currentRpy.r, currentRpy.p, currentRpy.y, 'XYZ')
                            );

                            const zAxis = new THREE.Vector3(0, 0, 1);
                            let targetAxis = new THREE.Vector3(0, 0, 1);

                            // Determine orientation based on longest dimension
                            if (x === maxDim) {
                                length = x;
                                radius = Math.max(y, z) / 2;
                                targetAxis.set(1, 0, 0);
                            } else if (y === maxDim) {
                                length = y;
                                radius = Math.max(x, z) / 2;
                                targetAxis.set(0, 1, 0);
                            } else {
                                length = z;
                                radius = Math.max(x, y) / 2;
                                targetAxis.set(0, 0, 1);
                            }
                            
                            // Calculate alignment rotation (from Z to Target Axis)
                            const alignQuat = new THREE.Quaternion().setFromUnitVectors(zAxis, targetAxis);
                            
                            // Compose: New = Old * Align
                            currentQuat.multiply(alignQuat);
                            
                            const newEuler = new THREE.Euler().setFromQuaternion(currentQuat, 'XYZ');
                            const newRpy = { r: newEuler.x, p: newEuler.y, y: newEuler.z };
                            
                            const newDims = { x: radius, y: length, z: radius };
                            
                            update({ 
                                type: newType, 
                                dimensions: newDims,
                                origin: { ...(geomData.origin || { xyz: {x:0,y:0,z:0} }), rpy: newRpy }
                            });
                            return; 
                        } else if (newType === GeometryType.SPHERE) {
                            // Use average dimension as radius
                            const radius = Math.max(0.05, (currentDims.x + currentDims.y + currentDims.z) / 3);
                            newDims = { x: radius, y: radius, z: radius };
                        } else if (newType === GeometryType.BOX) {
                            // If coming from cylinder, convert radius/length back to box
                            if (geomData.type === GeometryType.CYLINDER) {
                                newDims = { x: currentDims.x * 2, y: currentDims.x * 2, z: currentDims.y };
                            } else if (geomData.type === GeometryType.SPHERE) {
                                const diameter = currentDims.x * 2;
                                newDims = { x: diameter, y: diameter, z: diameter };
                            }
                        }
                        
                        update({ type: newType, dimensions: newDims, origin: newOrigin });
                    }}
                    className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                >
                    <option value={GeometryType.BOX}>Box</option>
                    <option value={GeometryType.CYLINDER}>Cylinder</option>
                    <option value={GeometryType.SPHERE}>Sphere</option>
                    <option value={GeometryType.MESH}>Mesh (File)</option>
                    <option value={GeometryType.NONE}>{t.none}</option>
                </select>
            </InputGroup>

            {/* Mesh Selection UI */}
            {geomData.type === GeometryType.MESH && (
                <div className="mb-4 bg-slate-100 dark:bg-google-dark-surface p-2 rounded-lg border border-slate-200 dark:border-google-dark-border">
                    <InputGroup label={t.meshLibrary}>
                        <div className="flex flex-col gap-2">
                             <div className="flex items-center gap-2">
                                <input 
                                    type="file" 
                                    ref={fileInputRef} 
                                    className="hidden" 
                                    accept=".stl,.STL,.obj,.OBJ,.dae,.DAE"
                                    onChange={handleFileChange}
                                />
                                <button 
                                    onClick={() => fileInputRef.current?.click()}
                                    className="flex items-center gap-1 bg-google-blue hover:bg-blue-600 text-white text-xs px-2 py-1 rounded transition-colors"
                                >
                                    <Upload className="w-3 h-3" />
                                    {t.upload}
                                </button>
                             </div>

                             <div className="max-h-32 overflow-y-auto custom-scrollbar flex flex-col gap-1 mt-1">
                                {Object.keys(assets).length === 0 && (
                                    <div className="text-[10px] text-slate-500 italic"></div>
                                )}
                                {Object.keys(assets).map(filename => (
                                    <div 
                                        key={filename}
                                        onClick={() => update({ meshPath: filename })}
                                        className={`
                                            flex items-center gap-2 p-1.5 rounded cursor-pointer text-xs
                                            ${geomData.meshPath === filename ? 'bg-blue-100 dark:bg-blue-900/50 text-google-blue dark:text-blue-200 border border-blue-200 dark:border-blue-800' : 'hover:bg-slate-200 dark:hover:bg-google-dark-bg text-slate-700 dark:text-slate-300'}
                                        `}
                                    >
                                        <File className="w-3 h-3 shrink-0" />
                                        <span className="truncate">{filename}</span>
                                    </div>
                                ))}
                             </div>
                             {geomData.meshPath && (
                                 <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-1">
                                     {t.selected}: <span className="text-google-blue dark:text-blue-400">{geomData.meshPath}</span>
                                 </div>
                             )}
                        </div>
                    </InputGroup>
                </div>
            )}

            {geomData.type !== GeometryType.MESH && geomData.type !== GeometryType.NONE && (
                <InputGroup label={t.dimensions}>
                    <Vec3Input 
                        value={geomData.dimensions || {x:0,y:0,z:0}} 
                        onChange={(v: any) => update({ dimensions: v })}
                        labels={['X/Rad', 'Y/Len', 'Z']}
                    />
                </InputGroup>
            )}

            {geomData.type !== GeometryType.NONE && (
                <InputGroup label={t.originRelativeLink}>
                    <div className="space-y-2">
                    <div className="text-[10px] text-slate-400">{t.position}</div>
                    <Vec3Input 
                        value={geomData.origin?.xyz || {x:0, y:0, z:0}}
                        onChange={(v: any) => update({ 
                            origin: { ...(geomData.origin || { rpy: {r:0,p:0,y:0} }), xyz: v } 
                        })}
                        labels={['X', 'Y', 'Z']}
                    />
                    <div className="text-[10px] text-slate-400 mt-2">{t.rotation}</div>
                    <Vec3Input 
                        value={geomData.origin?.rpy || {r:0, p:0, y:0}}
                        onChange={(v: any) => update({ 
                            origin: { ...(geomData.origin || { xyz: {x:0,y:0,z:0} }), rpy: v } 
                        })}
                        labels={[t.roll, t.pitch, t.yaw]}
                        keys={['r', 'p', 'y']}
                    />
                    </div>
                </InputGroup>
            )}

            {category === 'visual' && geomData.type !== GeometryType.NONE && (
                <InputGroup label={t.color}>
                    <div className="flex gap-2">
                        <input 
                            type="color" 
                            value={geomData.color || '#ffffff'}
                            onChange={(e) => update({ color: e.target.value })}
                            className="h-8 w-8 rounded cursor-pointer border-none p-0 bg-transparent"
                        />
                        <input 
                            type="text"
                            value={geomData.color || '#ffffff'}
                            onChange={(e) => update({ color: e.target.value })}
                            className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white flex-1"
                        />
                    </div>
                </InputGroup>
            )}
        </div>
    );
};

export const PropertyEditor: React.FC<PropertyEditorProps> = ({ 
  robot, 
  onUpdate, 
  mode, 
  assets, 
  onUploadAsset, 
  motorLibrary, 
  lang, 
  collapsed, 
  onToggle, 
  theme 
}) => {
  const { selection } = robot;
  const isLink = selection.type === 'link';
  const data = selection.id ? (isLink ? robot.links[selection.id] : robot.joints[selection.id]) : null;
  const t = translations[lang];

  // Width state for resizable sidebar
  const [width, setWidth] = useState(320);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Compute the actual width to use based on collapsed state
  // Force a minimum width of 280px when expanded to prevent "squashed" content
  const displayWidth = collapsed ? 40 : Math.max(width, 280);

  // Local state for Motor Brand selection
  const [motorBrand, setMotorBrand] = useState<string>('');

  useEffect(() => {
    // Initialize default brand if empty or invalid
    if (Object.keys(motorLibrary).length > 0) {
      if (!motorBrand || !motorLibrary[motorBrand]) {
        setMotorBrand(Object.keys(motorLibrary)[0]);
      }
    }
  }, [motorLibrary, motorBrand]);

  useEffect(() => {
    // When selection changes, attempt to infer brand if the motor is in library
    if (data && !isLink) {
      const type = (data as any).hardware?.motorType;
      if (type) {
        for (const [brand, motors] of Object.entries(motorLibrary)) {
          if (motors.some(m => m.name === type)) {
            setMotorBrand(brand);
            break;
          }
        }
      }
    }
  }, [selection.id, isLink, data, motorLibrary]);

  // Resize handler callback
  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  // Resize mouse move/up effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - e.clientX;
      const newWidth = Math.max(250, Math.min(800, startWidth.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // --- MOTOR LOGIC ---
  const currentMotorType = (data as any)?.hardware?.motorType || 'None';
  
  // Determine Mode: 'None', 'Library' (if in LIBRARY), or 'Custom'
  let motorSource = 'Custom';
  if (currentMotorType === 'None') {
    motorSource = 'None';
  } else {
    let foundInLib = false;
    for (const motors of Object.values(motorLibrary)) {
      if (motors.some(m => m.name === currentMotorType)) {
        foundInLib = true;
        break;
      }
    }
    if (foundInLib) motorSource = 'Library';
  }
  
  // Helper to find current library motor object
  const currentLibMotor = motorSource === 'Library' && motorBrand 
    ? motorLibrary[motorBrand]?.find(m => m.name === currentMotorType) 
    : null;

  const handleSourceChange = (newSource: string) => {
    let updates = {};
    const newHardware = { ...(data as any).hardware };
    const newLimit = { ...(data as any).limit };

    if (newSource === 'None') {
      newHardware.motorType = 'None';
      newHardware.armature = 0;
    } else if (newSource === 'Library') {
      const brands = Object.keys(motorLibrary);
      if (brands.length > 0) {
        const defaultBrand = brands[0];
        setMotorBrand(defaultBrand);
        const motor = motorLibrary[defaultBrand][0];
        if (motor) {
          newHardware.motorType = motor.name;
          newHardware.armature = motor.armature;
          newLimit.velocity = motor.velocity;
          newLimit.effort = motor.effort;
        }
      }
    } else if (newSource === 'Custom') {
      if (currentMotorType === 'None' || motorSource === 'Library') {
        newHardware.motorType = 'my_motor';
      }
    }
    
    updates = { hardware: newHardware, limit: newLimit };
    onUpdate('joint', selection.id!, { ...data, ...updates });
  };

  const handleBrandChange = (newBrand: string) => {
    setMotorBrand(newBrand);
    const motor = motorLibrary[newBrand]?.[0];
    if (motor) {
      const updates = {
        hardware: { ...(data as any).hardware, motorType: motor.name, armature: motor.armature },
        limit: { ...(data as any).limit, velocity: motor.velocity, effort: motor.effort }
      };
      onUpdate('joint', selection.id!, { ...data, ...updates });
    }
  };

  const handleLibraryMotorChange = (motorName: string) => {
    const motor = motorLibrary[motorBrand]?.find(m => m.name === motorName);
    if (motor) {
      const updates = {
        hardware: { ...(data as any).hardware, motorType: motor.name, armature: motor.armature },
        limit: { ...(data as any).limit, velocity: motor.velocity, effort: motor.effort }
      };
      onUpdate('joint', selection.id!, { ...data, ...updates });
    }
  };

  return (
    <div 
      className={`bg-slate-50 dark:bg-google-dark-bg border-l border-slate-200 dark:border-google-dark-border flex flex-col h-full z-20 relative ${collapsed ? 'items-center py-4' : ''}`}
      style={{ 
        width: `${displayWidth}px`, 
        minWidth: `${displayWidth}px`, 
        flex: `0 0 ${displayWidth}px`,
        overflow: 'hidden'
      }}
    >
      {collapsed ? (
        <button
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-google-dark-surface rounded transition-colors relative z-50 cursor-pointer"
          title={t.properties}
        >
          <PanelRightOpen className="w-5 h-5" />
        </button>
      ) : (
        <>
          <div className="w-full flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-google-dark-border bg-white dark:bg-google-dark-surface shrink-0 relative z-30">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
              className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-google-dark-surface rounded transition-colors shrink-0 cursor-pointer"
              title={t.collapseSidebar}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {data ? (
              <div className="flex items-center gap-2 flex-1 min-w-0 ml-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${isLink ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-200' : 'bg-orange-100 dark:bg-orange-900/50 text-orange-700 dark:text-orange-200'}`}>
                  {selection.type}
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white truncate">{data.name}</h2>
              </div>
            ) : (
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-2">{t.properties}</span>
            )}
          </div>

          {!data ? (
            <div className="w-full flex-1 flex items-center justify-center p-8 text-slate-500 text-center">
              <p>{t.selectLinkOrJoint}</p>
            </div>
          ) : (
            <div className="w-full flex-1 overflow-y-auto custom-scrollbar p-4 space-y-6">
        
        {/* --- LINK PROPERTIES --- */}
        
        {/* --- LINK PROPERTIES --- */}
        {isLink ? (
            <>
                {/* Link Name is always visible */}
                <InputGroup label={t.name}>
                    <input
                        type="text"
                        value={data.name}
                        onChange={(e) => onUpdate('link', selection.id!, { ...data, name: e.target.value })}
                        className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:border-google-blue focus:outline-none"
                    />
                </InputGroup>

                {/* Detail Mode: Visual & Collision */}
                {mode === 'detail' && (
                  <>
                      <GeometryEditor 
                        data={data}
                        robot={robot} 
                        category="visual" 
                        onUpdate={(d) => onUpdate('link', selection.id!, d)}
                        assets={assets}
                        onUploadAsset={onUploadAsset}
                        t={t}
                      />
                      <GeometryEditor 
                        data={data}
                        robot={robot} 
                        category="collision" 
                        onUpdate={(d) => onUpdate('link', selection.id!, d)}
                        assets={assets}
                        onUploadAsset={onUploadAsset} 
                        t={t}
                      />
                  </>
                )}
                
                {/* Hardware Mode: Inertial */}
                {mode === 'hardware' && (
                  <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 mb-3">{t.inertial}</h3>
                      <InputGroup label={t.mass}>
                          <NumberInput 
                              value={(data as UrdfLink).inertial.mass}
                              onChange={(v: number) => onUpdate('link', selection.id!, { 
                                  ...data, 
                                  inertial: { ...(data as UrdfLink).inertial, mass: v } 
                              })}
                          />
                      </InputGroup>
                      
                      {/* Center of Mass (Origin) */}
                      <InputGroup label={t.centerOfMass || "Center of Mass"}>
                          <div className="space-y-2">
                              <div>
                                  <span className="text-[10px] text-slate-500 mb-0.5 block">Position (xyz)</span>
                                  <Vec3Input
                                      value={(data as UrdfLink).inertial.origin?.xyz || { x: 0, y: 0, z: 0 }}
                                      onChange={(xyz: any) => onUpdate('link', selection.id!, {
                                          ...data,
                                          inertial: {
                                              ...(data as UrdfLink).inertial,
                                              origin: {
                                                  xyz: xyz,
                                                  rpy: (data as UrdfLink).inertial.origin?.rpy || { r: 0, p: 0, y: 0 }
                                              }
                                          }
                                      })}
                                      labels={['X', 'Y', 'Z']}
                                  />
                              </div>
                              <div>
                                  <span className="text-[10px] text-slate-500 mb-0.5 block">Orientation (rpy)</span>
                                  <Vec3Input
                                      value={(data as UrdfLink).inertial.origin?.rpy || { r: 0, p: 0, y: 0 }}
                                      onChange={(rpy: any) => onUpdate('link', selection.id!, {
                                          ...data,
                                          inertial: {
                                              ...(data as UrdfLink).inertial,
                                              origin: {
                                                  xyz: (data as UrdfLink).inertial.origin?.xyz || { x: 0, y: 0, z: 0 },
                                                  rpy: rpy
                                              }
                                          }
                                      })}
                                      labels={['R', 'P', 'Y']}
                                      keys={['r', 'p', 'y']}
                                  />
                              </div>
                          </div>
                      </InputGroup>
                      
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-4 mb-2">{t.inertiaTensor}</h4>
                      <div className="grid grid-cols-3 gap-2">
                          <NumberInput 
                              label="ixx" 
                              value={(data as UrdfLink).inertial.inertia.ixx} 
                              onChange={(v) => onUpdate('link', selection.id!, { 
                                  ...data, 
                                  inertial: { ...(data as UrdfLink).inertial, inertia: { ...(data as UrdfLink).inertial.inertia, ixx: v } }
                              })} 
                          />
                          <NumberInput 
                              label="ixy" 
                              value={(data as UrdfLink).inertial.inertia.ixy} 
                              onChange={(v) => onUpdate('link', selection.id!, { 
                                  ...data, 
                                  inertial: { ...(data as UrdfLink).inertial, inertia: { ...(data as UrdfLink).inertial.inertia, ixy: v } }
                              })} 
                          />
                          <NumberInput 
                              label="ixz" 
                              value={(data as UrdfLink).inertial.inertia.ixz} 
                              onChange={(v) => onUpdate('link', selection.id!, { 
                                  ...data, 
                                  inertial: { ...(data as UrdfLink).inertial, inertia: { ...(data as UrdfLink).inertial.inertia, ixz: v } }
                              })} 
                          />
                          <NumberInput 
                              label="iyy" 
                              value={(data as UrdfLink).inertial.inertia.iyy} 
                              onChange={(v) => onUpdate('link', selection.id!, { 
                                  ...data, 
                                  inertial: { ...(data as UrdfLink).inertial, inertia: { ...(data as UrdfLink).inertial.inertia, iyy: v } }
                              })} 
                          />
                          <NumberInput 
                              label="iyz" 
                              value={(data as UrdfLink).inertial.inertia.iyz} 
                              onChange={(v) => onUpdate('link', selection.id!, { 
                                  ...data, 
                                  inertial: { ...(data as UrdfLink).inertial, inertia: { ...(data as UrdfLink).inertial.inertia, iyz: v } }
                              })} 
                          />
                          <NumberInput 
                              label="izz" 
                              value={(data as UrdfLink).inertial.inertia.izz} 
                              onChange={(v) => onUpdate('link', selection.id!, { 
                                  ...data, 
                                  inertial: { ...(data as UrdfLink).inertial, inertia: { ...(data as UrdfLink).inertial.inertia, izz: v } }
                              })} 
                          />
                      </div>
                  </div>
                )}
            </>
        ) : (
            // --- JOINT PROPERTIES ---
            <>
                {/* Detail Mode: Name Only */}
                {mode === 'detail' && (
                    <InputGroup label={t.name}>
                        <input
                            type="text"
                            value={data.name}
                            onChange={(e) => onUpdate('joint', selection.id!, { ...data, name: e.target.value })}
                            className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:border-google-blue focus:outline-none"
                        />
                    </InputGroup>
                )}

                {/* Skeleton Mode: Kinematics Only */}
                {mode === 'skeleton' && (
                    <>
                        <InputGroup label={t.type}>
                            <select 
                                value={(data as any).type}
                                onChange={(e) => onUpdate('joint', selection.id!, { ...data, type: e.target.value })}
                                className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                            >
                                <option value={JointType.REVOLUTE}>Revolute</option>
                                <option value={JointType.CONTINUOUS}>Continuous</option>
                                <option value={JointType.PRISMATIC}>Prismatic</option>
                                <option value={JointType.FIXED}>Fixed</option>
                            </select>
                        </InputGroup>

                        <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 mb-3">{t.kinematics}</h3>
                            <InputGroup label={t.originRelativeParent + " (XYZ)"}>
                                <Vec3Input 
                                    value={(data as any).origin.xyz}
                                    onChange={(v: any) => onUpdate('joint', selection.id!, { 
                                        ...data, 
                                        origin: { ...(data as any).origin, xyz: v } 
                                    })}
                                    labels={['X', 'Y', 'Z']}
                                />
                            </InputGroup>
                            <InputGroup label={t.originRelativeParent + " (RPY)"}>
                                <Vec3Input 
                                    value={(data as any).origin.rpy}
                                    onChange={(v: any) => onUpdate('joint', selection.id!, { 
                                        ...data, 
                                        origin: { ...(data as any).origin, rpy: v } 
                                    })}
                                    labels={[t.roll, t.pitch, t.yaw]}
                                    keys={['r', 'p', 'y']}
                                />
                            </InputGroup>
                            
                            {(data as any).type !== JointType.FIXED && (
                                <InputGroup label={t.axisRotation}>
                                    <Vec3Input 
                                        value={(data as any).axis}
                                        onChange={(v: any) => onUpdate('joint', selection.id!, { ...data, axis: v })}
                                        labels={['X', 'Y', 'Z']}
                                    />
                                </InputGroup>
                            )}
                        </div>
                    </>
                )}

                {/* Hardware Mode: Limits, Dynamics, Motor */}
                {mode === 'hardware' && (data as any).type !== JointType.FIXED && (
                    <>
                         {/* 1. Hardware Section (Moved to Top) */}
                        <div className="border-t border-slate-200 dark:border-google-dark-border pt-4">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 mb-3">{t.hardwareConfig}</h3>
                            
                            <InputGroup label={t.motorSource}>
                                <select
                                    value={motorSource}
                                    onChange={(e) => handleSourceChange(e.target.value)}
                                    className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                                >
                                    <option value="None">{t.none}</option>
                                    <option value="Library">{t.library}</option>
                                    <option value="Custom">{t.custom}</option>
                                </select>
                            </InputGroup>

                            {motorSource === 'Library' && (
                                <div className="space-y-4 pl-2 border-l-2 border-slate-200 dark:border-google-dark-border mb-4">
                                     <InputGroup label={t.brand}>
                                        <select
                                            value={motorBrand}
                                            onChange={(e) => handleBrandChange(e.target.value)}
                                            className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                                        >
                                            {Object.keys(motorLibrary).map(brand => (
                                                <option key={brand} value={brand}>{brand}</option>
                                            ))}
                                        </select>
                                    </InputGroup>
                                    <InputGroup label={t.model}>
                                        <select
                                            value={currentMotorType}
                                            onChange={(e) => handleLibraryMotorChange(e.target.value)}
                                            className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                                        >
                                            {motorLibrary[motorBrand]?.map(m => (
                                                <option key={m.name} value={m.name}>{m.name}</option>
                                            ))}
                                        </select>
                                    </InputGroup>

                                    {currentLibMotor && currentLibMotor.url && (
                                        <div className="mt-2">
                                            <a 
                                                href={currentLibMotor.url} 
                                                target="_blank" 
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 transition-colors"
                                            >
                                                {t.viewMotor}
                                                <ExternalLink className="w-3 h-3" />
                                            </a>
                                        </div>
                                    )}
                                </div>
                            )}

                            {motorSource === 'Custom' && (
                                <InputGroup label={t.customType}>
                                    <input
                                        type="text"
                                        placeholder={t.enterMotorType}
                                        value={currentMotorType}
                                        onChange={(e) => onUpdate('joint', selection.id!, { 
                                            ...data, hardware: { ...(data as any).hardware, motorType: e.target.value } 
                                        })}
                                        className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:outline-none focus:border-google-blue"
                                    />
                                </InputGroup>
                            )}

                            {motorSource !== 'None' && (
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        <InputGroup label={t.motorId}>
                                            <input
                                                type="text"
                                                value={(data as any).hardware?.motorId || ''}
                                                onChange={(e) => onUpdate('joint', selection.id!, { 
                                                    ...data, hardware: { ...(data as any).hardware, motorId: e.target.value } 
                                                })}
                                                className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:outline-none focus:border-google-blue"
                                            />
                                        </InputGroup>
                                        <InputGroup label={t.direction}>
                                            <select 
                                                value={(data as any).hardware?.motorDirection || 1}
                                                onChange={(e) => onUpdate('joint', selection.id!, { 
                                                    ...data, hardware: { ...(data as any).hardware, motorDirection: parseInt(e.target.value) } 
                                                })}
                                                className="bg-white dark:bg-google-dark-surface border border-slate-300 dark:border-google-dark-border rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                                            >
                                                <option value={1}>1 ({t.normal})</option>
                                                <option value={-1}>-1 ({t.inverted})</option>
                                            </select>
                                        </InputGroup>
                                    </div>
                                    
                                    <InputGroup label={t.armature}>
                                        <NumberInput 
                                            value={(data as any).hardware?.armature || 0}
                                            onChange={(v: number) => onUpdate('joint', selection.id!, { 
                                                ...data, hardware: { ...(data as any).hardware, armature: v } 
                                            })}
                                        />
                                    </InputGroup>
                                </>
                            )}
                        </div>

                        {/* 2. Limits */}
                        <div className="border-t border-slate-200 dark:border-google-dark-border pt-4">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 mb-3">{t.limits}</h3>
                            <div className="grid grid-cols-2 gap-2">
                                <InputGroup label={t.lower}>
                                    <NumberInput 
                                        value={(data as any).limit.lower}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, { 
                                            ...data, limit: { ...(data as any).limit, lower: v } 
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.upper}>
                                    <NumberInput 
                                        value={(data as any).limit.upper}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, { 
                                            ...data, limit: { ...(data as any).limit, upper: v } 
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.velocity}>
                                    <NumberInput 
                                        value={(data as any).limit.velocity}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, { 
                                            ...data, limit: { ...(data as any).limit, velocity: v } 
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.effort}>
                                    <NumberInput 
                                        value={(data as any).limit.effort}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, { 
                                            ...data, limit: { ...(data as any).limit, effort: v } 
                                        })}
                                    />
                                </InputGroup>
                            </div>
                        </div>

                        {/* 3. Dynamics */}
                        <div className="border-t border-slate-200 dark:border-google-dark-border pt-4">
                            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 mb-3">{t.dynamics}</h3>
                            <div className="grid grid-cols-2 gap-2">
                                <InputGroup label={t.friction}>
                                    <NumberInput 
                                        value={(data as any).dynamics?.friction || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, { 
                                            ...data, dynamics: { ...(data as any).dynamics, friction: v } 
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.damping}>
                                    <NumberInput 
                                        value={(data as any).dynamics?.damping || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, { 
                                            ...data, dynamics: { ...(data as any).dynamics, damping: v } 
                                        })}
                                    />
                                </InputGroup>
                            </div>
                        </div>
                    </>
                )}
            </>
        )}
            </div>
          )}

          {/* Resize Handle - only show when expanded */}
          <div 
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors z-10"
            onMouseDown={handleResizeMouseDown}
          />
        </>
      )}
    </div>
  );
};