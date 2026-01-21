import * as THREE from 'three';

// ============================================================
// PERFORMANCE: Flat index structure for O(1) runtime access
// Eliminates all traverse() calls during hover, selection, sync
// ============================================================

// Inertial data structure for physics calculations
export interface InertialData {
    mass: number;
    centerOfMass: { x: number; y: number; z: number };
    // Inertia tensor (3x3 matrix as flat array or object)
    inertia: {
        ixx: number; ixy: number; ixz: number;
        iyy: number; iyz: number;
        izz: number;
    };
    // Origin transform
    origin?: {
        xyz: { x: number; y: number; z: number };
        rpy: { r: number; p: number; y: number };
    };
    // Sensor flag - true if mass is 0 (like imu, radar, lidar)
    isSensor?: boolean;
}

// Joint dynamics data
export interface JointData {
    jointType: string;
    axis: { x: number; y: number; z: number };
    limit: { lower: number; upper: number; effort?: number; velocity?: number };
    // Affected meshes for partial matrix update
    affectedMeshes: THREE.Mesh[];
}

export interface RobotIndex {
    // linkName -> array of visual meshes
    linksVisual: Map<string, THREE.Mesh[]>;
    // linkName -> array of collision meshes
    linksCollision: Map<string, THREE.Mesh[]>;
    // jointName -> joint object with flattened properties
    joints: Map<string, THREE.Object3D>;
    // jointName -> flattened joint data (limit, axis, affected meshes)
    jointData: Map<string, JointData>;
    // materialId -> original material (for restoration)
    originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    // All meshes that are part of kinematic chain (need matrix updates)
    kinematicMeshes: Set<THREE.Mesh>;
    // Static visual meshes (matrixAutoUpdate = false candidates)
    staticMeshes: Set<THREE.Mesh>;
    // linkName -> link object
    links: Map<string, THREE.Object3D>;
    // linkName -> inertial data (mass, CoM, inertia matrix)
    linkInertials: Map<string, InertialData>;
    // mesh -> linkName (reverse lookup)
    meshToLink: Map<THREE.Mesh, string>;
    // mesh -> isCollider flag
    meshIsCollider: Map<THREE.Mesh, boolean>;
    // jointName -> Set of child meshes affected by this joint
    jointAffectedMeshes: Map<string, Set<THREE.Mesh>>;
}

// ============================================================
// POOLED OBJECTS: Reuse across all index operations
// Zero-GC strategy - no allocations during runtime
// ============================================================
const _tempVec3 = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempMatrix = new THREE.Matrix4();

// Pre-allocated result object for extractInertialData (avoid GC)
const _inertialResultPool: InertialData = {
    mass: 0,
    centerOfMass: { x: 0, y: 0, z: 0 },
    inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    isSensor: false
};

// Collision name patterns to detect collision meshes by naming convention
// Ordered by frequency for Go2 robot structure
const COLLISION_NAME_PATTERNS = [
    '_collision',
    'collision_',
    '_collision_',
    'collider',
    '_col_',
    '_col',
    'col_',
    'Collision',
    'COL_',
    'COL'
];

// Pre-compiled regex for collision path matching (faster than includes)
const COLLISION_PATH_REGEX = /(?:^|[_\/])(?:collision|collider|col)(?:[_\/]|$)/i;

// Create empty index
export const createEmptyIndex = (): RobotIndex => ({
    linksVisual: new Map(),
    linksCollision: new Map(),
    joints: new Map(),
    jointData: new Map(),
    originalMaterials: new Map(),
    kinematicMeshes: new Set(),
    staticMeshes: new Set(),
    links: new Map(),
    linkInertials: new Map(),
    meshToLink: new Map(),
    meshIsCollider: new Map(),
    jointAffectedMeshes: new Map(),
});

