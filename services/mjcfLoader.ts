/**
 * MJCF Loader - Directly loads MJCF XML into Three.js scene
 * Inspired by robot_viewer's MJCFAdapter.js
 */

import * as THREE from 'three';
import { findAssetByPath, createPlaceholderMesh, cleanFilePath } from '../components/URDFViewer/loaders';

// ============================================================
// MJCF TYPES
// ============================================================

interface MJCFMesh {
    name: string;
    file: string;
    scale?: number[];
}

interface MJCFBody {
    name: string;
    pos: [number, number, number];
    quat?: [number, number, number, number]; // wxyz
    euler?: [number, number, number];
    geoms: MJCFGeom[];
    joints: MJCFJoint[];
    children: MJCFBody[];
}

interface MJCFGeom {
    name?: string;
    type: string;
    size?: number[];
    mesh?: string;
    rgba?: [number, number, number, number];
    pos?: [number, number, number];
    quat?: [number, number, number, number];
    fromto?: number[];
    contype?: number;
    conaffinity?: number;
    group?: number;
}

interface MJCFJoint {
    name: string;
    type: string;
    axis?: [number, number, number];
    range?: [number, number];
    pos?: [number, number, number];
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function parseNumbers(str: string | null): number[] {
    if (!str) return [];
    return str.trim().split(/\s+/).map(s => parseFloat(s) || 0);
}

function parsePos(str: string | null): [number, number, number] {
    const nums = parseNumbers(str);
    return [nums[0] || 0, nums[1] || 0, nums[2] || 0];
}

function parseQuat(str: string | null): [number, number, number, number] | undefined {
    const nums = parseNumbers(str);
    if (nums.length < 4) return undefined;
    return [nums[0], nums[1], nums[2], nums[3]]; // wxyz
}

function quaternionToEuler(w: number, x: number, y: number, z: number): [number, number, number] {
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);

    const sinp = 2 * (w * y - z * x);
    const pitch = Math.abs(sinp) >= 1
        ? Math.sign(sinp) * Math.PI / 2
        : Math.asin(sinp);

    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);

    return [roll, pitch, yaw];
}

// ============================================================
// MESH MAP PARSING
// ============================================================

function parseMeshAssets(doc: Document): Map<string, MJCFMesh> {
    const meshMap = new Map<string, MJCFMesh>();
    const asset = doc.querySelector('asset');
    if (!asset) return meshMap;

    const meshes = asset.querySelectorAll('mesh');
    meshes.forEach((meshEl, index) => {
        let name = meshEl.getAttribute('name');
        const file = meshEl.getAttribute('file');

        if (file) {
            if (!name) {
                const fileName = file.split('/').pop()?.split('\\').pop() || '';
                name = fileName.split('.')[0] || `mesh_${index}`;
            }

            const scaleStr = meshEl.getAttribute('scale');
            const scale = scaleStr ? parseNumbers(scaleStr) : undefined;

            meshMap.set(name, { name, file, scale: scale && scale.length >= 3 ? scale : undefined });
        }
    });

    return meshMap;
}

// ============================================================
// BODY PARSING
// ============================================================

