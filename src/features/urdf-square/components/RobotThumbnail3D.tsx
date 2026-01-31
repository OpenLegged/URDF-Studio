/**
 * RobotThumbnail3D - Mini 3D preview for URDF Square
 * Pure real-time rendering with continuous rotation
 */

import React, { Suspense, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import * as THREE from 'three';
// @ts-ignore
import URDFLoader from 'urdf-loader';
import { Box, Loader2 } from 'lucide-react';
import { SceneLighting, ReferenceGrid } from '@/shared/components/3d';
import { createLoadingManager, createMeshLoader, buildAssetIndex, resetUnitDetection } from '@/core/loaders';

interface RobotThumbnail3DProps {
  urdfPath: string;
  urdfFile?: string;
  theme?: 'light' | 'dark';
}

/**
 * RobotPreviewModel - Loads and displays URDF model with continuous rotation
 */
function RobotPreviewModel({ 
  urdfPath,
  urdfFile,
  theme
}: { 
  urdfPath: string;
  urdfFile?: string;
  theme: 'light' | 'dark';
}) {
  const [robot, setRobot] = useState<THREE.Object3D | null>(null);
  const [loading, setLoading] = useState(true);
  const [fullyLoaded, setFullyLoaded] = useState(false);
  const [error, setError] = useState(false);
  const groupRef = useRef<THREE.Group>(null);
  const { invalidate, camera } = useThree();
  const loadedRef = useRef(false);
  const robotRef = useRef<THREE.Object3D | null>(null);
  const fullyLoadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;

    const loadRobot = async () => {
      try {
        // 1. Fetch manifest.json
        const manifestUrl = `${urdfPath}/manifest.json`;
        const manifestRes = await fetch(manifestUrl);
        
        if (!manifestRes.ok) {
          console.error('[RobotThumbnail3D] Failed to fetch manifest:', urdfPath);
          setError(true);
          setLoading(false);
          return;
        }
        
        const files: string[] = await manifestRes.json();
        
        // 2. Find URDF file - use prop if provided, otherwise find from manifest
        const targetUrdfFile = urdfFile || files.find(f => f.toLowerCase().endsWith('.urdf'));
        if (!targetUrdfFile) {
          console.error('[RobotThumbnail3D] No URDF file found in manifest:', urdfPath);
          setError(true);
          setLoading(false);
          return;
        }

        // 3. Fetch all files and create blob URLs (asset map)
        const assets: Record<string, string> = {};
        
        await Promise.all(files.map(async (filePath) => {
          try {
            const res = await fetch(`${urdfPath}/${filePath}`);
            if (res.ok) {
              const blob = await res.blob();
              const blobUrl = URL.createObjectURL(blob);
              assets[filePath] = blobUrl;
              // Also map filename only
              const fileName = filePath.split('/').pop()!;
              if (!assets[fileName]) {
                assets[fileName] = blobUrl;
              }
            }
          } catch (e) {
            // Ignore individual file fetch errors
          }
        }));

        // 4. Fetch URDF content
        const urdfRes = await fetch(`${urdfPath}/${targetUrdfFile}`);
        if (!urdfRes.ok) {
          console.error('[RobotThumbnail3D] Failed to fetch URDF:', targetUrdfFile);
          setError(true);
          setLoading(false);
          return;
        }
        const urdfContent = await urdfRes.text();

        // 5. Setup URDFLoader
        resetUnitDetection();
        const assetIndex = buildAssetIndex(assets, '');
        const manager = createLoadingManager(assets, '');
        const meshLoader = createMeshLoader(assets, manager, '', assetIndex);

        let pendingLoads = 0;
        const originalOnStart = manager.onStart;
        manager.onStart = (url, loaded, total) => {
          pendingLoads++;
          if (originalOnStart) originalOnStart(url, loaded, total);
        };

        // When ALL meshes are loaded, finalize the robot
        manager.onLoad = () => {
          const loadedRobot = robotRef.current;
          if (!loadedRobot || fullyLoadedRef.current) return;

          // Small delay to ensure geometries are fully computed
          setTimeout(() => {
            if (fullyLoadedRef.current) return;
            finalizeRobot(loadedRobot);
          }, 50);
        };
        
        const finalizeRobot = (loadedRobot: THREE.Object3D) => {
          // Apply material styling
          loadedRobot.traverse((child: any) => {
            if (child.isMesh) {
              if (child.material) {
                const mat = child.material;
                if (mat.isMeshStandardMaterial || mat.isMeshPhongMaterial) {
                  mat.roughness = 0.5;
                  mat.metalness = 0.1;
                }
              }
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });

          // Recalculate bounds
          const box = new THREE.Box3().setFromObject(loadedRobot);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          
          // Check for invalid bounding box (can happen with some URDF models)
          const isValidBox = box.min.x !== Infinity && box.max.x !== -Infinity &&
                            !isNaN(center.x) && !isNaN(center.y) && !isNaN(center.z) &&
                            size.x > 0 && size.y > 0 && size.z > 0;
          
          if (!isValidBox) {
            console.warn('[RobotThumbnail3D] Invalid bounding box, using defaults');
            // Use default positioning for invalid boxes
            loadedRobot.position.set(0, 0, 0);
            camera.position.set(2, 2, 1);
            camera.lookAt(0, 0, 0.5);
            camera.updateProjectionMatrix();
          } else {
            const minZ = box.min.z;
            
            // Center and place on ground
            loadedRobot.position.set(-center.x, -center.y, -minZ);

            // Auto-fit camera
            const aspectRatio = size.z / Math.max(size.x, size.y, 0.01);
            const isHumanoid = aspectRatio > 2.0; // Tall robots
            const isLargeQuadruped = size.x > 0.8 || size.y > 0.8; // Large quadrupeds like B2
            const maxDim = Math.max(size.x, size.y, size.z);
            const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
            const fitDistance = (maxDim / 2) / Math.tan(fov / 2);
            // Adjust multiplier based on robot type
            let distanceMultiplier = 1.8;
            if (isHumanoid) {
              distanceMultiplier = 1.2;
            } else if (isLargeQuadruped) {
              distanceMultiplier = 2.2; // Pull camera back more for large robots
            }
            const cameraDistance = Math.max(fitDistance * distanceMultiplier, 0.5);
            
            const robotCenterZ = size.z / 2;
            camera.position.set(
              cameraDistance * 0.8,
              cameraDistance * 0.8,
              robotCenterZ + cameraDistance * 0.4
            );
            camera.lookAt(0, 0, robotCenterZ);
            camera.updateProjectionMatrix();
          }

          // Mark as fully loaded
          fullyLoadedRef.current = true;
          loadedRobot.visible = true;
          setFullyLoaded(true);
          setLoading(false);
          invalidate();
        };

        const loader = new URDFLoader(manager);
        loader.packages = '';
        loader.loadMeshCb = meshLoader;

        // 6. Parse URDF
        const loadedRobot = loader.parse(urdfContent);
        robotRef.current = loadedRobot;
        loadedRobot.visible = false;
        setRobot(loadedRobot);
        
        // Handle case where no meshes to load or meshes load instantly
        setTimeout(() => {
          if (!fullyLoadedRef.current && robotRef.current) {
            let hasMeshes = false;
            robotRef.current.traverse((c: any) => {
              if (c.isMesh) hasMeshes = true;
            });
            if (!hasMeshes || pendingLoads === 0) {
              manager.onLoad();
            }
          }
        }, 200);
        
        // Fallback timeout - force load after 3 seconds if still not loaded
        setTimeout(() => {
          if (!fullyLoadedRef.current && robotRef.current) {
            console.warn('[RobotThumbnail3D] Force loading after timeout:', urdfPath);
            manager.onLoad();
          }
        }, 3000);

      } catch (e) {
        console.error('[RobotThumbnail3D] Failed to load robot:', e);
        setError(true);
        setLoading(false);
      }
    };

    loadRobot();
  }, [urdfPath, urdfFile, invalidate, camera]);

  // Continuous rotation
  useFrame((_, delta) => {
    if (groupRef.current && robot && fullyLoaded) {
      groupRef.current.rotation.z += delta * 0.5;
    }
  });

  if (error) {
    return null;
  }

  if (loading || !robot || !fullyLoaded) {
    return <LoadingIndicator />;
  }

  return (
    <>
      <ReferenceGrid theme={theme} />
      <group ref={groupRef}>
        <primitive object={robot} />
      </group>
    </>
  );
}