// ============================================================
// HELPER: Deep collision detection (OPTIMIZED for Go2 structure)
// Priority: 1) Class/Type flags 2) userData 3) Regex path match
// Traces up to robot root with early exit on first match
// ============================================================
const isCollisionMeshDeep = (
    mesh: THREE.Object3D,
    robot: THREE.Object3D
): boolean => {
    let current: THREE.Object3D | null = mesh;
    let foundCollider = false;

    // PHASE 1: Fast check - class/type flags (most reliable for urdf-loader)
    while (current && current !== robot) {
        // Check URDF loader class flag (fastest check)
        if ((current as any).isURDFCollider) {
            foundCollider = true;
            break;
        }

        // Check type property from URDFClasses
        if ((current as any).type === 'URDFCollider') {
            foundCollider = true;
            break;
        }

        // Check userData flags (set by loader or manually)
        if (current.userData?.isURDFCollider || current.userData?.isCollisionMesh) {
            foundCollider = true;
            break;
        }

        current = current.parent;
    }

    if (foundCollider) {
        return true;
    }

    // PHASE 2: Regex path match (for custom loaders or naming conventions)
    // Only if class/type check failed - build full path and test once
    current = mesh;
    while (current && current !== robot) {
        const name = current.name;
        if (name && COLLISION_PATH_REGEX.test(name)) {
            return true;
        }
        current = current.parent;
    }

    return false;
};

// NOTE: isVisualMeshDeep removed - collision detection takes priority
// Any mesh not in a URDFCollider is considered visual by default

// ============================================================
// HELPER: Find nearest URDFLink ancestor (penetrates Groups)
// ============================================================
const findNearestLink = (
    obj: THREE.Object3D,
    robot: THREE.Object3D,
    robotLinks: Record<string, any>
): { link: THREE.Object3D | null; linkName: string } => {
    let current: THREE.Object3D | null = obj.parent;
    
    while (current && current !== robot) {
        // Check isURDFLink flag
        if ((current as any).isURDFLink) {
            const linkName = current.name || (current as any).urdfName || '';
            return { link: current, linkName };
        }
        
        // Check if name matches a known link
        if (current.name && robotLinks[current.name]) {
            return { link: current, linkName: current.name };
        }
        
        // Check userData
        if (current.userData?.isURDFLink && current.userData?.linkName) {
            return { link: current, linkName: current.userData.linkName };
        }
        
        current = current.parent;
    }
    
    return { link: null, linkName: '' };
};

// ============================================================
// HELPER: Find all movable joint ancestors and track kinematic chain
// Returns the list of joints that affect this mesh
// ============================================================
const findAffectingJoints = (
    obj: THREE.Object3D,
    robot: THREE.Object3D
): THREE.Object3D[] => {
    const joints: THREE.Object3D[] = [];
    let current: THREE.Object3D | null = obj.parent;
    
    while (current && current !== robot) {
        if ((current as any).isURDFJoint) {
            const jointType = (current as any).jointType;
            if (jointType && jointType !== 'fixed') {
                joints.push(current);
            }
        }
        current = current.parent;
    }
    
    return joints;
};