function parseBody(bodyEl: Element, meshMap: Map<string, MJCFMesh>): MJCFBody {
    const name = bodyEl.getAttribute('name') || `body_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const pos = parsePos(bodyEl.getAttribute('pos'));
    const quat = parseQuat(bodyEl.getAttribute('quat'));
    const eulerStr = bodyEl.getAttribute('euler');
    const euler = eulerStr ? parseNumbers(eulerStr) as [number, number, number] : undefined;

    // Parse geoms
    const geoms: MJCFGeom[] = [];
    const geomElements = bodyEl.querySelectorAll(':scope > geom');
    geomElements.forEach(geomEl => {
        const geom: MJCFGeom = {
            name: geomEl.getAttribute('name') || undefined,
            type: geomEl.getAttribute('type') || (geomEl.getAttribute('mesh') ? 'mesh' : 'sphere'),
            size: parseNumbers(geomEl.getAttribute('size')),
            mesh: geomEl.getAttribute('mesh') || undefined,
            pos: geomEl.getAttribute('pos') ? parsePos(geomEl.getAttribute('pos')) : undefined,
            quat: parseQuat(geomEl.getAttribute('quat')),
        };

        const rgbaStr = geomEl.getAttribute('rgba');
        if (rgbaStr) {
            const rgba = parseNumbers(rgbaStr);
            if (rgba.length >= 3) {
                geom.rgba = [rgba[0], rgba[1], rgba[2], rgba[3] ?? 1];
            }
        }

        const contypeStr = geomEl.getAttribute('contype');
        const conaffinityStr = geomEl.getAttribute('conaffinity');
        const groupStr = geomEl.getAttribute('group');

        if (contypeStr) geom.contype = parseInt(contypeStr);
        if (conaffinityStr) geom.conaffinity = parseInt(conaffinityStr);
        if (groupStr) geom.group = parseInt(groupStr);

        geoms.push(geom);
    });

    // Parse joints
    const joints: MJCFJoint[] = [];
    const jointElements = bodyEl.querySelectorAll(':scope > joint');
    jointElements.forEach(jointEl => {
        const joint: MJCFJoint = {
            name: jointEl.getAttribute('name') || `joint_${Date.now()}`,
            type: jointEl.getAttribute('type') || 'hinge',
        };

        const axisStr = jointEl.getAttribute('axis');
        if (axisStr) {
            const axisNums = parseNumbers(axisStr);
            joint.axis = [axisNums[0] || 0, axisNums[1] || 0, axisNums[2] || 1];
        }

        const rangeStr = jointEl.getAttribute('range');
        if (rangeStr) {
            const rangeNums = parseNumbers(rangeStr);
            joint.range = [rangeNums[0] || -Math.PI, rangeNums[1] || Math.PI];
        }

        const posStr = jointEl.getAttribute('pos');
        if (posStr) {
            joint.pos = parsePos(posStr);
        }

        joints.push(joint);
    });

    // Parse child bodies
    const children: MJCFBody[] = [];
    const childBodyElements = bodyEl.querySelectorAll(':scope > body');
    childBodyElements.forEach(childEl => {
        children.push(parseBody(childEl, meshMap));
    });

    return { name, pos, quat, euler, geoms, joints, children };
}

// ============================================================
// GEOMETRY CREATION
// ============================================================

async function createGeometryMesh(
    geom: MJCFGeom,
    meshMap: Map<string, MJCFMesh>,
    assets: Record<string, string>,
    meshCache: Map<string, THREE.Object3D | THREE.BufferGeometry>
): Promise<THREE.Object3D | null> {
    const type = geom.mesh ? 'mesh' : geom.type;

    switch (type) {
        case 'box': {
            if (!geom.size || geom.size.length < 1) return null;
            // MJCF size is half-size
            const sx = (geom.size[0] || 0.05) * 2;
            const sy = ((geom.size[1] ?? geom.size[0]) || 0.05) * 2;
            const sz = ((geom.size[2] ?? geom.size[0]) || 0.05) * 2;
            const geometry = new THREE.BoxGeometry(sx, sy, sz);
            return new THREE.Mesh(geometry, createDefaultMaterial());
        }

        case 'sphere': {
            const radius = geom.size?.[0] || 0.05;
            const geometry = new THREE.SphereGeometry(radius, 32, 32);
            return new THREE.Mesh(geometry, createDefaultMaterial());
        }

        case 'cylinder': {
            const radius = geom.size?.[0] || 0.05;
            const halfHeight = geom.size?.[1] || 0.1;
            const geometry = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 32);
            geometry.rotateX(Math.PI / 2); // MJCF cylinder is along Z
            return new THREE.Mesh(geometry, createDefaultMaterial());
        }

        case 'mesh': {
            if (!geom.mesh) return null;

            const meshDef = meshMap.get(geom.mesh);
            if (!meshDef) {
                console.warn(`[MJCFLoader] Mesh not defined in assets: ${geom.mesh}`);
                return createPlaceholderMesh(geom.mesh);
            }

            // Check cache
            if (meshCache.has(meshDef.file)) {
                const cached = meshCache.get(meshDef.file)!;
                if ((cached as any).isGroup || (cached as any).isObject3D) {
                    const cloned = (cached as THREE.Object3D).clone(true);
                    if (meshDef.scale) {
                        cloned.scale.set(meshDef.scale[0], meshDef.scale[1], meshDef.scale[2]);
                    }
                    return cloned;
                } else {
                    // BufferGeometry
                    const mesh = new THREE.Mesh(cached as THREE.BufferGeometry, createDefaultMaterial());
                    if (meshDef.scale) {
                        mesh.scale.set(meshDef.scale[0], meshDef.scale[1], meshDef.scale[2]);
                    }
                    return mesh;
                }
            }

            // Load mesh
            const loadedMesh = await loadMeshForMJCF(meshDef.file, assets, meshCache);
            if (!loadedMesh) {
                return createPlaceholderMesh(meshDef.file);
            }

            if (meshDef.scale) {
                loadedMesh.scale.set(meshDef.scale[0], meshDef.scale[1], meshDef.scale[2]);
            }

            return loadedMesh;
        }

        default:
            return null;
    }
}

function createDefaultMaterial(): THREE.MeshPhongMaterial {
    return new THREE.MeshPhongMaterial({
        color: 0x888888,
        shininess: 50,
        specular: new THREE.Color(0.3, 0.3, 0.3)
    });
}

async function loadMeshForMJCF(
    filePath: string,
    assets: Record<string, string>,
    meshCache: Map<string, THREE.Object3D | THREE.BufferGeometry>
): Promise<THREE.Object3D | null> {
    // Use findAssetByPath which has fuzzy matching (suffix match, etc)
    const assetUrl = findAssetByPath(filePath, assets, '');

    if (!assetUrl) {
        console.warn(`[MJCFLoader] Mesh file not found: ${filePath}`);
        // Log available assets to help debugging
        console.log(`[MJCFLoader] Available assets keys:`, Object.keys(assets));
        return null;
    }

    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    try {
        if (ext === 'stl') {
            const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
            const loader = new STLLoader();
            const geometry = await new Promise<THREE.BufferGeometry>((resolve, reject) => {
                loader.load(assetUrl, resolve, undefined, reject);
            });
            meshCache.set(filePath, geometry);
            return new THREE.Mesh(geometry, createDefaultMaterial());

        } else if (ext === 'dae') {
            const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
            const loader = new ColladaLoader();
            const result = await new Promise<any>((resolve, reject) => {
                loader.load(assetUrl, resolve, undefined, reject);
            });
            const scene = result.scene;
            meshCache.set(filePath, scene);
            return scene.clone(true);

        } else if (ext === 'obj') {
            const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
            const loader = new OBJLoader();
            const obj = await new Promise<THREE.Group>((resolve, reject) => {
                loader.load(assetUrl, resolve, undefined, reject);
            });
            meshCache.set(filePath, obj);
            return obj.clone(true);

        } else if (ext === 'gltf' || ext === 'glb') {
            const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
            const loader = new GLTFLoader();
            const gltf = await new Promise<any>((resolve, reject) => {
                loader.load(assetUrl, resolve, undefined, reject);
            });
            const scene = gltf.scene;
            meshCache.set(filePath, scene);
            return scene.clone(true);
        }

        console.warn(`[MJCFLoader] Unsupported mesh format: ${ext}`);
        return null;

    } catch (error) {
        console.error(`[MJCFLoader] Failed to load mesh: ${filePath}`, error);
        return null;
    }
}

// ============================================================
// APPLY RGBA COLOR TO MESH
// ============================================================

function applyRgbaToMesh(mesh: THREE.Object3D, rgba: [number, number, number, number]): void {
    // Validate rgba buffer to prevent "Unknown color" errors
    const r = isFinite(rgba[0]) ? rgba[0] : 0.8;
    const g = isFinite(rgba[1]) ? rgba[1] : 0.8;
    const b = isFinite(rgba[2]) ? rgba[2] : 0.8;
    const color = new THREE.Color(r, g, b);
    const alpha = isFinite(rgba[3]) ? rgba[3] : 1.0;

    mesh.traverse((child: any) => {
        if (child.isMesh && child.material) {
            // Clone material to avoid affecting other instances
            if (Array.isArray(child.material)) {
                child.material = child.material.map((mat: THREE.Material) => {
                    const cloned = mat.clone();
                    (cloned as any).color = color;
                    if (alpha < 1.0) {
                        cloned.transparent = true;
                        cloned.opacity = alpha;
                    }
                    // Enhance for better lighting
                    if ((cloned as any).shininess !== undefined) {
                        (cloned as any).shininess = Math.max((cloned as any).shininess, 50);
                    }
                    if ((cloned as any).specular) {
                        (cloned as any).specular = new THREE.Color(0.3, 0.3, 0.3);
                    }
                    return cloned;
                });
            } else {
                child.material = child.material.clone();
                child.material.color = color;
                if (alpha < 1.0) {
                    child.material.transparent = true;
                    child.material.opacity = alpha;
                }
                // Enhance for better lighting
                if (child.material.shininess !== undefined) {
                    child.material.shininess = Math.max(child.material.shininess, 50);
                }
                if (child.material.specular) {
                    child.material.specular = new THREE.Color(0.3, 0.3, 0.3);
                }
            }
        }
    });
}

// ============================================================
// MAIN LOADER FUNCTION
// ============================================================

/**
 * Load MJCF XML content and create Three.js scene
 */
export async function loadMJCFToThreeJS(
    xmlContent: string,
    assets: Record<string, string>
): Promise<THREE.Object3D | null> {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlContent, 'text/xml');

        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.error('[MJCFLoader] XML parsing error:', parseError.textContent);
            return null;
        }

        const mujocoEl = doc.querySelector('mujoco');
        if (!mujocoEl) {
            console.error('[MJCFLoader] No <mujoco> root element found');
            return null;
        }

        const modelName = mujocoEl.getAttribute('model') || 'mjcf_robot';

        // Parse mesh assets
        const meshMap = parseMeshAssets(doc);
        console.log(`[MJCFLoader] Found ${meshMap.size} mesh definitions`);

        // Parse worldbody
        const worldbodyEl = mujocoEl.querySelector('worldbody');
        if (!worldbodyEl) {
            console.error('[MJCFLoader] No <worldbody> element found');
            return null;
        }

        // Parse all top-level bodies
        const bodies: MJCFBody[] = [];
        const bodyElements = worldbodyEl.querySelectorAll(':scope > body');
        bodyElements.forEach(bodyEl => {
            bodies.push(parseBody(bodyEl, meshMap));
        });

        console.log(`[MJCFLoader] Parsed ${bodies.length} top-level bodies`);

        // Create Three.js scene
        const rootGroup = new THREE.Group();
        rootGroup.name = modelName;
        (rootGroup as any).isURDFRobot = true;

        // Create mesh cache for reusing loaded meshes
        const meshCache = new Map<string, THREE.Object3D | THREE.BufferGeometry>();

        // Build body hierarchy
        const linksMap: Record<string, THREE.Object3D> = {};
        const jointsMap: Record<string, THREE.Object3D> = {};

        async function buildBody(body: MJCFBody, parentGroup: THREE.Group): Promise<void> {
            // Create link group
            const linkGroup = new THREE.Group();
            linkGroup.name = body.name;
            (linkGroup as any).isURDFLink = true;
            (linkGroup as any).type = 'URDFLink';
            linksMap[body.name] = linkGroup;

            // Create visual meshes for each geom
            for (const geom of body.geoms) {
                // Skip collision-only geoms
                if (geom.contype === 0 && geom.conaffinity === 0) {
                    // Visual only - include it
                } else if (geom.group === 2) {
                    continue; // Collision group
                } else if (!geom.mesh && geom.type !== 'sphere') {
                    // Basic primitives without mesh are likely collision
                    continue;
                }

                const mesh = await createGeometryMesh(geom, meshMap, assets, meshCache);
                if (mesh) {
                    // Apply position
                    if (geom.pos) {
                        mesh.position.set(geom.pos[0], geom.pos[1], geom.pos[2]);
                    }

                    // Apply rotation from quat
                    if (geom.quat) {
                        const q = new THREE.Quaternion(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0]);
                        mesh.quaternion.copy(q);
                    }

                    // Apply color
                    if (geom.rgba) {
                        applyRgbaToMesh(mesh, geom.rgba);
                    }

                    mesh.name = geom.name || 'visual';
                    linkGroup.add(mesh);
                }
            }

            // Process child bodies with joints
            for (const childBody of body.children) {
                const joint = childBody.joints[0]; // Use first joint

                // Create joint group
                const jointGroup = new THREE.Group();
                jointGroup.name = joint?.name || `joint_to_${childBody.name}`;
                (jointGroup as any).isURDFJoint = true;
                (jointGroup as any).type = 'URDFJoint';
                (jointGroup as any).jointType = joint ?
                    (joint.type === 'hinge' ? 'revolute' :
                        joint.type === 'slide' ? 'prismatic' :
                            joint.type === 'free' ? 'floating' : 'fixed') : 'fixed';

                // Set joint position from child body pos
                jointGroup.position.set(childBody.pos[0], childBody.pos[1], childBody.pos[2]);

                // Apply rotation
                if (childBody.quat) {
                    const q = new THREE.Quaternion(childBody.quat[1], childBody.quat[2], childBody.quat[3], childBody.quat[0]);
                    jointGroup.quaternion.copy(q);
                } else if (childBody.euler) {
                    jointGroup.rotation.set(childBody.euler[0], childBody.euler[1], childBody.euler[2]);
                }

                // Set joint axis
                if (joint?.axis) {
                    (jointGroup as any).axis = new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize();
                } else {
                    (jointGroup as any).axis = new THREE.Vector3(0, 0, 1);
                }

                // Set joint limits
                if (joint?.range) {
                    (jointGroup as any).limit = { lower: joint.range[0], upper: joint.range[1] };
                }

                // Joint value functions
                (jointGroup as any).angle = 0;
                (jointGroup as any).setJointValue = function (value: number) {
                    this.angle = value;
                    const axis = this.axis || new THREE.Vector3(0, 0, 1);
                    if (this.jointType === 'revolute' || this.jointType === 'continuous') {
                        this.quaternion.setFromAxisAngle(axis, value);
                    }
                };

                jointsMap[jointGroup.name] = jointGroup;

                // Recursively build child
                await buildBody(childBody, jointGroup);

                linkGroup.add(jointGroup);
            }

            parentGroup.add(linkGroup);
        }

        // Build all top-level bodies
        for (const body of bodies) {
            const bodyGroup = new THREE.Group();
            bodyGroup.position.set(body.pos[0], body.pos[1], body.pos[2]);

            if (body.quat) {
                const q = new THREE.Quaternion(body.quat[1], body.quat[2], body.quat[3], body.quat[0]);
                bodyGroup.quaternion.copy(q);
            } else if (body.euler) {
                bodyGroup.rotation.set(body.euler[0], body.euler[1], body.euler[2]);
            }

            await buildBody(body, bodyGroup);
            rootGroup.add(bodyGroup);
        }

        // Attach links and joints maps
        (rootGroup as any).links = linksMap;
        (rootGroup as any).joints = jointsMap;

        console.log(`[MJCFLoader] Created robot with ${Object.keys(linksMap).length} links and ${Object.keys(jointsMap).length} joints`);

        return rootGroup;

    } catch (error) {
        console.error('[MJCFLoader] Failed to load MJCF:', error);
        return null;
    }
}

/**
 * Check if content is MJCF format
 * MJCF files have <mujoco> as the root element
 * URDF files have <robot> as root and may contain <mujoco> as metadata child
 */
export function isMJCFContent(content: string): boolean {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/xml');
        // Check if the ROOT element is <mujoco>, not just any <mujoco> tag
        // URDF files may contain <mujoco> as a child of <robot> for metadata
        const rootElement = doc.documentElement;
        return rootElement && rootElement.tagName.toLowerCase() === 'mujoco';
    } catch {
        return false;
    }
}
