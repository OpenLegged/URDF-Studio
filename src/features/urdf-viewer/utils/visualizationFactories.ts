import * as THREE from 'three';

/**
 * Create a visual arrow indicator for joint axis (used for both URDF and MJCF joints).
 * Color: Red for X, Green for Y, Blue for Z dominant component.
 */
export function createJointAxisVisualization(axis: THREE.Vector3, size: number = 1.0): THREE.Object3D {
    const length = 0.15 * size;
    const group = new THREE.Group();
    group.name = '__joint_axis_helper__';
    group.userData.isGizmo = true;

    // Determine color based on dominant axis
    const absAxis = new THREE.Vector3(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z));
    let color: number;
    if (absAxis.x >= absAxis.y && absAxis.x >= absAxis.z) {
        color = 0xff4444; // Red for X
    } else if (absAxis.y >= absAxis.x && absAxis.y >= absAxis.z) {
        color = 0x44ff44; // Green for Y
    } else {
        color = 0x4444ff; // Blue for Z
    }

    // Create arrow shaft (cylinder)
    const shaftGeom = new THREE.CylinderGeometry(0.005, 0.005, length * 0.8, 8);
    const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
    shaft.position.y = length * 0.4;
    shaft.userData.isGizmo = true;
    shaft.raycast = () => {};
    shaft.renderOrder = 1001;
    group.add(shaft);

    // Create arrow head (cone)
    const headGeom = new THREE.ConeGeometry(0.015, length * 0.2, 8);
    const headMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });
    const head = new THREE.Mesh(headGeom, headMat);
    head.position.y = length * 0.9;
    head.userData.isGizmo = true;
    head.raycast = () => {};
    head.renderOrder = 1001;
    group.add(head);

    // Align the arrow (default points +Y) to the axis direction
    const targetDir = axis.clone().normalize();
    const upDir = new THREE.Vector3(0, 1, 0);
    if (Math.abs(targetDir.dot(upDir)) < 0.999) {
        const quaternion = new THREE.Quaternion().setFromUnitVectors(upDir, targetDir);
        group.quaternion.copy(quaternion);
    }

    return group;
}

/**
 * Create origin axes visualization (RGB = XYZ) for a link
 */
export function createOriginAxes(size: number): THREE.Group {
    const originAxes = new THREE.Group();
    originAxes.name = '__origin_axes__';
    originAxes.userData = { isGizmo: true };

    const thickness = size * 0.04;
    const headSize = size * 0.2;
    const headRadius = thickness * 2.5;

    // X Axis - Red
    const xAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
    const xAxisMat = new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false });
    const xAxis = new THREE.Mesh(xAxisGeom, xAxisMat);
    xAxis.rotation.set(0, 0, -Math.PI / 2);
    xAxis.position.set(size / 2, 0, 0);
    xAxis.userData = { isGizmo: true };
    xAxis.raycast = () => {};
    xAxis.renderOrder = 999;
    originAxes.add(xAxis);

    const xConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
    const xCone = new THREE.Mesh(xConeGeom, xAxisMat);
    xCone.rotation.set(0, 0, -Math.PI / 2);
    xCone.position.set(size, 0, 0);
    xCone.userData = { isGizmo: true };
    xCone.raycast = () => {};
    xCone.renderOrder = 999;
    originAxes.add(xCone);

    // Y Axis - Green
    const yAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
    const yAxisMat = new THREE.MeshBasicMaterial({ color: 0x22c55e, depthTest: false });
    const yAxis = new THREE.Mesh(yAxisGeom, yAxisMat);
    yAxis.position.set(0, size / 2, 0);
    yAxis.userData = { isGizmo: true };
    yAxis.raycast = () => {};
    yAxis.renderOrder = 999;
    originAxes.add(yAxis);

    const yConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
    const yCone = new THREE.Mesh(yConeGeom, yAxisMat);
    yCone.position.set(0, size, 0);
    yCone.userData = { isGizmo: true };
    yCone.raycast = () => {};
    yCone.renderOrder = 999;
    originAxes.add(yCone);

    // Z Axis - Blue
    const zAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
    const zAxisMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, depthTest: false });
    const zAxis = new THREE.Mesh(zAxisGeom, zAxisMat);
    zAxis.rotation.set(Math.PI / 2, 0, 0);
    zAxis.position.set(0, 0, size / 2);
    zAxis.userData = { isGizmo: true };
    zAxis.raycast = () => {};
    zAxis.renderOrder = 999;
    originAxes.add(zAxis);

    const zConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
    const zCone = new THREE.Mesh(zConeGeom, zAxisMat);
    zCone.rotation.set(Math.PI / 2, 0, 0);
    zCone.position.set(0, 0, size);
    zCone.userData = { isGizmo: true };
    zCone.raycast = () => {};
    zCone.renderOrder = 999;
    originAxes.add(zCone);

    return originAxes;
}

/**
 * Create joint axis visualization with rotation/translation indicators
 */