// ============================================================
// HELPER: Extract inertial data from URDF link (ZERO-GC version)
// Returns a NEW object each time but with minimal allocations
// Sensors (mass=0) are marked with isSensor flag
// ============================================================
const extractInertialData = (link: any, linkName: string): InertialData | null => {
    // Try multiple sources for inertial data
    const inertial = link.inertial || link.userData?.inertial || link._inertial;
    
    if (!inertial) return null;
    
    const mass = inertial.mass ?? 0;
    
    // Detect sensors (imu, radar, lidar) - they have mass=0 but still have inertial tag
    const isSensor = mass <= 0 || 
        /(?:imu|radar|lidar|camera|sensor)/i.test(linkName);
    
    // Extract center of mass
    const origin = inertial.origin || {};
    const xyz = origin.xyz || { x: 0, y: 0, z: 0 };
    const rpy = origin.rpy || { r: 0, p: 0, y: 0 };
    
    // Extract inertia tensor
    const inertiaData = inertial.inertia || {};
    
    // Create result object (we need a new one for each link to store in Map)
    // But we minimize nested object creation by direct property assignment
    const result: InertialData = {
        mass,
        centerOfMass: { 
            x: xyz.x ?? 0, 
            y: xyz.y ?? 0, 
            z: xyz.z ?? 0 
        },
        inertia: {
            ixx: inertiaData.ixx ?? 0,
            ixy: inertiaData.ixy ?? 0,
            ixz: inertiaData.ixz ?? 0,
            iyy: inertiaData.iyy ?? 0,
            iyz: inertiaData.iyz ?? 0,
            izz: inertiaData.izz ?? 0,
        },
        origin: {
            xyz: { x: xyz.x ?? 0, y: xyz.y ?? 0, z: xyz.z ?? 0 },
            rpy: { r: rpy.r ?? rpy.roll ?? 0, p: rpy.p ?? rpy.pitch ?? 0, y: rpy.y ?? rpy.yaw ?? 0 }
        },
        isSensor
    };
    
    return result;
};

// ============================================================
// HELPER: Extract joint data (axis, limits)
// ============================================================
const extractJointData = (joint: any): JointData => {
    const jointType = joint.jointType || 'fixed';
    
    // Extract axis
    const axisRaw = joint.axis;
    let axis = { x: 0, y: 0, z: 1 }; // Default Z axis
    if (axisRaw) {
        if (axisRaw instanceof THREE.Vector3) {
            axis = { x: axisRaw.x, y: axisRaw.y, z: axisRaw.z };
        } else if (typeof axisRaw.x === 'number') {
            axis = { x: axisRaw.x, y: axisRaw.y, z: axisRaw.z };
        }
    }
    
    // Extract limits
    const limitRaw = joint.limit || {};
    const limit = {
        lower: limitRaw.lower ?? -Math.PI,
        upper: limitRaw.upper ?? Math.PI,
        effort: limitRaw.effort,
        velocity: limitRaw.velocity
    };
    
    return {
        jointType,
        axis,
        limit,
        affectedMeshes: [] // Will be populated during mesh indexing
    };
};

