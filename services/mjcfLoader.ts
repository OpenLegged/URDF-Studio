/**
 * MJCF Loader - Directly loads MJCF XML into Three.js scene
 * 
 * CORRECT MJCF hierarchy structure for proper pivot/rotation:
 * 
 * rootGroup
 * └── rootLinkGroup (pos = rootBody.pos, quat = rootBody.quat)
 *     └── BodyOffsetGroup (pos = childBody.pos, quat = childBody.quat)
 *         └── JointNode (pos = joint.pos) ← PIVOT POINT, rotations apply here
 *             └── GeomCompensationGroup (pos = -joint.pos) ← cancels offset
 *                 └── LinkGroup (meshes container)
 *                     └── Mesh (pos = geom.pos, quat = geom.quat)
 * 
 * MATH PRINCIPLE:
 * Final mesh position = Rotate(BodyQuat, JointPos + Rotate(JointRot, -JointPos + GeomPos))
 * - When JointRot = 0: mesh is at body.pos + Rotate(body.quat, geom.pos) (correct physical position)
 * - When rotating: mesh rotates perfectly around joint.pos (correct pivot)
 * 
 * Key design:
 * - BodyOffsetGroup handles body position/orientation
 * - JointNode is the rotation pivot - setJointValue() applies rotation here
 * - GeomCompensationGroup pulls coordinates back to body origin
 * - Joint axis is defined in Body local space (use bodyOffsetGroup.matrixWorld for world transform)
 * - Collision bodies: group=undefined/0/3, Visual: group=1 with contype=0
 */

import * as THREE from 'three';
import { findAssetByPath, createPlaceholderMesh, cleanFilePath } from '../components/URDFViewer/loaders';
import { createMatteMaterial, MATERIAL_CONFIG } from '../components/URDFViewer/materials';

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
    quat?: [number, number, number, number]; // wxyz (MuJoCo order)
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
    quat?: [number, number, number, number]; // wxyz (MuJoCo order)
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
// COMPILER SETTINGS
// ============================================================

interface MJCFCompilerSettings {
    angleUnit: 'radian' | 'degree';
    meshdir: string;
}