export function createJointAxisViz(
    jointType: string,
    axis: THREE.Vector3,
    scale: number
): THREE.Group {
    const jointAxisViz = new THREE.Group();
    jointAxisViz.name = '__joint_axis__';
    jointAxisViz.userData = { isGizmo: true, originalScale: scale };

    const axisVec = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVec);

    const color = 0xd946ef; // Purple/magenta

    // Arrow for axis direction
    const arrowLength = 0.35 * scale;
    const arrowHeadLength = 0.08 * scale;
    const arrowHeadWidth = 0.05 * scale;

    // Arrow shaft
    const shaftGeom = new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, arrowLength - arrowHeadLength, 8);
    const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const shaft = new THREE.Mesh(shaftGeom, shaftMat);
    shaft.rotation.set(Math.PI / 2, 0, 0);
    shaft.position.set(0, 0, (arrowLength - arrowHeadLength) / 2);
    shaft.userData = { isGizmo: true };
    shaft.raycast = () => {};
    shaft.renderOrder = 999;
    jointAxisViz.add(shaft);

    // Arrow head
    const headGeom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
    const head = new THREE.Mesh(headGeom, shaftMat);
    head.rotation.set(Math.PI / 2, 0, 0);
    head.position.set(0, 0, arrowLength - arrowHeadLength / 2);
    head.userData = { isGizmo: true };
    head.raycast = () => {};
    head.renderOrder = 999;
    jointAxisViz.add(head);

    // For revolute/continuous joints, add rotation indicator (torus)
    if (jointType === 'revolute' || jointType === 'continuous') {
        const torusRadius = 0.15 * scale;
        const tubeRadius = 0.005 * scale;
        const torusArc = jointType === 'revolute' ? Math.PI * 1.5 : Math.PI * 2;
        const torusGeom = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, 32, torusArc);
        const torus = new THREE.Mesh(torusGeom, shaftMat);
        torus.userData = { isGizmo: true };
        torus.raycast = () => {};
        torus.renderOrder = 999;
        jointAxisViz.add(torus);

        // Small arrow on torus to indicate rotation direction
        const miniConeGeom = new THREE.ConeGeometry(0.015 * scale, 0.04 * scale, 8);
        const miniCone = new THREE.Mesh(miniConeGeom, shaftMat);
        miniCone.position.set(torusRadius, 0, 0);
        miniCone.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
        miniCone.userData = { isGizmo: true };
        miniCone.raycast = () => {};
        miniCone.renderOrder = 999;
        jointAxisViz.add(miniCone);
    }

    // For prismatic joints, add bidirectional arrow
    if (jointType === 'prismatic') {
        // Second arrow in opposite direction
        const shaft2Geom = new THREE.CylinderGeometry(0.008 * scale, 0.008 * scale, arrowLength - arrowHeadLength, 8);
        const shaft2 = new THREE.Mesh(shaft2Geom, shaftMat);
        shaft2.rotation.set(-Math.PI / 2, 0, 0);
        shaft2.position.set(0, 0, -(arrowLength - arrowHeadLength) / 2);
        shaft2.userData = { isGizmo: true };
        shaft2.raycast = () => {};
        shaft2.renderOrder = 999;
        jointAxisViz.add(shaft2);

        const head2Geom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
        const head2 = new THREE.Mesh(head2Geom, shaftMat);
        head2.rotation.set(-Math.PI / 2, 0, 0);
        head2.position.set(0, 0, -(arrowLength - arrowHeadLength / 2));
        head2.userData = { isGizmo: true };
        head2.raycast = () => {};
        head2.renderOrder = 999;
        jointAxisViz.add(head2);
    }

    // Apply axis rotation
    jointAxisViz.quaternion.copy(quaternion);

    return jointAxisViz;
}

/**
 * Create Center of Mass (CoM) visualization - checkered sphere
 */
export function createCoMVisual(): THREE.Group {
    const comVisual = new THREE.Group();
    comVisual.name = '__com_visual__';
    comVisual.userData = { isGizmo: true };

    // Fixed radius for CoM sphere (0.01m = 1cm)
    const radius = 0.01;
    const geometry = new THREE.SphereGeometry(radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2);
    const matBlack = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, transparent: true, opacity: 0.8 });
    matBlack.userData = { isSharedMaterial: true };  // Prevent opacity modification
    const matWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 });
    matWhite.userData = { isSharedMaterial: true };  // Prevent opacity modification

    const positions = [
        [0, 0, 0], [0, Math.PI / 2, 0], [0, Math.PI, 0], [0, -Math.PI / 2, 0],
        [Math.PI, 0, 0], [Math.PI, Math.PI / 2, 0], [Math.PI, Math.PI, 0], [Math.PI, -Math.PI / 2, 0]
    ];

    positions.forEach((rot, i) => {
        const mesh = new THREE.Mesh(geometry, (i % 2 === 0) ? matBlack : matWhite);
        mesh.rotation.set(rot[0], rot[1], rot[2]);
        mesh.renderOrder = 10001;
        mesh.userData = { isGizmo: true };
        mesh.raycast = () => { };
        comVisual.add(mesh);
    });

    return comVisual;
}

/**
 * Create inertia box visualization
 */
export function createInertiaBox(
    width: number,
    height: number,
    depth: number,
    rotation: THREE.Quaternion
): THREE.Group {
    const inertiaBox = new THREE.Group();
    inertiaBox.name = '__inertia_box__';
    inertiaBox.userData = { isGizmo: true };

    const geom = new THREE.BoxGeometry(width, height, depth);

    const mat = new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        depthTest: false
    });
    mat.userData = { isSharedMaterial: true };  // Prevent opacity modification
    const mesh = new THREE.Mesh(geom, mat);
    mesh.quaternion.copy(rotation);
    mesh.userData = { isGizmo: true };
    mesh.raycast = () => { };
    mesh.renderOrder = 9999;
    inertiaBox.add(mesh);

    const edges = new THREE.EdgesGeometry(geom);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        depthTest: false
    });
    lineMat.userData = { isSharedMaterial: true };  // Prevent opacity modification
    const line = new THREE.LineSegments(edges, lineMat);
    line.quaternion.copy(rotation);
    line.userData = { isGizmo: true };
    line.raycast = () => { };
    line.renderOrder = 10000;
    inertiaBox.add(line);

    return inertiaBox;
}