// ============================================================
// Build flat index from robot model (call once after URDF load)
// Single traverse, inject all metadata, build all maps
// FIXED: Deep collision detection, inertial extraction, joint data
// ============================================================
export const buildRobotIndex = (
    robot: THREE.Object3D,
    showCollision: boolean = false,
    showVisual: boolean = true
): RobotIndex => {
    const index = createEmptyIndex();
    
    // Get the links and joints objects from URDF loader
    const robotLinks = (robot as any).links || {};
    const robotJoints = (robot as any).joints || {};
    
    // ========================================
    // PHASE 1: Index all links with inertial data
    // ========================================
    for (const [linkName, link] of Object.entries(robotLinks)) {
        index.links.set(linkName, link as THREE.Object3D);
        
        // Inject link metadata
        (link as any).userData = (link as any).userData || {};
        (link as any).userData.isURDFLink = true;
        (link as any).userData.linkName = linkName;
        
        // Extract and store inertial data (pass linkName for sensor detection)
        const inertialData = extractInertialData(link, linkName);
        if (inertialData) {
            index.linkInertials.set(linkName, inertialData);
            // Also inject into userData for direct access
            (link as any).userData.inertialData = inertialData;
            // Mark sensor links to skip matrix updates
            if (inertialData.isSensor) {
                (link as any).userData.isSensor = true;
            }
        }
    }
    
    // ========================================
    // PHASE 2: Index all joints with flattened properties
    // ========================================
    for (const [jointName, joint] of Object.entries(robotJoints)) {
        index.joints.set(jointName, joint as THREE.Object3D);
        
        // Extract and flatten joint data
        const jointData = extractJointData(joint);
        index.jointData.set(jointName, jointData);
        
        // Initialize affected meshes set
        index.jointAffectedMeshes.set(jointName, new Set());
        
        // Inject flattened data into userData
        (joint as any).userData = (joint as any).userData || {};
        (joint as any).userData.isURDFJoint = true;
        (joint as any).userData.jointType = jointData.jointType;
        (joint as any).userData.axis = jointData.axis;
        (joint as any).userData.limit = jointData.limit;
    }
    
    // ========================================
    // PHASE 3: Index all meshes with deep collision detection
    // ========================================
    let debugMeshCount = 0;
    let debugCollisionCount = 0;
    let debugVisualCount = 0;

    robot.traverse((child: THREE.Object3D) => {
        // Skip gizmos
        if (child.userData?.isGizmo) return;

        // Only process meshes
        if (!(child as any).isMesh) return;

        const mesh = child as THREE.Mesh;
        debugMeshCount++;

        // DEEP COLLISION DETECTION: Check if mesh is inside a collision group
        const isCollider = isCollisionMeshDeep(mesh, robot);

        // Debug first few meshes to see hierarchy
        if (debugMeshCount <= 3) {
            const path: string[] = [];
            let curr: THREE.Object3D | null = mesh;
            while (curr && curr !== robot) {
                path.push(`${curr.name || 'unnamed'} (type=${(curr as any).type}, isURDFCollider=${!!(curr as any).isURDFCollider}, isURDFVisual=${!!(curr as any).isURDFVisual})`);
                curr = curr.parent;
            }
            console.log(`[robotIndex] Mesh #${debugMeshCount} hierarchy:`, path, `-> isCollider=${isCollider}`);
        }

        if (isCollider) {
            debugCollisionCount++;
        } else {
            debugVisualCount++;
        }

        // Final determination:
        // Priority: isCollider > default to visual
        // If a mesh is inside a URDFCollider container, it's ALWAYS a collision mesh
        // The URDF loader ensures visual and collision geometries are in separate containers
        const finalIsCollider = isCollider;
        
        // FIND NEAREST LINK: Penetrates Groups correctly
        const { link: parentLink, linkName: parentLinkName } = findNearestLink(mesh, robot, robotLinks);
        
        // FIND AFFECTING JOINTS: Build kinematic dependency tree
        const affectingJoints = findAffectingJoints(mesh, robot);
        const isInKinematicChain = affectingJoints.length > 0;
        
        // Inject comprehensive metadata into userData
        mesh.userData.parentLinkName = parentLinkName;
        mesh.userData.isCollisionMesh = finalIsCollider;
        mesh.userData.isVisualMesh = !finalIsCollider;
        mesh.userData.isInKinematicChain = isInKinematicChain;
        mesh.userData.affectingJoints = affectingJoints.map(j => j.name);
        
        // Store original material for highlight revert
        if (!index.originalMaterials.has(mesh)) {
            index.originalMaterials.set(mesh, mesh.material);
        }
        
        // Reverse lookup
        if (parentLinkName) {
            index.meshToLink.set(mesh, parentLinkName);
        }
        index.meshIsCollider.set(mesh, finalIsCollider);
        
        // Add to appropriate mesh array based on collision status
        if (parentLinkName) {
            if (finalIsCollider) {
                if (!index.linksCollision.has(parentLinkName)) {
                    index.linksCollision.set(parentLinkName, []);
                }
                index.linksCollision.get(parentLinkName)!.push(mesh);
            } else {
                if (!index.linksVisual.has(parentLinkName)) {
                    index.linksVisual.set(parentLinkName, []);
                }
                index.linksVisual.get(parentLinkName)!.push(mesh);
            }
        }
        
        // BUILD DEPENDENCY TREE: Register mesh with affecting joints
        for (let i = 0; i < affectingJoints.length; i++) {
            const jointName = affectingJoints[i].name;
            if (jointName && index.jointAffectedMeshes.has(jointName)) {
                index.jointAffectedMeshes.get(jointName)!.add(mesh);
            }
            // Also add to jointData.affectedMeshes
            const jd = index.jointData.get(jointName);
            if (jd) {
                jd.affectedMeshes.push(mesh);
            }
        }
        
        // Categorize for matrix optimization
        if (isInKinematicChain) {
            index.kinematicMeshes.add(mesh);
        } else if (!finalIsCollider) {
            index.staticMeshes.add(mesh);
        }
    });

    console.log('[robotIndex] Build complete:', {
        totalMeshes: debugMeshCount,
        collisionMeshes: debugCollisionCount,
        visualMeshes: debugVisualCount,
        linksWithVisual: index.linksVisual.size,
        linksWithCollision: index.linksCollision.size
    });

    return index;
};