function parseCompilerSettings(doc: Document): MJCFCompilerSettings {
    const compiler = doc.querySelector('compiler');
    const angleAttr = compiler?.getAttribute('angle')?.toLowerCase() || 'radian';
    const meshdir = compiler?.getAttribute('meshdir') || '';
    
    return {
        angleUnit: angleAttr === 'degree' ? 'degree' : 'radian',
        meshdir
    };
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

/**
 * Parse MuJoCo quaternion string.
 * MuJoCo XML format: quat="W X Y Z" (W first)
 * Returns array in [W, X, Y, Z] order.
 */
function parseQuat(str: string | null): [number, number, number, number] | undefined {
    const nums = parseNumbers(str);
    if (nums.length < 4) return undefined;
    return [nums[0], nums[1], nums[2], nums[3]]; // [W, X, Y, Z] - MuJoCo order
}

/**
 * Convert MuJoCo quaternion [W, X, Y, Z] to Three.js Quaternion.
 * Three.js Quaternion constructor: new THREE.Quaternion(x, y, z, w)
 */
function mjcfQuatToThreeQuat(mjcfQuat: [number, number, number, number]): THREE.Quaternion {
    // mjcfQuat = [W, X, Y, Z]
    // Three.js = Quaternion(X, Y, Z, W)
    return new THREE.Quaternion(mjcfQuat[1], mjcfQuat[2], mjcfQuat[3], mjcfQuat[0]);
}

/**
 * Convert angle based on compiler settings.
 * If angleUnit is 'degree', convert to radians.
 */
function convertAngle(value: number, settings: MJCFCompilerSettings): number {
    if (settings.angleUnit === 'degree') {
        return value * (Math.PI / 180);
    }
    return value;
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
            // Use parsed values directly, they can be 0 (valid axis component)
            joint.axis = [
                axisNums[0] !== undefined ? axisNums[0] : 0,
                axisNums[1] !== undefined ? axisNums[1] : 0,
                axisNums[2] !== undefined ? axisNums[2] : 1
            ];
        } else {
            // MuJoCo default axis is Z (0, 0, 1), NOT X like URDF
            joint.axis = [0, 0, 1];
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

/**
 * Create geometry from fromto specification (common in MuJoCo).
 * fromto defines two endpoints, and we create a cylinder/capsule between them.
 */
function createFromToGeometry(geom: MJCFGeom, type: 'cylinder' | 'capsule'): THREE.Object3D {
    const fromto = geom.fromto!;
    const from = new THREE.Vector3(fromto[0], fromto[1], fromto[2]);
    const to = new THREE.Vector3(fromto[3], fromto[4], fromto[5]);
    
    const direction = new THREE.Vector3().subVectors(to, from);
    const length = direction.length();
    const center = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const radius = geom.size?.[0] || 0.05;

    const group = new THREE.Group();

    if (type === 'cylinder') {
        const geometry = new THREE.CylinderGeometry(radius, radius, length, 32);
        const mesh = new THREE.Mesh(geometry, createDefaultMaterial());
        group.add(mesh);
    } else {
        // Capsule: cylinder + 2 hemispheres
        const cylGeom = new THREE.CylinderGeometry(radius, radius, length, 32);
        const cylMesh = new THREE.Mesh(cylGeom, createDefaultMaterial());
        group.add(cylMesh);

        const topSphere = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
        const topMesh = new THREE.Mesh(topSphere, createDefaultMaterial());
        topMesh.position.y = length / 2;
        group.add(topMesh);

        const bottomSphere = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
        const bottomMesh = new THREE.Mesh(bottomSphere, createDefaultMaterial());
        bottomMesh.position.y = -length / 2;
        group.add(bottomMesh);
    }

    // Position at center
    group.position.copy(center);

    // Orient to align Y-axis with direction
    if (length > 0.0001) {
        const yAxis = new THREE.Vector3(0, 1, 0);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(yAxis, direction.normalize());
        group.quaternion.copy(quaternion);
    }

    return group;
}

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
            // Handle fromto if specified
            if (geom.fromto && geom.fromto.length === 6) {
                return createFromToGeometry(geom, 'cylinder');
            }
            const radius = geom.size?.[0] || 0.05;
            const halfHeight = geom.size?.[1] || 0.1;
            const geometry = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 32);
            geometry.rotateX(Math.PI / 2); // MJCF cylinder is along Z by default
            return new THREE.Mesh(geometry, createDefaultMaterial());
        }

        case 'capsule': {
            // Handle fromto if specified
            if (geom.fromto && geom.fromto.length === 6) {
                return createFromToGeometry(geom, 'capsule');
            }
            const radius = geom.size?.[0] || 0.05;
            const halfHeight = geom.size?.[1] || 0.1;
            // Create capsule using cylinder + 2 hemispheres
            const group = new THREE.Group();
            
            // Cylinder body
            const cylGeom = new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 32);
            const cylMesh = new THREE.Mesh(cylGeom, createDefaultMaterial());
            group.add(cylMesh);
            
            // Top hemisphere
            const topSphere = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
            const topMesh = new THREE.Mesh(topSphere, createDefaultMaterial());
            topMesh.position.y = halfHeight;
            group.add(topMesh);
            
            // Bottom hemisphere
            const bottomSphere = new THREE.SphereGeometry(radius, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
            const bottomMesh = new THREE.Mesh(bottomSphere, createDefaultMaterial());
            bottomMesh.position.y = -halfHeight;
            group.add(bottomMesh);
            
            // MJCF capsule is along Z by default, rotate to align
            group.rotation.x = Math.PI / 2;
            return group;
        }

        case 'ellipsoid': {
            const sx = geom.size?.[0] || 0.05;
            const sy = geom.size?.[1] || sx;
            const sz = geom.size?.[2] || sx;
            const geometry = new THREE.SphereGeometry(1, 32, 32);
            const mesh = new THREE.Mesh(geometry, createDefaultMaterial());
            mesh.scale.set(sx, sy, sz);
            return mesh;
        }

        case 'plane': {
            // MuJoCo plane - typically a large ground plane
            const sx = (geom.size?.[0] || 10) * 2;
            const sy = (geom.size?.[1] || 10) * 2;
            const geometry = new THREE.PlaneGeometry(sx, sy);
            geometry.rotateX(-Math.PI / 2); // Plane faces +Z in MuJoCo, but we want it horizontal
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

/**
 * Creates default matte material for MJCF geometry.
 * Uses unified material factory for consistent appearance with URDF.
 */
function createDefaultMaterial(): THREE.MeshStandardMaterial {
    return createMatteMaterial({
        color: 0x888888,
        name: 'mjcf_default'
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
// Uses unified material factory for consistent URDF/MJCF appearance
// ============================================================

function applyRgbaToMesh(mesh: THREE.Object3D, rgba: [number, number, number, number]): void {
    // Validate and clamp rgba values to 0-1 range
    const r = isFinite(rgba[0]) ? Math.max(0, Math.min(1, rgba[0])) : 0.8;
    const g = isFinite(rgba[1]) ? Math.max(0, Math.min(1, rgba[1])) : 0.8;
    const b = isFinite(rgba[2]) ? Math.max(0, Math.min(1, rgba[2])) : 0.8;
    const alpha = isFinite(rgba[3]) ? Math.max(0, Math.min(1, rgba[3])) : 1.0;

    mesh.traverse((child: any) => {
        if (child.isMesh && child.material) {
            // Create unified matte material using the factory
            // This ensures MJCF and URDF have identical visual appearance
            const newMat = createMatteMaterial({
                color: new THREE.Color(r, g, b),
                opacity: alpha,
                transparent: alpha < 1.0,
                name: child.material?.name || 'mjcf_material'
            });

            if (Array.isArray(child.material)) {
                child.material = child.material.map(() => newMat.clone());
            } else {
                child.material = newMat;
            }
            
            // Enable shadows for ground contact
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });
}

// JOINT AXIS VISUALIZATION
// ============================================================

/**
 * Create link coordinate axes (RGB = XYZ)
 * Matching robot_viewer/CoordinateAxesManager.js createAxesGeometry()
 */
function createLinkAxesHelper(axesSize: number = 0.1): THREE.Object3D {
    const axesGroup = new THREE.Group();
    axesGroup.name = '__link_axes_helper__';
    axesGroup.userData.isGizmo = true;
    
    const axisRadius = Math.max(0.001, axesSize * 0.015);
    const axisGeometry = new THREE.CylinderGeometry(axisRadius, axisRadius, axesSize, 8);

    // X axis (red)
    const xAxis = new THREE.Mesh(axisGeometry, new THREE.MeshPhongMaterial({
        color: 0xff0000, shininess: 30, depthTest: true
    }));
    xAxis.position.x = axesSize / 2;
    xAxis.rotation.z = -Math.PI / 2;
    xAxis.castShadow = false;
    xAxis.receiveShadow = false;
    xAxis.userData.isGizmo = true;
    xAxis.raycast = () => {};
    axesGroup.add(xAxis);

    // Y axis (green)
    const yAxis = new THREE.Mesh(axisGeometry, new THREE.MeshPhongMaterial({
        color: 0x00ff00, shininess: 30, depthTest: true
    }));
    yAxis.position.y = axesSize / 2;
    yAxis.castShadow = false;
    yAxis.receiveShadow = false;
    yAxis.userData.isGizmo = true;
    yAxis.raycast = () => {};
    axesGroup.add(yAxis);

    // Z axis (blue)
    const zAxis = new THREE.Mesh(axisGeometry, new THREE.MeshPhongMaterial({
        color: 0x0000ff, shininess: 30, depthTest: true
    }));
    zAxis.position.z = axesSize / 2;
    zAxis.rotation.x = Math.PI / 2;
    zAxis.castShadow = false;
    zAxis.receiveShadow = false;
    zAxis.userData.isGizmo = true;
    zAxis.raycast = () => {};
    axesGroup.add(zAxis);

    return axesGroup;
}

/**
 * Create rotation direction indicator (arc arrow)
 * Matching robot_viewer/CoordinateAxesManager.js createRotationIndicator()
 */
function createRotationIndicator(axisDirection: THREE.Vector3, baseLength: number): THREE.Object3D {
    const group = new THREE.Group();
    const radius = baseLength * 0.3;
    const tubeRadius = 0.001;
    const arrowSize = 0.004;
    const color = 0x00ff00; // Green

    // Create arc curve (270 degrees)
    const arcAngle = Math.PI * 1.5;
    const curve = new THREE.EllipseCurve(
        0, 0,
        radius, radius,
        0, arcAngle,
        false,
        0
    );

    // Generate arc path points
    const points = curve.getPoints(50);
    const points3D = points.map(p => new THREE.Vector3(p.x, p.y, 0));

    // Create tube geometry
    const curvePath = new THREE.CatmullRomCurve3(points3D);
    const tubeGeometry = new THREE.TubeGeometry(curvePath, 50, tubeRadius, 8, false);
    const tubeMaterial = new THREE.MeshBasicMaterial({ color: color, depthTest: false });
    const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
    tubeMesh.userData.isGizmo = true;
    tubeMesh.raycast = () => {};
    group.add(tubeMesh);

    // Create arrow at arc end (cone)
    const coneGeometry = new THREE.ConeGeometry(arrowSize, arrowSize * 2, 8);
    const coneMaterial = new THREE.MeshBasicMaterial({ color: color, depthTest: false });
    const coneMesh = new THREE.Mesh(coneGeometry, coneMaterial);
    coneMesh.userData.isGizmo = true;
    coneMesh.raycast = () => {};

    // Calculate arrow position and direction
    const endPoint = points3D[points3D.length - 1];
    const preEndPoint = points3D[points3D.length - 5];
    const tangent = new THREE.Vector3().subVectors(endPoint, preEndPoint).normalize();

    coneMesh.position.copy(endPoint);
    coneMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    group.add(coneMesh);

    // Rotate entire arc arrow so it's perpendicular to axis direction
    const rotQuat = new THREE.Quaternion();
    rotQuat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisDirection);
    group.quaternion.copy(rotQuat);

    return group;
}

/**
 * Create a visual helper for joint axis with rotation indicator.
 * Matching robot_viewer/CoordinateAxesManager.js createJointArrowGeometry()
 * 
 * The helper is positioned at the JointNode origin (which is already at joint.pos),
 * so no additional positioning is needed.
 */
function createJointAxisHelper(axis: THREE.Vector3): THREE.Object3D {
    // Reduced size for better visual proportion (user requested 0.05-0.1)
    const arrowLength = 0.08;
    const shaftLength = arrowLength * 0.7;
    const headLength = arrowLength * 0.3;
    const shaftRadius = 0.002;
    const headRadius = 0.006;
    const arrowMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false });

    const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16, 1);
    const shaftMesh = new THREE.Mesh(shaftGeometry, arrowMaterial);
    shaftMesh.position.y = shaftLength / 2;
    shaftMesh.userData.isGizmo = true;
    shaftMesh.raycast = () => {};

    const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 16);
    const headMesh = new THREE.Mesh(headGeometry, arrowMaterial);
    headMesh.position.y = shaftLength + headLength / 2;
    headMesh.userData.isGizmo = true;
    headMesh.raycast = () => {};

    const arrow = new THREE.Group();
    arrow.add(shaftMesh);
    arrow.add(headMesh);

    // Rotate arrow to point in axis direction
    const upVector = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(upVector, axis.clone().normalize());
    arrow.quaternion.copy(quaternion);

    const axisGroup = new THREE.Group();
    axisGroup.name = '__joint_axis_helper__';
    axisGroup.userData.isGizmo = true;
    axisGroup.add(arrow);

    // Add rotation direction indicator (green arc arrow)
    const rotationIndicator = createRotationIndicator(axis.clone().normalize(), arrowLength);
    axisGroup.add(rotationIndicator);

    return axisGroup;
}

