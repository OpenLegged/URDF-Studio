/**
 * URDF Viewer Component
 * Uses urdf-loader library for professional URDF rendering
 * Inspired by robot_viewer demo
 */

import React, { Suspense, useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Environment, GizmoHelper, GizmoViewport, Html, TransformControls } from '@react-three/drei';
import * as THREE from 'three';
// @ts-ignore
import URDFLoader from 'urdf-loader';
import { translations, Language } from '../services/i18n';

interface URDFViewerProps {
    urdfContent: string;
    assets: Record<string, string>; // filename -> blob URL
    onJointChange?: (jointName: string, angle: number) => void;
    lang: Language;
    mode?: 'detail' | 'hardware';
}

// Clean file path (remove '..' and '.', normalize slashes)
const cleanFilePath = (path: string): string => {
    return path
        .replace(/\\/g, '/')
        .split(/\//g)
        .reduce((acc: string[], el: string) => {
            if (el === '..') acc.pop();
            else if (el !== '.') acc.push(el);
            return acc;
        }, [])
        .join('/');
};

// Find file in assets by path with multiple strategies
const findAssetByPath = (path: string, assets: Record<string, string>, urdfDir: string = ''): string | null => {
    // Strategy 0: Direct match
    if (assets[path]) return assets[path];
    
    // Clean the path first
    let cleanPath = path.replace(/\\/g, '/');
    
    // Remove blob: prefix if present
    cleanPath = cleanPath.replace(/^blob:[^\/]+\//, '');
    
    // Remove package:// prefix
    if (cleanPath.startsWith('package://')) {
        cleanPath = cleanPath.replace(/^package:\/\//, '');
        // Remove package name (first segment)
        const parts = cleanPath.split('/');
        if (parts.length > 1) {
            cleanPath = parts.slice(1).join('/');
        }
    }
    
    // Remove leading ./
    cleanPath = cleanPath.replace(/^\.\//, '');
    
    // Normalize path (handle ../)
    const normalizedPath = cleanFilePath(cleanPath);
    
    // Build full path based on URDF directory
    const fullPath = urdfDir + normalizedPath;
    
    // Strategy 1: Full path match
    if (assets[fullPath]) return assets[fullPath];
    
    // Strategy 2: Normalized path match
    if (assets[normalizedPath]) return assets[normalizedPath];
    
    // Strategy 3: Clean path match
    if (assets[cleanPath]) return assets[cleanPath];
    
    // Strategy 4: Filename only match
    const filename = normalizedPath.split('/').pop() || '';
    if (assets[filename]) return assets[filename];
    
    // Strategy 5: Case-insensitive filename match
    const lowerFilename = filename.toLowerCase();
    const foundKey = Object.keys(assets).find(k => k.toLowerCase() === lowerFilename);
    if (foundKey) return assets[foundKey];
    
    // Strategy 6: Path suffix match
    for (const key of Object.keys(assets)) {
        const keyLower = key.toLowerCase();
        const searchLower = normalizedPath.toLowerCase();
        if (keyLower.endsWith(searchLower) || searchLower.endsWith(keyLower.split('/').pop() || '')) {
            return assets[key];
        }
    }
    
    // Strategy 7: Fuzzy matching (suffix matching)
    const cleaned = cleanFilePath(normalizedPath);
    for (const key of Object.keys(assets)) {
        const cleanedKey = cleanFilePath(key);
        const len = Math.min(cleanedKey.length, cleaned.length);
        if (len > 0 && cleaned.substring(cleaned.length - len) === cleanedKey.substring(cleanedKey.length - len)) {
            return assets[key];
        }
    }
    
    return null;
};

// Loading manager that resolves asset URLs from our blob storage
const createLoadingManager = (assets: Record<string, string>, urdfDir: string = '') => {
    const manager = new THREE.LoadingManager();
    
    manager.setURLModifier((url: string) => {
        // If already a blob/data URL, return as-is
        if (url.startsWith('blob:') || url.startsWith('data:')) {
            // Check if it's a malformed blob URL
            const blobMatch = url.match(/^blob:https?:\/\/[^\/]+\/(.+)$/);
            if (blobMatch && blobMatch[1]) {
                const fileName = blobMatch[1];
                // If it looks like a filename, it's malformed
                if (/\.(jpg|jpeg|png|gif|bmp|tga|tiff|webp|dae|stl|obj|gltf|glb)$/i.test(fileName)) {
                    const found = findAssetByPath(fileName, assets, urdfDir);
                    if (found) return found;
                }
            }
            return url;
        }
        
        const found = findAssetByPath(url, assets, urdfDir);
        if (found) return found;
        
        console.warn('[URDFViewer] Asset not found:', url);
        return url;
    });
    
    return manager;
};

// Custom mesh loader callback
const createMeshLoader = (assets: Record<string, string>, manager: THREE.LoadingManager, urdfDir: string = '') => {
    return async (
        path: string,
        _manager: THREE.LoadingManager,
        done: (result: THREE.Object3D | null, err?: Error) => void
    ) => {
        try {
            // Find the asset URL using our path resolver
            const assetUrl = findAssetByPath(path, assets, urdfDir);
            
            if (!assetUrl) {
                console.warn('[URDFViewer] Mesh not found:', path);
                done(null, new Error(`Mesh not found: ${path}`));
                return;
            }
            
            // Determine extension from path or asset key
            const filename = path.split('/').pop() || path;
            const ext = filename.split('.').pop()?.toLowerCase();
            
            let meshObject: THREE.Object3D | null = null;
            
            if (ext === 'stl') {
                const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
                const loader = new STLLoader(manager);
                const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                // Use MeshPhongMaterial to match URDFLoader behavior
                const material = new THREE.MeshPhongMaterial({ color: 0xaaaaaa });
                meshObject = new THREE.Mesh(geometry, material);
                
            } else if (ext === 'dae') {
                const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
                const loader = new ColladaLoader(manager);
                const result = await new Promise<any>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                meshObject = result.scene;
                
                // Remove lights from Collada (they can mess up scene lighting)
                if (meshObject) {
                    const lightsToRemove: THREE.Object3D[] = [];
                    meshObject.traverse((child: THREE.Object3D) => {
                        if ((child as any).isLight) {
                            lightsToRemove.push(child);
                        }
                    });
                    lightsToRemove.forEach(light => light.parent?.remove(light));
                }
                
            } else if (ext === 'obj') {
                const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
                const loader = new OBJLoader(manager);
                meshObject = await new Promise<THREE.Group>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                
            } else if (ext === 'gltf' || ext === 'glb') {
                const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
                const loader = new GLTFLoader(manager);
                const gltfModel = await new Promise<any>((resolve, reject) => {
                    loader.load(assetUrl, resolve, undefined, reject);
                });
                meshObject = gltfModel.scene;
            }
            
            if (meshObject) {
                done(meshObject);
            } else {
                done(null, new Error(`Unsupported mesh format: ${ext}`));
            }
            
        } catch (error) {
            console.error('[URDFViewer] Mesh loading error:', error);
            done(null, error as Error);
        }
    };
};

// Enhance materials for better lighting (from robot_viewer)
const enhanceMaterials = (robotObject: THREE.Object3D) => {
    robotObject.traverse((child: any) => {
        if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) {
                child.material = child.material.map((mat: THREE.Material) => enhanceSingleMaterial(mat));
            } else {
                child.material = enhanceSingleMaterial(child.material);
            }
            
            // Enable shadows
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
};

const enhanceSingleMaterial = (material: THREE.Material): THREE.Material => {
    if ((material as any).isMeshPhongMaterial || (material as any).isMeshStandardMaterial) {
        const mat = material as THREE.MeshPhongMaterial;
        
        // Increase shininess for better highlights
        if (mat.shininess === undefined || mat.shininess < 50) {
            mat.shininess = 50;
        }
        
        // Enhance specular reflection
        if (!mat.specular) {
            mat.specular = new THREE.Color(0.3, 0.3, 0.3);
        } else if (mat.specular.isColor && mat.specular.r < 0.2) {
            mat.specular.setRGB(0.3, 0.3, 0.3);
        }
        
        mat.needsUpdate = true;
        return mat;
        
    } else if ((material as any).isMeshBasicMaterial) {
        // Convert to Phong for better lighting
        const oldMat = material as THREE.MeshBasicMaterial;
        const newMat = new THREE.MeshPhongMaterial({
            color: oldMat.color,
            map: oldMat.map,
            transparent: oldMat.transparent,
            opacity: oldMat.opacity,
            side: oldMat.side,
            shininess: 50,
            specular: new THREE.Color(0.3, 0.3, 0.3)
        });
        return newMat;
    }
    
    return material;
};

interface RobotModelProps {
    urdfContent: string;
    assets: Record<string, string>;
    onRobotLoaded?: (robot: any) => void;
    showCollision?: boolean;
}

function RobotModel({ urdfContent, assets, onRobotLoaded, showCollision = false }: RobotModelProps) {
    const [robot, setRobot] = useState<THREE.Object3D | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { scene } = useThree();
    
    // Update collision visibility when showCollision changes
    useEffect(() => {
        if (!robot) return;
        
        robot.traverse((child: any) => {
            // urdf-loader marks collision meshes with isURDFCollider
            if (child.isURDFCollider) {
                child.visible = showCollision;
                if (showCollision) {
                    // Apply purple wireframe material to all meshes inside the collider group
                    child.traverse((innerChild: any) => {
                        if (innerChild.isMesh) {
                            innerChild.material = new THREE.MeshStandardMaterial({
                                color: '#a855f7', // Purple-500
                                wireframe: true,
                                transparent: true,
                                opacity: 0.3,
                                side: THREE.FrontSide,
                                polygonOffset: true,
                                polygonOffsetFactor: -1,
                                polygonOffsetUnits: -1
                            });

                            // Increase geometry segments for denser wireframe
                            if (innerChild.geometry) {
                                const geom = innerChild.geometry;
                                if (geom.type === 'BoxGeometry' && geom.parameters) {
                                    const { width, height, depth } = geom.parameters;
                                    innerChild.geometry = new THREE.BoxGeometry(width, height, depth, 2, 2, 2);
                                } else if (geom.type === 'CylinderGeometry' && geom.parameters) {
                                    const { radiusTop, radiusBottom, height, radialSegments } = geom.parameters;
                                    innerChild.geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments || 32, 1);
                                }
                            }
                        }
                    });
                }
            }
        });
    }, [robot, showCollision]);
    
    useEffect(() => {
        if (!urdfContent) return;
        
        const loadRobot = async () => {
            try {
                // Extract URDF directory from assets paths for relative path resolution
                const urdfDir = '';
                
                const manager = createLoadingManager(assets, urdfDir);
                const loader = new URDFLoader(manager);
                
                // Enable collision parsing
                loader.parseCollision = true;
                
                // Setup custom mesh loader with urdfDir
                loader.loadMeshCb = createMeshLoader(assets, manager, urdfDir);
                
                // Setup package resolver
                loader.packages = (pkg: string) => {
                    // Return empty string since we handle paths in mesh loader
                    return '';
                };
                
                // Parse URDF from string
                const robotModel = loader.parse(urdfContent);
                
                if (robotModel) {
                    // Enhance materials for better rendering
                    enhanceMaterials(robotModel);
                    
                    // No rotation needed - camera already uses Z-up coordinate system
                    
                    // Hide collision meshes by default
                    robotModel.traverse((child: any) => {
                        if (child.isURDFCollider) {
                            child.visible = false;
                        }
                    });
                    
                    setRobot(robotModel);
                    setError(null);
                    
                    if (onRobotLoaded) {
                        onRobotLoaded(robotModel);
                    }
                }
            } catch (err) {
                console.error('[URDFViewer] Failed to load URDF:', err);
                setError(err instanceof Error ? err.message : 'Unknown error');
            }
        };
        
        loadRobot();
        
        return () => {
            // Cleanup
            if (robot) {
                robot.traverse((child: any) => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) {
                        if (Array.isArray(child.material)) {
                            child.material.forEach((m: THREE.Material) => m.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                });
            }
        };
    }, [urdfContent, assets]);
    
    if (error) {
        return (
            <Html center>
                <div className="bg-red-900/80 text-red-200 px-4 py-2 rounded text-sm">
                    Error: {error}
                </div>
            </Html>
        );
    }
    
    if (!robot) {
        return (
            <Html center>
                <div className="text-slate-400 text-sm">Loading robot...</div>
            </Html>
        );
    }
    
    return <primitive object={robot} />;
}

// Scene lighting setup - inspired by robot_viewer EnvironmentManager
function SceneLighting() {
    const { scene, gl } = useThree();
    
    useEffect(() => {
        // Setup environment map for material reflections
        const pmremGenerator = new THREE.PMREMGenerator(gl);
        pmremGenerator.compileEquirectangularShader();
        
        // Create a simple environment scene
        const envScene = new THREE.Scene();
        const envLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        envScene.add(envLight);
        
        // Generate environment map
        const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
        envMap.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = envMap;
        
        return () => {
            pmremGenerator.dispose();
        };
    }, [scene, gl]);
    
    return (
        <>
            {/* Hemisphere light for ambient fill - increased intensity */}
            <hemisphereLight args={[0xffffff, 0x666666, 0.8]} position={[0, 0, 1]} />
            
            {/* Ambient light for base illumination */}
            <ambientLight intensity={0.4} />
            
            {/* Main directional light with shadows (front-top-right) */}
            <directionalLight
                position={[4, 4, 8]}
                intensity={Math.PI * 0.8}
                castShadow
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
                shadow-camera-near={0.1}
                shadow-camera-far={50}
                shadow-camera-left={-5}
                shadow-camera-right={5}
                shadow-camera-top={5}
                shadow-camera-bottom={-5}
                shadow-normalBias={0.001}
            />
            
            {/* Fill light from back-left */}
            <directionalLight
                position={[-4, -4, 6]}
                intensity={Math.PI * 0.4}
            />
            
            {/* Fill light from front-left */}
            <directionalLight
                position={[-4, 4, 4]}
                intensity={Math.PI * 0.3}
            />
            
            {/* Fill light from back-right */}
            <directionalLight
                position={[4, -4, 4]}
                intensity={Math.PI * 0.3}
            />
            
            {/* Top light */}
            <directionalLight
                position={[0, 0, 10]}
                intensity={Math.PI * 0.2}
            />
            
            {/* Bottom fill light (subtle) */}
            <directionalLight
                position={[0, 0, -5]}
                intensity={Math.PI * 0.15}
            />
            
            {/* Ground plane for shadows - Z-up coordinate system */}
            <mesh 
                rotation={[0, 0, 0]} 
                position={[0, 0, -0.02]} 
                receiveShadow
            >
                <planeGeometry args={[100, 100]} />
                <shadowMaterial transparent opacity={0.15} side={THREE.DoubleSide} />
            </mesh>
        </>
    );
}

export function URDFViewer({ urdfContent, assets, onJointChange, lang, mode = 'detail' }: URDFViewerProps) {
    const t = translations[lang];
    const [robot, setRobot] = useState<any>(null);
    const [selectedJoint, setSelectedJoint] = useState<string | null>(null);
    
    // View settings - unified with Visualizer style
    const [showCollision, setShowCollision] = useState(false);
    const [showJointControls, setShowJointControls] = useState(true);
    
    // Draggable panel positions - use refs to track panel elements
    const containerRef = useRef<HTMLDivElement>(null);
    const optionsPanelRef = useRef<HTMLDivElement>(null);
    const jointPanelRef = useRef<HTMLDivElement>(null);
    const [optionsPanelPos, setOptionsPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [jointPanelPos, setJointPanelPos] = useState<{ x: number; y: number } | null>(null);
    const [dragging, setDragging] = useState<'options' | 'joints' | null>(null);
    const dragStartRef = useRef<{ mouseX: number; mouseY: number; panelX: number; panelY: number } | null>(null);
    const [isOptionsCollapsed, setIsOptionsCollapsed] = useState(false);
    const [isJointsCollapsed, setIsJointsCollapsed] = useState(false);
    
    // Joint control state
    const [jointAngles, setJointAngles] = useState<Record<string, number>>({});
    
    const handleRobotLoaded = useCallback((loadedRobot: any) => {
        setRobot(loadedRobot);
        
        // Initialize joint angles
        if (loadedRobot.joints) {
            const angles: Record<string, number> = {};
            Object.keys(loadedRobot.joints).forEach(name => {
                angles[name] = 0;
            });
            setJointAngles(angles);
        }
    }, []);
    
    const handleJointAngleChange = useCallback((jointName: string, angle: number) => {
        if (!robot?.joints?.[jointName]) return;
        
        const joint = robot.joints[jointName];
        if (joint.setJointValue) {
            joint.setJointValue(angle);
        }
        
        setJointAngles(prev => ({ ...prev, [jointName]: angle }));
        
        if (onJointChange) {
            onJointChange(jointName, angle);
        }
    }, [robot, onJointChange]);
    
    // Drag handlers for panels - fixed offset calculation
    const handleMouseDown = useCallback((panel: 'options' | 'joints', e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        const panelRef = panel === 'options' ? optionsPanelRef : jointPanelRef;
        if (!panelRef.current || !containerRef.current) return;
        
        const rect = panelRef.current.getBoundingClientRect();
        const containerRect = containerRef.current.getBoundingClientRect();

        dragStartRef.current = {
            mouseX: e.clientX,
            mouseY: e.clientY,
            panelX: rect.left - containerRect.left,
            panelY: rect.top - containerRect.top
        };
        setDragging(panel);
    }, []);
    
    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!dragging || !dragStartRef.current) return;
        
        const deltaX = e.clientX - dragStartRef.current.mouseX;
        const deltaY = e.clientY - dragStartRef.current.mouseY;
        
        const newX = dragStartRef.current.panelX + deltaX;
        const newY = dragStartRef.current.panelY + deltaY;
        
        if (dragging === 'options') {
            setOptionsPanelPos({ x: newX, y: newY });
        } else {
            setJointPanelPos({ x: newX, y: newY });
        }
    }, [dragging]);
    
    const handleMouseUp = useCallback(() => {
        setDragging(null);
        dragStartRef.current = null;
    }, []);
    
    return (
        <div 
            ref={containerRef}
            className="flex-1 relative bg-slate-900 h-full overflow-hidden"
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
        >
            {/* Info overlay - unified with Visualizer style */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none select-none">
                <div className="text-slate-400 text-xs bg-slate-900/50 backdrop-blur px-2 py-1 rounded border border-slate-800">
                    {mode === 'hardware' ? t.hardware : t.detail} Mode
                </div>
            </div>

            {/* Settings panel - draggable */}
            <div 
                ref={optionsPanelRef}
                className="absolute z-10 pointer-events-auto"
                style={optionsPanelPos 
                    ? { left: optionsPanelPos.x, top: optionsPanelPos.y, right: 'auto' }
                    : { top: '16px', right: '16px' }
                }
            >
                <div className="bg-slate-800/80 backdrop-blur rounded border border-slate-700 flex flex-col w-48 shadow-xl overflow-hidden">
                    <div 
                        className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-700/50 hover:bg-slate-700 select-none flex items-center justify-between"
                        onMouseDown={(e) => handleMouseDown('options', e)}
                    >
                        <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                            </svg>
                            {mode === 'hardware' ? 'Hardware Options' : 'Detail Options'}
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsOptionsCollapsed(!isOptionsCollapsed); }}
                            className="text-slate-400 hover:text-white p-1 hover:bg-slate-600 rounded"
                        >
                            {isOptionsCollapsed ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                            )}
                        </button>
                    </div>
                    
                    {!isOptionsCollapsed && (
                    <div className="px-2 pb-2 pt-1 flex flex-col gap-2">
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-white px-1">
                            <input 
                                type="checkbox" 
                                checked={showJointControls} 
                                onChange={(e) => setShowJointControls(e.target.checked)}
                                className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                            />
                            Show Joint Controls
                        </label>
                        
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer hover:text-white px-1">
                            <input 
                                type="checkbox" 
                                checked={showCollision} 
                                onChange={(e) => setShowCollision(e.target.checked)}
                                className="rounded bg-slate-700 border-slate-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                            />
                            Show Collision
                        </label>
                    </div>
                    )}
                </div>
            </div>
            
            {/* Joint controls panel - draggable */}
            {showJointControls && robot?.joints && Object.keys(robot.joints).length > 0 && (
                <div 
                    ref={jointPanelRef}
                    className="absolute z-10 bg-slate-800/90 backdrop-blur rounded border border-slate-700 max-h-[50vh] overflow-hidden w-64 shadow-xl flex flex-col pointer-events-auto"
                    style={jointPanelPos 
                        ? { left: jointPanelPos.x, top: jointPanelPos.y, right: 'auto', bottom: 'auto' }
                        : { bottom: '16px', right: '16px' }
                    }
                >
                    <div 
                        className="text-[10px] text-slate-500 uppercase font-bold tracking-wider px-3 py-2 cursor-move bg-slate-700/50 hover:bg-slate-700 select-none flex items-center justify-between flex-shrink-0"
                        onMouseDown={(e) => handleMouseDown('joints', e)}
                    >
                        <div className="flex items-center gap-2">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path d="M7 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM13 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
                            </svg>
                            Joint Controls
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsJointsCollapsed(!isJointsCollapsed); }}
                            className="text-slate-400 hover:text-white p-1 hover:bg-slate-600 rounded"
                        >
                            {isJointsCollapsed ? (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            ) : (
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                            )}
                        </button>
                    </div>
                    {!isJointsCollapsed && (
                    <div className="p-3 overflow-y-auto flex-1">
                    <div className="space-y-2">
                        {Object.entries(robot.joints)
                            .filter(([_, joint]: [string, any]) => joint.jointType !== 'fixed')
                            .map(([name, joint]: [string, any]) => {
                                const limit = joint.limit || { lower: -Math.PI, upper: Math.PI };
                                const value = jointAngles[name] || 0;
                                
                                return (
                                    <div key={name} className="space-y-1">
                                        <div className="flex justify-between text-xs">
                                            <span className="text-slate-300 truncate" title={name}>
                                                {name}
                                            </span>
                                            <span className="text-slate-500">
                                                {(value * 180 / Math.PI).toFixed(1)}°
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min={limit.lower}
                                            max={limit.upper}
                                            step={0.01}
                                            value={value}
                                            onChange={(e) => handleJointAngleChange(name, parseFloat(e.target.value))}
                                            className="w-full h-1 bg-slate-600 rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>
                                );
                            })}
                    </div>
                    </div>
                    )}
                </div>
            )}
            
            <Canvas
                camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 50 }}
                shadows
                gl={{ 
                    antialias: true,
                    toneMapping: THREE.ACESFilmicToneMapping,
                    toneMappingExposure: 1.0,
                }}
            >
                <SceneLighting />
                <Environment preset="city" />
                
                <Suspense fallback={null}>
                    <RobotModel
                        urdfContent={urdfContent}
                        assets={assets}
                        onRobotLoaded={handleRobotLoaded}
                        showCollision={showCollision}
                    />
                </Suspense>
                
                <Grid 
                    infiniteGrid 
                    fadeDistance={10} 
                    cellColor={'#475569'} 
                    sectionColor={'#64748b'} 
                    rotation={[Math.PI / 2, 0, 0]}
                    position={[0, 0, -0.01]} 
                />
                
                <OrbitControls
                    makeDefault
                    enableDamping={false}
                    minDistance={0.5}
                    maxDistance={20}
                />
                
                <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
                    <GizmoViewport labelColor="white" axisHeadScale={1} />
                </GizmoHelper>
            </Canvas>
        </div>
    );
}

export default URDFViewer;