// ============================================================
// O(1) Mesh retrieval functions (no traverse)
// ============================================================

export const getLinkMeshes = (
    index: RobotIndex,
    linkName: string,
    subType: 'visual' | 'collision' = 'visual'
): THREE.Mesh[] => {
    if (subType === 'collision') {
        return index.linksCollision.get(linkName) || [];
    }
    return index.linksVisual.get(linkName) || [];
};

export const getJoint = (
    index: RobotIndex,
    jointName: string
): THREE.Object3D | undefined => {
    return index.joints.get(jointName);
};

export const getLink = (
    index: RobotIndex,
    linkName: string
): THREE.Object3D | undefined => {
    return index.links.get(linkName);
};

// ============================================================
// O(1) Highlight management (no traverse)
// ============================================================

export const highlightLinkMeshes = (
    index: RobotIndex,
    linkName: string,
    highlightMaterial: THREE.Material,
    subType: 'visual' | 'collision' = 'visual',
    highlightedMeshes: Map<THREE.Mesh, THREE.Material | THREE.Material[]>
): void => {
    const meshes = getLinkMeshes(index, linkName, subType);
    
    for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        if (mesh.userData?.isGizmo) continue;
        
        // Store original if not already stored
        if (!highlightedMeshes.has(mesh)) {
            highlightedMeshes.set(mesh, mesh.material);
        }
        
        mesh.material = highlightMaterial;
        mesh.visible = true;
        if (mesh.parent) mesh.parent.visible = true;
    }
};

export const revertHighlights = (
    highlightedMeshes: Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
    showVisual: boolean,
    showCollision: boolean
): void => {
    highlightedMeshes.forEach((origMaterial, mesh) => {
        // Restore original material
        mesh.material = origMaterial;

        // Determine if this is a collision mesh
        const isCollider = mesh.userData.isCollisionMesh;

        if (isCollider) {
            // Restore collision mesh state
            mesh.visible = showCollision;

            // Restore parent URDFCollider visibility
            let parent = mesh.parent;
            while (parent) {
                if ((parent as any).isURDFCollider || (parent as any).type === 'URDFCollider') {
                    parent.visible = showCollision;
                }
                parent = parent.parent;
            }

            // Restore collision material properties (should use collision base material settings)
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (let i = 0; i < materials.length; i++) {
                const m = materials[i] as any;
                if (m) {
                    // If collision is visible, use opaque rendering
                    // If hidden, keep original material settings
                    if (showCollision) {
                        m.transparent = true;
                        m.opacity = 0.4;
                    }
                }
            }
            mesh.renderOrder = showCollision ? 999 : 0;
        } else {
            // Restore visual mesh state
            mesh.visible = showVisual;
            mesh.renderOrder = 0;

            // Restore parent URDFVisual visibility
            let parent = mesh.parent;
            while (parent) {
                if ((parent as any).isURDFVisual || (parent as any).type === 'URDFVisual') {
                    parent.visible = showVisual;
                }
                parent = parent.parent;
            }
        }
    });
    highlightedMeshes.clear();
};

// ============================================================
// Matrix optimization: freeze static nodes
// ============================================================

