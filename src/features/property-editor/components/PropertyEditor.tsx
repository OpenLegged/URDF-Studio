/**
 * PropertyEditor - Link and Joint property editing panel
 * Features: Visual/Collision geometry, Inertial properties, Joint kinematics, Hardware config
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Upload, File, Wand, ExternalLink, ChevronRight, PanelRightOpen, Eye, Box, ChevronDown, ChevronLeft } from 'lucide-react';
import * as THREE from 'three';
import type { RobotState, JointType, AppMode, UrdfLink, MotorSpec, Theme } from '@/types';
import { GeometryType } from '@/types';
import { translations } from '@/shared/i18n';
import type { Language } from '@/store';

// ============================================================
// REUSABLE THREE OBJECTS - Avoid allocation in render functions
// ============================================================
const _tempVec3A = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();
const _tempVec3C = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempEuler = new THREE.Euler();
const _zAxis = new THREE.Vector3(0, 0, 1);

export interface PropertyEditorProps {
  robot: RobotState;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  onSelect?: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onHover?: (type: 'link' | 'joint' | null, id: string | null, subType?: 'visual' | 'collision') => void;
  mode: AppMode;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  collapsed?: boolean;
  onToggle?: () => void;
  theme: Theme;
}

const InputGroup = ({ label, children, className = "" }: { label: string, children?: React.ReactNode, className?: string }) => (
  <div className={`mb-3 ${className}`}>
    <label className="block text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1 font-semibold">{label}</label>
    {children}
  </div>
);

const CollapsibleSection = ({ title, children, defaultOpen = true, className = "", storageKey }: { title: string, children: React.ReactNode, defaultOpen?: boolean, className?: string, storageKey?: string }) => {
  const [isOpen, setIsOpen] = useState(() => {
    if (storageKey && typeof window !== 'undefined') {
      const saved = localStorage.getItem(`collapse_state_${storageKey}`);
      if (saved !== null) return saved === 'true';
    }
    return defaultOpen;
  });

  const toggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    if (storageKey && typeof window !== 'undefined') {
      localStorage.setItem(`collapse_state_${storageKey}`, String(newState));
    }
  };

  return (
    <div className={`border border-slate-200 dark:border-[#000000] rounded-lg overflow-hidden ${className}`}>
      <button
        className="w-full flex items-center justify-between p-2 bg-slate-50 dark:bg-[#2C2C2E] hover:bg-slate-100 dark:hover:bg-[#3A3A3C] transition-colors text-xs font-bold text-slate-700 dark:text-slate-300"
        onClick={toggle}
      >
        <span>{title}</span>
        {isOpen ? <ChevronDown className="w-3 h-3 opacity-60" /> : <ChevronRight className="w-3 h-3 opacity-60" />}
      </button>
      {isOpen && <div className="p-3 bg-white dark:bg-[#000000] border-t border-slate-200 dark:border-[#000000]">{children}</div>}
    </div>
  );
};

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
        className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-google-blue w-full"
      />
    </div>
  );
};

interface Vec3Value {
  x?: number;
  y?: number;
  z?: number;
  r?: number;
  p?: number;
}

const Vec3Input = ({ value, onChange, labels, keys = ['x', 'y', 'z'] }: {
  value: Vec3Value;
  onChange: (v: Vec3Value) => void;
  labels: string[];
  keys?: string[];
}) => (
  <div className="grid grid-cols-3 gap-2">
    <NumberInput
        label={labels[0]}
        value={(value as Record<string, number>)[keys[0]] ?? 0}
        onChange={(v: number) => onChange({ ...value, [keys[0]]: v })}
    />
    <NumberInput
        label={labels[1]}
        value={(value as Record<string, number>)[keys[1]] ?? 0}
        onChange={(v: number) => onChange({ ...value, [keys[1]]: v })}
    />
    <NumberInput
        label={labels[2]}
        value={(value as Record<string, number>)[keys[2]] ?? 0}
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
  t,
  isTabbed = false
}: {
  data: UrdfLink;
  robot: RobotState;
  category: 'visual' | 'collision';
  onUpdate: (d: UrdfLink) => void;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  t: typeof translations['en'];
  isTabbed?: boolean;
}) => {
    const geomData = data[category] || {} as any;
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Ensure nested objects exist if they are missing
    const update = (newData: Partial<typeof geomData>) => {
        onUpdate({ ...data, [category]: { ...geomData, ...newData } });
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onUploadAsset(e.target.files[0]);
        }
    };

    // Memoized auto-align calculation to avoid repeated THREE object allocation
    const autoAlignResult = useMemo(() => {
       const childJoint = Object.values(robot.joints).find(j => j.parentLinkId === data.id);
       if (!childJoint) return null;

       // Use reusable vectors to avoid allocation
       _tempVec3A.set(childJoint.origin.xyz.x, childJoint.origin.xyz.y, childJoint.origin.xyz.z);
       const length = _tempVec3A.length();
       _tempVec3B.copy(_tempVec3A).multiplyScalar(0.5); // midpoint
       _tempVec3C.copy(_tempVec3A).normalize(); // direction

       // Calculate rotation to align Z-axis with the vector
       if (_tempVec3C.y === 0 && _tempVec3C.x === 0 && _tempVec3C.z === -1) {
            _tempQuat.setFromAxisAngle(_tempVec3A.set(1, 0, 0), Math.PI);
       } else {
            _tempQuat.setFromUnitVectors(_zAxis, _tempVec3C);
       }

       _tempEuler.setFromQuaternion(_tempQuat);

       return {
           dimensions: { y: length },
           origin: {
               xyz: { x: _tempVec3B.x, y: _tempVec3B.y, z: _tempVec3B.z },
               rpy: { r: _tempEuler.x, p: _tempEuler.y, y: _tempEuler.z }
           }
       };
    }, [robot.joints, data.id]);

    const handleAutoAlign = () => {
       if (!autoAlignResult) return;

       const currentDims = geomData.dimensions || { x: 0.05, y: 0.5, z: 0.05 };
       const newDims = { ...currentDims, y: autoAlignResult.dimensions.y };

       update({
          dimensions: newDims,
          origin: autoAlignResult.origin
       });
    };

    return (
        <div className={isTabbed ? "pt-2" : "border-t border-slate-200 dark:border-slate-700 pt-4"}>
            <div className={`flex items-center justify-between ${isTabbed ? 'mb-2' : 'mb-3'}`}>
                {!isTabbed && <h3 className="text-sm font-bold text-slate-900 dark:text-slate-200 capitalize">{category === 'visual' ? t.visualGeometry : t.collisionGeometry}</h3>}
                {isTabbed && <div />} {/* Spacer */}
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
                        const newType = e.target.value as GeometryType;
                        const currentDims = geomData.dimensions || { x: 0.1, y: 0.5, z: 0.1 };
                        let newDims = { ...currentDims };
                        const newOrigin = geomData.origin || { xyz: {x:0,y:0,z:0}, rpy: {r:0,p:0,y:0} };

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
                            const targetAxis = new THREE.Vector3(0, 0, 1);

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

                            const convertedDims = { x: radius, y: length, z: radius };

                            update({
                                type: newType,
                                dimensions: convertedDims,
                                origin: { ...(geomData.origin || { xyz: {x:0,y:0,z:0} }), rpy: newRpy }
                            });
                            return;
                        } else if (newType === GeometryType.SPHERE) {
                            // Use average dimension as radius
                            const sphereRadius = Math.max(0.05, (currentDims.x + currentDims.y + currentDims.z) / 3);
                            newDims = { x: sphereRadius, y: sphereRadius, z: sphereRadius };
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
                    className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                >
                    <option value={GeometryType.BOX}>{t.box}</option>
                    <option value={GeometryType.CYLINDER}>{t.cylinder}</option>
                    <option value={GeometryType.SPHERE}>{t.sphere}</option>
                    <option value={GeometryType.MESH}>{t.mesh}</option>
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
                                            ${geomData.meshPath === filename ? 'bg-blue-100 dark:bg-[#0060FA] text-google-blue dark:text-white border border-blue-200 dark:border-transparent' : 'hover:bg-slate-200 dark:hover:bg-google-dark-bg text-slate-700 dark:text-slate-300'}
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

            {/* Box dimensions: Width (X), Depth (Y), Height (Z) */}
            {geomData.type === GeometryType.BOX && (
                <InputGroup label={t.dimensions}>
                    <div className="grid grid-cols-3 gap-2">
                        <NumberInput
                            label={t.width || 'Width (X)'}
                            value={geomData.dimensions?.x || 0.1}
                            onChange={(v: number) => update({ dimensions: { ...geomData.dimensions, x: v } })}
                            step={0.01}
                        />
                        <NumberInput
                            label={t.depth || 'Depth (Y)'}
                            value={geomData.dimensions?.y || 0.1}
                            onChange={(v: number) => update({ dimensions: { ...geomData.dimensions, y: v } })}
                            step={0.01}
                        />
                        <NumberInput
                            label={t.height || 'Height (Z)'}
                            value={geomData.dimensions?.z || 0.1}
                            onChange={(v: number) => update({ dimensions: { ...geomData.dimensions, z: v } })}
                            step={0.01}
                        />
                    </div>
                </InputGroup>
            )}

            {/* Sphere dimensions: Radius only */}
            {geomData.type === GeometryType.SPHERE && (
                <InputGroup label={t.dimensions}>
                    <NumberInput
                        label={t.radius || 'Radius'}
                        value={geomData.dimensions?.x || 0.1}
                        onChange={(v: number) => update({ dimensions: { x: v, y: v, z: v } })}
                        step={0.01}
                    />
                </InputGroup>
            )}

            {/* Cylinder dimensions: Radius and Height */}
            {geomData.type === GeometryType.CYLINDER && (
                <InputGroup label={t.dimensions}>
                    <div className="grid grid-cols-2 gap-2">
                        <NumberInput
                            label={t.radius || 'Radius'}
                            value={geomData.dimensions?.x || 0.05}
                            onChange={(v: number) => update({ dimensions: { ...geomData.dimensions, x: v, z: v } })}
                            step={0.01}
                        />
                        <NumberInput
                            label={t.height || 'Height'}
                            value={geomData.dimensions?.y || 0.5}
                            onChange={(v: number) => update({ dimensions: { ...geomData.dimensions, y: v } })}
                            step={0.01}
                        />
                    </div>
                </InputGroup>
            )}

            {geomData.type !== GeometryType.NONE && (
                <InputGroup label={t.originRelativeLink}>
                    <div className="space-y-2">
                    <div className="text-[10px] text-slate-400">{t.position}</div>
                    <Vec3Input
                        value={geomData.origin?.xyz || {x:0, y:0, z:0}}
                        onChange={(v) => update({
                            origin: { ...(geomData.origin || { rpy: {r:0,p:0,y:0} }), xyz: v as { x: number; y: number; z: number } }
                        })}
                        labels={['X', 'Y', 'Z']}
                    />
                    <div className="text-[10px] text-slate-400 mt-2">{t.rotation}</div>
                    <Vec3Input
                        value={geomData.origin?.rpy || {r:0, p:0, y:0}}
                        onChange={(v) => update({
                            origin: { ...(geomData.origin || { xyz: {x:0,y:0,z:0} }), rpy: v as { r: number; p: number; y: number } }
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
  onSelect,
  onHover,
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

  // Tab state for Link properties (Visual vs Collision)
  const [linkTab, setLinkTab] = useState<'visual' | 'collision'>('visual');

  // Sync internal tab state with global selection subType
  useEffect(() => {
      if (selection.subType) {
          setLinkTab(selection.subType);
      }
  }, [selection.subType]);

  const handleTabChange = (tab: 'visual' | 'collision') => {
      setLinkTab(tab);
      if (selection.id && onSelect) {
          onSelect('link', selection.id, tab);
      }
  };

  // Width state for resizable sidebar
  const [width, setWidth] = useState(320);
  const [isDragging, setIsDragging] = useState(false);
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  // Compute the actual width to use based on collapsed state
  // Force a minimum width of 280px when expanded to prevent "squashed" content
  const displayWidth = collapsed ? 0 : Math.max(width, 280);

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
      const type = (data as { hardware?: { motorType?: string } }).hardware?.motorType;
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
    setIsDragging(true);
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
      setIsDragging(false);
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
  const jointData = data as { hardware?: { motorType?: string; armature?: number; motorId?: string; motorDirection?: number }; limit?: { velocity?: number; effort?: number; lower?: number; upper?: number }; type?: string; dynamics?: { friction?: number; damping?: number }; origin?: { xyz: { x: number; y: number; z: number }; rpy: { r: number; p: number; y: number } }; axis?: { x: number; y: number; z: number } } | null;
  const currentMotorType = jointData?.hardware?.motorType || 'None';

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
    const newHardware = { ...jointData?.hardware };
    const newLimit = { ...jointData?.limit };

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

    const updates = { hardware: newHardware, limit: newLimit };
    onUpdate('joint', selection.id!, { ...data, ...updates });
  };

  const handleBrandChange = (newBrand: string) => {
    setMotorBrand(newBrand);
    const motor = motorLibrary[newBrand]?.[0];
    if (motor) {
      const updates = {
        hardware: { ...jointData?.hardware, motorType: motor.name, armature: motor.armature },
        limit: { ...jointData?.limit, velocity: motor.velocity, effort: motor.effort }
      };
      onUpdate('joint', selection.id!, { ...data, ...updates });
    }
  };

  const handleLibraryMotorChange = (motorName: string) => {
    const motor = motorLibrary[motorBrand]?.find(m => m.name === motorName);
    if (motor) {
      const updates = {
        hardware: { ...jointData?.hardware, motorType: motor.name, armature: motor.armature },
        limit: { ...jointData?.limit, velocity: motor.velocity, effort: motor.effort }
      };
      onUpdate('joint', selection.id!, { ...data, ...updates });
    }
  };

  // Joint type constants
  const JOINT_TYPE_REVOLUTE = 'revolute';
  const JOINT_TYPE_CONTINUOUS = 'continuous';
  const JOINT_TYPE_PRISMATIC = 'prismatic';
  const JOINT_TYPE_FIXED = 'fixed';

  return (
    <div
      className={`bg-slate-50 dark:bg-google-dark-bg border-l border-slate-200 dark:border-google-dark-border flex flex-col h-full z-20 relative will-change-[width,flex] ${isDragging ? '' : 'transition-[width,min-width,flex] duration-200 ease-out'}`}
      style={{
        width: `${displayWidth}px`,
        minWidth: `${displayWidth}px`,
        flex: `0 0 ${displayWidth}px`,
        overflow: 'visible'
      }}
    >
      {/* Side Toggle Button (Centered & Protruding Left) */}
      <button
          onClick={(e) => { e.stopPropagation(); onToggle?.(); }}
          className="absolute -left-4 top-1/2 -translate-y-1/2 w-4 h-16 bg-white dark:bg-[#2C2C2E] hover:bg-blue-500 dark:hover:bg-blue-600 hover:text-white border border-slate-300 dark:border-[#000000] rounded-l-lg shadow-md flex flex-col items-center justify-center z-50 cursor-pointer text-slate-400 hover:text-white transition-all group"
          title={collapsed ? t.properties : t.collapseSidebar}
      >
          <div className="flex flex-col gap-0.5 items-center">
            <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-200" />
            {collapsed ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <div className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600 group-hover:bg-blue-200" />
          </div>
      </button>

      <div className="h-full w-full overflow-hidden flex flex-col relative bg-slate-50 dark:bg-google-dark-bg">
        <div style={{ width: `${Math.max(width, 280)}px`, minWidth: `${Math.max(width, 280)}px` }} className="h-full flex flex-col">
          <div className="w-full flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-google-dark-border bg-white dark:bg-[#2C2C2E] shrink-0 relative z-30">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.properties}</span>
            {data && (
              <div className="flex items-center gap-2 flex-1 min-w-0 ml-2">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 ${isLink ? 'bg-blue-100 dark:bg-slate-700 text-blue-700 dark:text-slate-300' : 'bg-orange-100 dark:bg-slate-700 text-orange-700 dark:text-slate-300'}`}>
                  {selection.type}
                </span>
                <h2 className="font-semibold text-slate-900 dark:text-white truncate">{data.name}</h2>
              </div>
            )}
          </div>

          {!data ? (
            <div className="w-full flex-1 flex items-center justify-center p-8 text-slate-500 text-center">
              <p>{t.selectLinkOrJoint}</p>
            </div>
          ) : (
            <div className="w-full flex-1 overflow-y-auto custom-scrollbar p-3 space-y-4">

        {/* --- LINK PROPERTIES --- */}

        {/* --- LINK PROPERTIES --- */}
        {isLink ? (
            <>
                {/* Global Name (Skeleton & Hardware Mode) */}
                {mode !== 'detail' && (
                    <InputGroup label={t.name}>
                        <input
                            type="text"
                            value={data.name}
                            onChange={(e) => onUpdate('link', selection.id!, { ...data, name: e.target.value })}
                            className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:border-google-blue focus:outline-none"
                        />
                    </InputGroup>
                )}

                {/* Detail Mode: Visual & Collision Tabs */}
                {mode === 'detail' && (
                  <>
                      {/* Tab Navigation - Folder Style */}
                      <div className="flex items-end gap-1 border-t border-x border-b border-slate-200 dark:border-[#000000] mb-0 bg-slate-100/50 dark:bg-[#000000] pt-1 px-1 rounded-t-lg">
                        <div className="w-px"></div>
                        <button
                          onClick={() => handleTabChange('visual')}
                          className={`flex-1 py-2 text-xs font-bold rounded-t-lg transition-all flex items-center justify-center gap-2 relative border-t border-x ${
                            linkTab === 'visual'
                              ? 'bg-white dark:bg-google-dark-surface text-blue-600 dark:text-blue-400 border-slate-200 dark:border-slate-700 -mb-px pb-2.5 z-10'
                              : 'bg-transparent border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {t.visualGeometry}
                        </button>
                        <button
                          onClick={() => handleTabChange('collision')}
                          className={`flex-1 py-2 text-xs font-bold rounded-t-lg transition-all flex items-center justify-center gap-2 relative border-t border-x ${
                            linkTab === 'collision'
                              ? 'bg-white dark:bg-google-dark-surface text-blue-600 dark:text-blue-400 border-slate-200 dark:border-slate-700 -mb-px pb-2.5 z-10'
                              : 'bg-transparent border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-200/50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <Box className="w-3.5 h-3.5" />
                          {t.collisionGeometry}
                        </button>
                      </div>

                      {/* Visual Tab Content */}
                      {linkTab === 'visual' && (
                        <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 bg-white dark:bg-google-dark-surface border-x border-b border-slate-200 dark:border-slate-700 rounded-b-lg p-3 shadow-sm mb-4">
                            <InputGroup label={t.name}>
                                <input
                                    type="text"
                                    value={data.name}
                                    onChange={(e) => onUpdate('link', selection.id!, { ...data, name: e.target.value })}
                                    className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:border-google-blue focus:outline-none"
                                />
                            </InputGroup>

                            <GeometryEditor
                                data={data as UrdfLink}
                                robot={robot}
                                category="visual"
                                onUpdate={(d) => onUpdate('link', selection.id!, d)}
                                assets={assets}
                                onUploadAsset={onUploadAsset}
                                t={t}
                                isTabbed={true}
                            />
                        </div>
                      )}

                      {/* Collision Tab Content */}
                      {linkTab === 'collision' && (
                        <div className="animate-in fade-in slide-in-from-bottom-1 duration-200 bg-white dark:bg-google-dark-surface border-x border-b border-slate-200 dark:border-slate-700 rounded-b-lg p-3 shadow-sm mb-4">
                            <GeometryEditor
                                data={data as UrdfLink}
                                robot={robot}
                                category="collision"
                                onUpdate={(d) => onUpdate('link', selection.id!, d)}
                                assets={assets}
                                onUploadAsset={onUploadAsset}
                                t={t}
                                isTabbed={true}
                            />
                        </div>
                      )}
                  </>
                )}

                {/* Hardware Mode: Inertial */}
                {mode === 'hardware' && (
                  <CollapsibleSection title={t.inertial} storageKey="inertial">
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
                                  <span className="text-[10px] text-slate-500 mb-0.5 block">{t.position}</span>
                                  <Vec3Input
                                      value={(data as UrdfLink).inertial.origin?.xyz || { x: 0, y: 0, z: 0 }}
                                      onChange={(xyz) => onUpdate('link', selection.id!, {
                                          ...data,
                                          inertial: {
                                              ...(data as UrdfLink).inertial,
                                              origin: {
                                                  xyz: xyz as { x: number; y: number; z: number },
                                                  rpy: (data as UrdfLink).inertial.origin?.rpy || { r: 0, p: 0, y: 0 }
                                              }
                                          }
                                      })}
                                      labels={['X', 'Y', 'Z']}
                                  />
                              </div>
                              <div>
                                  <span className="text-[10px] text-slate-500 mb-0.5 block">{t.rotation}</span>
                                  <Vec3Input
                                      value={(data as UrdfLink).inertial.origin?.rpy || { r: 0, p: 0, y: 0 }}
                                      onChange={(rpy) => onUpdate('link', selection.id!, {
                                          ...data,
                                          inertial: {
                                              ...(data as UrdfLink).inertial,
                                              origin: {
                                                  xyz: (data as UrdfLink).inertial.origin?.xyz || { x: 0, y: 0, z: 0 },
                                                  rpy: rpy as { r: number; p: number; y: number }
                                              }
                                          }
                                      })}
                                      labels={[t.roll, t.pitch, t.yaw]}
                                      keys={['r', 'p', 'y']}
                                  />
                              </div>
                          </div>
                      </InputGroup>

                      <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <h4 className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2 uppercase">{t.inertiaTensor}</h4>
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
                  </CollapsibleSection>
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
                            className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:border-google-blue focus:outline-none"
                        />
                    </InputGroup>
                )}

                {/* Skeleton Mode: Kinematics Only */}
                {mode === 'skeleton' && (
                    <>
                        <InputGroup label={t.type}>
                            <select
                                value={jointData?.type || JOINT_TYPE_REVOLUTE}
                                onChange={(e) => onUpdate('joint', selection.id!, { ...data, type: e.target.value })}
                                className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                            >
                                <option value={JOINT_TYPE_REVOLUTE}>Revolute</option>
                                <option value={JOINT_TYPE_CONTINUOUS}>Continuous</option>
                                <option value={JOINT_TYPE_PRISMATIC}>Prismatic</option>
                                <option value={JOINT_TYPE_FIXED}>Fixed</option>
                            </select>
                        </InputGroup>

                        <CollapsibleSection title={t.kinematics} storageKey="kinematics">
                            <InputGroup label={t.originRelativeParent + " (XYZ)"}>
                                <Vec3Input
                                    value={jointData?.origin?.xyz || { x: 0, y: 0, z: 0 }}
                                    onChange={(v) => onUpdate('joint', selection.id!, {
                                        ...data,
                                        origin: { ...jointData?.origin, xyz: v }
                                    })}
                                    labels={['X', 'Y', 'Z']}
                                />
                            </InputGroup>
                            <InputGroup label={t.originRelativeParent + " (RPY)"}>
                                <Vec3Input
                                    value={jointData?.origin?.rpy || { r: 0, p: 0, y: 0 }}
                                    onChange={(v) => onUpdate('joint', selection.id!, {
                                        ...data,
                                        origin: { ...jointData?.origin, rpy: v }
                                    })}
                                    labels={[t.roll, t.pitch, t.yaw]}
                                    keys={['r', 'p', 'y']}
                                />
                            </InputGroup>

                            {jointData?.type !== JOINT_TYPE_FIXED && (
                                <InputGroup label={t.axisRotation}>
                                    <Vec3Input
                                        value={jointData?.axis || { x: 0, y: 0, z: 1 }}
                                        onChange={(v) => onUpdate('joint', selection.id!, { ...data, axis: v })}
                                        labels={['X', 'Y', 'Z']}
                                    />
                                </InputGroup>
                            )}
                        </CollapsibleSection>
                    </>
                )}

                {/* Hardware Mode: Limits, Dynamics, Motor */}
                {mode === 'hardware' && jointData?.type !== JOINT_TYPE_FIXED && (
                    <div className="space-y-3">
                         {/* 1. Hardware Section */}
                        <CollapsibleSection title={t.hardwareConfig} storageKey="hardware_config">
                            <InputGroup label={t.motorSource}>
                                <select
                                    value={motorSource}
                                    onChange={(e) => handleSourceChange(e.target.value)}
                                    className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                                >
                                    <option value="None">{t.none}</option>
                                    <option value="Library">{t.library}</option>
                                    <option value="Custom">{t.custom}</option>
                                </select>
                            </InputGroup>

                            {motorSource === 'Library' && (
                                <div className="space-y-3 pl-2 border-l-2 border-slate-200 dark:border-google-dark-border mb-3">
                                     <InputGroup label={t.brand}>
                                        <select
                                            value={motorBrand}
                                            onChange={(e) => handleBrandChange(e.target.value)}
                                            className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
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
                                            className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
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
                                            ...data, hardware: { ...jointData?.hardware, motorType: e.target.value }
                                        })}
                                        className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:outline-none focus:border-google-blue"
                                    />
                                </InputGroup>
                            )}

                            {motorSource !== 'None' && (
                                <>
                                    <div className="grid grid-cols-2 gap-2">
                                        <InputGroup label={t.motorId}>
                                            <input
                                                type="text"
                                                value={jointData?.hardware?.motorId || ''}
                                                onChange={(e) => onUpdate('joint', selection.id!, {
                                                    ...data, hardware: { ...jointData?.hardware, motorId: e.target.value }
                                                })}
                                                className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full focus:outline-none focus:border-google-blue"
                                            />
                                        </InputGroup>
                                        <InputGroup label={t.direction}>
                                            <select
                                                value={jointData?.hardware?.motorDirection || 1}
                                                onChange={(e) => onUpdate('joint', selection.id!, {
                                                    ...data, hardware: { ...jointData?.hardware, motorDirection: parseInt(e.target.value) }
                                                })}
                                                className="bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#48484A] rounded-lg px-2 py-1 text-sm text-slate-900 dark:text-white w-full"
                                            >
                                                <option value={1}>1 ({t.normal})</option>
                                                <option value={-1}>-1 ({t.inverted})</option>
                                            </select>
                                        </InputGroup>
                                    </div>

                                    <InputGroup label={t.armature}>
                                        <NumberInput
                                            value={jointData?.hardware?.armature || 0}
                                            onChange={(v: number) => onUpdate('joint', selection.id!, {
                                                ...data, hardware: { ...jointData?.hardware, armature: v }
                                            })}
                                        />
                                    </InputGroup>
                                </>
                            )}
                        </CollapsibleSection>

                        {/* 2. Limits */}
                        <CollapsibleSection title={t.limits} storageKey="limits">
                            <div className="grid grid-cols-2 gap-2">
                                <InputGroup label={t.lower}>
                                    <NumberInput
                                        value={jointData?.limit?.lower || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, {
                                            ...data, limit: { ...jointData?.limit, lower: v }
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.upper}>
                                    <NumberInput
                                        value={jointData?.limit?.upper || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, {
                                            ...data, limit: { ...jointData?.limit, upper: v }
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.velocity}>
                                    <NumberInput
                                        value={jointData?.limit?.velocity || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, {
                                            ...data, limit: { ...jointData?.limit, velocity: v }
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.effort}>
                                    <NumberInput
                                        value={jointData?.limit?.effort || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, {
                                            ...data, limit: { ...jointData?.limit, effort: v }
                                        })}
                                    />
                                </InputGroup>
                            </div>
                        </CollapsibleSection>

                        {/* 3. Dynamics */}
                        <CollapsibleSection title={t.dynamics} defaultOpen={false} storageKey="dynamics">
                            <div className="grid grid-cols-2 gap-2">
                                <InputGroup label={t.friction}>
                                    <NumberInput
                                        value={jointData?.dynamics?.friction || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, {
                                            ...data, dynamics: { ...jointData?.dynamics, friction: v }
                                        })}
                                    />
                                </InputGroup>
                                <InputGroup label={t.damping}>
                                    <NumberInput
                                        value={jointData?.dynamics?.damping || 0}
                                        onChange={(v: number) => onUpdate('joint', selection.id!, {
                                            ...data, dynamics: { ...jointData?.dynamics, damping: v }
                                        })}
                                    />
                                </InputGroup>
                            </div>
                        </CollapsibleSection>
                    </div>
                )}
            </>
        )}
            </div>
          )}

        </div>
      </div>

      {/* Resize Handle - only show when expanded */}
      {!collapsed && (
        <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500/50 transition-colors z-40"
            onMouseDown={handleResizeMouseDown}
        />
      )}
    </div>
  );
};