// ============================================================
// MAIN LOADER FUNCTION
// ============================================================

/**
 * Load MJCF XML content and create Three.js scene.
 * 
 * Correct MJCF hierarchy:
 * - BodyGroup: positioned at body.pos, rotated by body.quat
 *   - JointNode: positioned at joint.pos (the pivot point)
 *     - GeomOffsetGroup: positioned at -joint.pos (to counter-offset meshes)
 *       - Meshes: positioned at geom.pos
 *   - ChildBodies: recursively nested
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

        // Parse compiler settings (angle unit, meshdir, etc.)
        const compilerSettings = parseCompilerSettings(doc);
        console.log(`[MJCFLoader] Compiler settings: angle=${compilerSettings.angleUnit}, meshdir=${compilerSettings.meshdir}`);

        // Parse mesh assets
        const meshMap = parseMeshAssets(doc);
    
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

        // Create Three.js scene
        const rootGroup = new THREE.Group();
        rootGroup.name = modelName;
        (rootGroup as any).isURDFRobot = true;

        // Create mesh cache for reusing loaded meshes
        const meshCache = new Map<string, THREE.Object3D | THREE.BufferGeometry>();

        // Build body hierarchy
        const linksMap: Record<string, THREE.Object3D> = {};
        const jointsMap: Record<string, THREE.Object3D> = {};

        /**
         * REFACTORED: Build MJCF body hierarchy following robot_viewer's pattern.
         * 
         * Structure (matching robot_viewer/MJCFAdapter.js):
         *   parentLinkGroup
         *   └── JointGroup (position = childBody.pos + joint.pos, rotation = childBody.quat)
         *       └── childLinkGroup (position = 0, contains meshes at geom.pos)
         *           └── grandchildJointGroup...
         * 
         * Key insight: meshes are placed directly in linkGroup at geom.pos,
         * and jointGroup handles the body position offset.
         */
        async function buildBody(body: MJCFBody, parentGroup: THREE.Group, isRootBody: boolean = false): Promise<void> {
            // Create the link group (represents the body/link) - meshes go here
            const linkGroup = new THREE.Group();
            linkGroup.name = body.name;
            (linkGroup as any).isURDFLink = true;
            (linkGroup as any).type = 'URDFLink';
            linksMap[body.name] = linkGroup;

            // Add meshes directly to linkGroup (at geom.pos)
            await addGeomsToGroup(body.geoms, linkGroup, meshMap, assets, meshCache);

            // Add link coordinate axes (hidden by default, controlled by showOrigins)
            const linkAxes = createLinkAxesHelper(0.1);
            linkAxes.visible = false;
            linkGroup.add(linkAxes);

            if (isRootBody) {
                // Root body: apply body transform directly to linkGroup
                linkGroup.position.set(body.pos[0], body.pos[1], body.pos[2]);
                
                if (body.quat) {
                    // MuJoCo quat [W,X,Y,Z] -> Three.js Quaternion(x,y,z,w)
                    linkGroup.quaternion.copy(mjcfQuatToThreeQuat(body.quat));
                } else if (body.euler) {
                    linkGroup.rotation.set(body.euler[0], body.euler[1], body.euler[2]);
                }

                // Add root link directly to parent
                parentGroup.add(linkGroup);

                // Process child bodies - they will create their own jointGroups
                for (const childBody of body.children) {
                    await buildBodyWithJoint(childBody, linkGroup);
                }
            } else {
                // Non-root body: this should be called via buildBodyWithJoint
                // Just add to parent (jointGroup) - position is handled by jointGroup
                parentGroup.add(linkGroup);

                // Process child bodies
                for (const childBody of body.children) {
                    await buildBodyWithJoint(childBody, linkGroup);
                }
            }
        }

        /**
         * Build a child body with its connecting joint using CORRECT MJCF hierarchy.
         * 
         * CORRECT STRUCTURE (fixes pivot calculation):
         * 
         * BodyOffsetGroup (container):
         *   position = childBody.pos
         *   quaternion = childBody.quat (wxyz -> xyzw conversion)
         *   └── JointNode (rotation center):
         *         position = joint.pos
         *         All rotations (setJointValue) apply to this node's quaternion
         *         └── GeomCompensationGroup (offset group):
         *               position = -joint.pos (cancels the joint offset)
         *               └── LinkGroup (contains meshes):
         *                     └── Mesh/Geom:
         *                           position = geom.pos
         *                           quaternion = geom.quat
         * 
         * MATH: Final mesh position = Rotate(BodyQuat, JointPos + Rotate(JointRot, -JointPos + GeomPos))
         * When JointRot = 0, mesh is at body.pos + Rotate(body.quat, geom.pos)
         * When rotating, mesh rotates perfectly around joint.pos
         */
        async function buildBodyWithJoint(childBody: MJCFBody, parentLinkGroup: THREE.Group): Promise<void> {
            const joint = childBody.joints[0];
            const jointPos: [number, number, number] = joint?.pos || [0, 0, 0];
            const hasActiveJoint = joint && joint.type !== 'fixed';

            if (!hasActiveJoint) {
                // No active joint - create a fixed connection group (BodyOffsetGroup only)
                const bodyOffsetGroup = new THREE.Group();
                bodyOffsetGroup.name = `body_offset_${childBody.name}`;
                bodyOffsetGroup.position.set(childBody.pos[0], childBody.pos[1], childBody.pos[2]);
                
                if (childBody.quat) {
                    // MuJoCo quat [W,X,Y,Z] -> Three.js Quaternion(x,y,z,w)
                    bodyOffsetGroup.quaternion.copy(mjcfQuatToThreeQuat(childBody.quat));
                } else if (childBody.euler) {
                    // Convert euler angles if in degrees
                    const ex = convertAngle(childBody.euler[0], compilerSettings);
                    const ey = convertAngle(childBody.euler[1], compilerSettings);
                    const ez = convertAngle(childBody.euler[2], compilerSettings);
                    bodyOffsetGroup.rotation.set(ex, ey, ez);
                }

                // Create link group for meshes (no joint offset needed for fixed)
                const linkGroup = new THREE.Group();
                linkGroup.name = childBody.name;
                (linkGroup as any).isURDFLink = true;
                (linkGroup as any).type = 'URDFLink';
                linksMap[childBody.name] = linkGroup;

                // Add geoms directly to link group
                await addGeomsToGroup(childBody.geoms, linkGroup, meshMap, assets, meshCache);

                // Add link coordinate axes (hidden by default)
                const linkAxes = createLinkAxesHelper(0.1);
                linkAxes.visible = false;
                linkGroup.add(linkAxes);

                bodyOffsetGroup.add(linkGroup);
                parentLinkGroup.add(bodyOffsetGroup);

                // Process child bodies recursively
                for (const grandChild of childBody.children) {
                    await buildBodyWithJoint(grandChild, linkGroup);
                }
                return;
            }

            // === LAYER 1: BodyOffsetGroup (BodyContainer) ===
            // Position and rotate according to childBody's transform
            const bodyOffsetGroup = new THREE.Group();
            bodyOffsetGroup.name = `body_offset_${childBody.name}`;
            bodyOffsetGroup.position.set(childBody.pos[0], childBody.pos[1], childBody.pos[2]);
            
            if (childBody.quat) {
                // MuJoCo quat [W,X,Y,Z] -> Three.js Quaternion(x,y,z,w)
                bodyOffsetGroup.quaternion.copy(mjcfQuatToThreeQuat(childBody.quat));
            } else if (childBody.euler) {
                // Convert euler angles if in degrees
                const ex = convertAngle(childBody.euler[0], compilerSettings);
                const ey = convertAngle(childBody.euler[1], compilerSettings);
                const ez = convertAngle(childBody.euler[2], compilerSettings);
                bodyOffsetGroup.rotation.set(ex, ey, ez);
            }

            // === LAYER 2: JointNode ===
            // This is the pivot point - all rotations happen here
            const jointNode = new THREE.Group();
            jointNode.name = joint.name || `joint_${childBody.name}`;
            (jointNode as any).isURDFJoint = true;
            (jointNode as any).type = 'URDFJoint';
            (jointNode as any).jointType = joint.type === 'hinge' ? 'revolute' :
                joint.type === 'slide' ? 'prismatic' :
                joint.type === 'ball' ? 'ball' :
                joint.type === 'free' ? 'floating' : 'continuous';

            // Position joint at joint.pos (relative to body origin)
            jointNode.position.set(jointPos[0], jointPos[1], jointPos[2]);

            // Store reference to parent BodyOffsetGroup for axis calculation
            (jointNode as any).bodyOffsetGroup = bodyOffsetGroup;

            // Joint axis: defined in Body local space (MJCF convention)
            // Default axis is Z (0, 0, 1) in MJCF
            const axisVec = joint.axis 
                ? new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]).normalize()
                : new THREE.Vector3(0, 0, 1);
            (jointNode as any).axis = axisVec;

            // Joint limits (convert if in degrees)
            if (joint.range) {
                const lowerLimit = convertAngle(joint.range[0], compilerSettings);
                const upperLimit = convertAngle(joint.range[1], compilerSettings);
                (jointNode as any).limit = { lower: lowerLimit, upper: upperLimit };
            }

            // Joint angle tracking and setJointValue
            // Rotation is applied directly to JointNode's quaternion
            (jointNode as any).angle = 0;
            (jointNode as any).setJointValue = function(value: number) {
                this.angle = value;
                const axis = this.axis ? this.axis.clone().normalize() : new THREE.Vector3(0, 0, 1);
                
                if (this.jointType === 'revolute' || this.jointType === 'continuous') {
                    // Store initial quaternion (should be identity for JointNode)
                    if (!this.userData) this.userData = {};
                    if (!this.userData.initialQuaternion) {
                        this.userData.initialQuaternion = this.quaternion.clone();
                    }
                    
                    // Apply rotation around axis
                    const rotationQuat = new THREE.Quaternion();
                    rotationQuat.setFromAxisAngle(axis, value);
                    
                    this.quaternion.copy(this.userData.initialQuaternion);
                    this.quaternion.multiply(rotationQuat);
                    this.updateMatrixWorld(true);
                } else if (this.jointType === 'prismatic') {
                    if (!this.userData) this.userData = {};
                    if (!this.userData.initialPosition) {
                        this.userData.initialPosition = this.position.clone();
                    }
                    this.position.copy(this.userData.initialPosition);
                    this.position.addScaledVector(axis, value);
                    this.updateMatrixWorld(true);
                }
            };

            // Add joint axis visualization helper (hidden by default, toggled via showJointAxes)
            const axisHelper = createJointAxisHelper(axisVec);
            axisHelper.visible = false;
            jointNode.add(axisHelper);

            // Add debug AxesHelper for joint pivot (hidden by default)
            const debugAxes = new THREE.AxesHelper(0.1);
            debugAxes.name = '__debug_joint_axes__';
            debugAxes.visible = false;
            (debugAxes as any).userData = { isGizmo: true, isDebugAxes: true };
            jointNode.add(debugAxes);

            jointsMap[jointNode.name] = jointNode;

            // === LAYER 3: GeomCompensationGroup ===
            // Position = -joint.pos to pull coordinates back to Body origin
            // This ensures geoms are placed at their correct geom.pos relative to body
            const geomCompensationGroup = new THREE.Group();
            geomCompensationGroup.name = `geom_compensation_${childBody.name}`;
            geomCompensationGroup.position.set(-jointPos[0], -jointPos[1], -jointPos[2]);

            // === LAYER 4: LinkGroup (contains meshes) ===
            const linkGroup = new THREE.Group();
            linkGroup.name = childBody.name;
            (linkGroup as any).isURDFLink = true;
            (linkGroup as any).type = 'URDFLink';
            linksMap[childBody.name] = linkGroup;

            // Add geoms to link group (they will be positioned at geom.pos)
            await addGeomsToGroup(childBody.geoms, linkGroup, meshMap, assets, meshCache);

            // Add link coordinate axes (hidden by default)
            const linkAxes = createLinkAxesHelper(0.1);
            linkAxes.visible = false;
            linkGroup.add(linkAxes);

            // === Assemble the hierarchy ===
            geomCompensationGroup.add(linkGroup);
            jointNode.add(geomCompensationGroup);
            bodyOffsetGroup.add(jointNode);
            parentLinkGroup.add(bodyOffsetGroup);

            // Process child bodies - they attach to the linkGroup
            for (const grandChild of childBody.children) {
                await buildBodyWithJoint(grandChild, linkGroup);
            }
        }

        /**
         * Helper: Add all geoms (visual AND collision) to a group
         * 
         * MJCF geom classification rules (based on g1_23dof.xml pattern):
         * - Visual: group="1" AND contype="0" conaffinity="0"
         * - Collision: no group attribute OR group != 1
         * - Primitives (sphere, box, cylinder) without group are collision
         */
        async function addGeomsToGroup(
            geoms: MJCFGeom[],
            targetGroup: THREE.Group,
            meshMap: Map<string, MJCFMesh>,
            assets: Record<string, string>,
            meshCache: Map<string, THREE.Object3D | THREE.BufferGeometry>
        ): Promise<void> {
            // Create separate containers for visual and collision
            const visualGroup = new THREE.Group();
            visualGroup.name = 'visual';
            
            const collisionGroup = new THREE.Group();
            collisionGroup.name = 'collision';
            (collisionGroup as any).isURDFCollider = true;
            collisionGroup.visible = false; // Hidden by default

            for (const geom of geoms) {
                // Classification based on observed MJCF patterns:
                // - group="1" with contype="0" conaffinity="0" = visual only
                // - No group attribute = collision (may also be visual if has mesh+rgba)
                // - Primitives (sphere/box/cylinder) with just size = collision only
                
                const hasGroup1 = geom.group === 1;
                const hasContype0 = geom.contype === 0 && geom.conaffinity === 0;
                const hasMesh = geom.mesh !== undefined;
                const isPrimitive = !hasMesh && geom.type !== 'mesh';
                
                // Visual: explicit group=1 with contype=0
                const isVisualGeom = hasGroup1 && hasContype0;
                
                // Collision: no group attribute, OR primitives without group
                // In MJCF, geoms without group are typically collision duplicates
                const isCollisionGeom = geom.group === undefined || geom.group === 0 || geom.group === 3;

                // Create mesh for this geom
                const mesh = await createGeometryMesh(geom, meshMap, assets, meshCache);
                if (!mesh) continue;

                // Apply geom position
                if (geom.pos) {
                    mesh.position.set(geom.pos[0], geom.pos[1], geom.pos[2]);
                }

                // Apply geom rotation (MuJoCo quaternion: w,x,y,z)
                if (geom.quat) {
                    const q = new THREE.Quaternion(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0]);
                    mesh.quaternion.copy(q);
                }

                // Apply color
                if (geom.rgba) {
                    applyRgbaToMesh(mesh, geom.rgba);
                }

                mesh.name = geom.name || geom.type || 'geom';

                // Add to visual group if visual
                if (isVisualGeom) {
                    // Mark all meshes in this object as visual
                    mesh.userData.isVisual = true;
                    mesh.userData.isVisualMesh = true;
                    mesh.traverse((child: any) => {
                        if (child.isMesh) {
                            child.userData.isVisual = true;
                            child.userData.isVisualMesh = true;
                        }
                    });
                    visualGroup.add(mesh);
                }
                
                // Add to collision group if collision
                if (isCollisionGeom) {
                    // Clone if already added to visual, otherwise use directly
                    const collisionMesh = isVisualGeom ? mesh.clone(true) : mesh;
                    collisionMesh.userData.isCollisionMesh = true;
                    collisionMesh.userData.isCollision = true;
                    
                    // Apply semi-transparent material for collision visualization
                    collisionMesh.traverse((child: any) => {
                        if (child.isMesh) {
                            child.userData.isCollisionMesh = true;
                            child.userData.isCollision = true;
                            const collisionMat = createMatteMaterial({
                                color: 0xa855f7,
                                opacity: 0.35,
                                transparent: true,
                                name: 'mjcf_collision'
                            });
                            // Apply depth and rendering optimizations
                            collisionMat.depthWrite = false;
                            collisionMat.depthTest = true;
                            collisionMat.polygonOffset = true;
                            collisionMat.polygonOffsetFactor = -1.0;
                            collisionMat.polygonOffsetUnits = -4.0;
                            child.material = collisionMat;
                            child.renderOrder = 999;
                        }
                    });
                    
                    collisionGroup.add(collisionMesh);
                }
                
                // If neither visual nor collision classification matches, default to visual
                if (!isVisualGeom && !isCollisionGeom) {
                    visualGroup.add(mesh);
                }
            }

            // Mark groups with proper userData for visibility control
            visualGroup.userData.isVisualGroup = true;
            collisionGroup.userData.isCollisionGroup = true;
            
            // Add visual and collision groups to target
            if (visualGroup.children.length > 0) {
                targetGroup.add(visualGroup);
            }
            if (collisionGroup.children.length > 0) {
                targetGroup.add(collisionGroup);
            }
        }

        // Build all top-level bodies
        for (const body of bodies) {
            await buildBody(body, rootGroup, true);
        }

        // Attach links and joints maps
        (rootGroup as any).links = linksMap;
        (rootGroup as any).joints = jointsMap;

        console.log(`[MJCFLoader] Loaded model "${modelName}" with ${Object.keys(linksMap).length} links and ${Object.keys(jointsMap).length} joints`);
    
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