export const freezeStaticMatrices = (index: RobotIndex): void => {
    index.staticMeshes.forEach((mesh) => {
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.updateMatrixWorld(true);
    });
};

export const updateKinematicChain = (
    index: RobotIndex,
    changedJointName: string
): void => {
    const joint = index.joints.get(changedJointName);
    if (!joint) return;
    
    // OPTIMIZED: Use dependency tree for partial matrix update
    // Only update meshes affected by this specific joint
    const affectedMeshes = index.jointAffectedMeshes.get(changedJointName);
    
    if (affectedMeshes && affectedMeshes.size > 0) {
        // Mark joint and its descendants for matrix update
        joint.updateMatrixWorld(true);
        
        // For each affected mesh, ensure its matrix is updated
        affectedMeshes.forEach((mesh) => {
            mesh.matrixWorldNeedsUpdate = true;
        });
    } else {
        // Fallback: update from joint downward
        joint.updateMatrixWorld(true);
    }
};

// ============================================================
// Get inertial data for a link (O(1))
// ============================================================
export const getLinkInertial = (
    index: RobotIndex,
    linkName: string
): InertialData | undefined => {
    return index.linkInertials.get(linkName);
};

// ============================================================
// Get joint data (axis, limits) for a joint (O(1))
// ============================================================
export const getJointData = (
    index: RobotIndex,
    jointName: string
): JointData | undefined => {
    return index.jointData.get(jointName);
};

// ============================================================
// Get all meshes affected by a joint rotation (O(1))
// ============================================================
export const getJointAffectedMeshes = (
    index: RobotIndex,
    jointName: string
): THREE.Mesh[] => {
    const jd = index.jointData.get(jointName);
    return jd ? jd.affectedMeshes : [];
};

// ============================================================
// Sync joint angles without traverse
// ============================================================

export const syncJointAngles = (
    index: RobotIndex,
    jointAngles: Record<string, number>,
    invalidate: () => void
): void => {
    let changed = false;
    
    for (const [jointName, angle] of Object.entries(jointAngles)) {
        const joint = index.joints.get(jointName) as any;
        if (joint && joint.setJointValue) {
            const currentAngle = joint.angle || 0;
            if (Math.abs(currentAngle - angle) > 0.0001) {
                joint.setJointValue(angle);
                changed = true;
            }
        }
    }
    
    if (changed) {
        invalidate();
    }
};

// ============================================================
// Find parent link from hit object (O(1) with userData)
// ============================================================

export const findParentLinkFromMesh = (
    mesh: THREE.Object3D,
    index: RobotIndex
): string | null => {
    // Fast path: check userData first (O(1))
    if (mesh.userData?.parentLinkName) {
        return mesh.userData.parentLinkName;
    }
    
    // Fallback: check if mesh is in our map (O(1))
    if ((mesh as any).isMesh && index.meshToLink.has(mesh as THREE.Mesh)) {
        return index.meshToLink.get(mesh as THREE.Mesh) || null;
    }
    
    // Last resort: walk up parent chain (rare, only if userData wasn't set)
    let current: THREE.Object3D | null = mesh;
    while (current) {
        if (current.userData?.linkName) {
            return current.userData.linkName;
        }
        if ((current as any).isURDFLink && current.name) {
            return current.name;
        }
        if (index.links.has(current.name)) {
            return current.name;
        }
        current = current.parent;
    }
    
    return null;
};

// ============================================================
// Check if mesh is collision type (O(1))
// ============================================================

export const isMeshCollision = (
    mesh: THREE.Object3D,
    index: RobotIndex
): boolean => {
    // Fast path: userData
    if (mesh.userData?.isCollisionMesh !== undefined) {
        return mesh.userData.isCollisionMesh;
    }
    
    // Fallback: map lookup
    if ((mesh as any).isMesh) {
        return index.meshIsCollider.get(mesh as THREE.Mesh) || false;
    }
    
    return false;
};