/**
 * Loading indicator - rotating wireframe cube
 */
function LoadingIndicator() {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.x += delta * 0.5;
      meshRef.current.rotation.y += delta * 0.7;
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[0.4, 0.4, 0.4]} />
      <meshBasicMaterial color="#6366f1" wireframe />
    </mesh>
  );
}

/**
 * RobotThumbnail3D - Main component with Canvas
 * Pure real-time 3D rendering
 */
export const RobotThumbnail3D: React.FC<RobotThumbnail3DProps> = ({ urdfPath, urdfFile, theme = 'dark' }) => {
  const [hasError, setHasError] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lazy loading with IntersectionObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsVisible(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1, rootMargin: '50px' }
    );

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  if (hasError) {
    return (
      <div ref={containerRef} className="flex flex-col items-center justify-center w-full h-full text-slate-400">
        <Box className="w-8 h-8 opacity-30" />
        <span className="text-[9px] mt-1 opacity-50">Preview</span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full">
      {isVisible ? (
        <Canvas
          camera={{ position: [2, 2, 2], up: [0, 0, 1], fov: 50 }}
          shadows
          frameloop="always"
          dpr={[1, 1.5]}
          gl={{
            antialias: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
            powerPreference: 'high-performance',
          }}
          onError={() => setHasError(true)}
        >
          <color attach="background" args={[theme === 'light' ? '#f8f9fa' : '#000000']} />
          <SceneLighting />
          <Environment files="/potsdamer_platz_1k.hdr" environmentIntensity={1.2} />

          <Suspense fallback={<LoadingIndicator />}>
            <RobotPreviewModel 
              urdfPath={urdfPath}
              urdfFile={urdfFile}
              theme={theme}
            />
          </Suspense>
        </Canvas>
      ) : (
        <div className="flex items-center justify-center w-full h-full bg-slate-100 dark:bg-[#000000]">
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      )}
    </div>
  );
};

export default RobotThumbnail3D;
