import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

import type { UsdSceneSnapshot } from '@/types';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import { adaptUsdViewerSnapshotToRobotData } from '@/lib/robot-parser/usd/usdViewerRobotAdapter';
import { hydrateUsdViewerRobotResolutionFromRuntime } from './usdRuntimeRobotHydration';
import { prepareUsdExportCacheFromResolvedSnapshot } from './usdExportBundle';

test('preserves reflected body geometry in the proper rotation frame of a USD physics joint', async () => {
  // BotWorld cooker001 authors a reflected knob body. Its USD physics frame
  // retains a proper RotX(pi), so the geometry must retain the residual basis.
  const childPosition = [0.062741, -0.2401672, 0.0849139];
  const positions = [0, 0, 0, 0.012, 0.004, 0, 0, 0.017, 0.008];
  const childWorld = new THREE.Matrix4().makeScale(-1, 1, 1)
    .setPosition(new THREE.Vector3().fromArray(childPosition));
  const snapshot: UsdSceneSnapshot = {
    stageSourcePath: '/cooker.usd',
    stage: { defaultPrimPath: '/root', metersPerUnit: 1 },
    robotTree: { rootLinkPaths: ['/root/body'] },
    robotMetadataSnapshot: {
      source: 'usd-stage-cpp',
      jointCatalogEntries: [{
        jointName: 'knob_joint',
        jointTypeName: 'PhysicsRevoluteJoint',
        parentLinkPath: '/root/body',
        childLinkPath: '/root/knob',
        localPos0: childPosition,
        localPos1: [0, 0, 0],
        localRot0Wxyz: [0, 1, 0, 0],
        localRot1Wxyz: [1, 0, 0, 0],
        axisToken: 'X',
      }],
    },
    render: { meshDescriptors: [{
      meshId: '/root/knob/visuals.proto_mesh_id0',
      resolvedPrimPath: '/root/knob/Part',
      sectionName: 'visuals',
      primType: 'mesh',
      ranges: {
        positions: { offset: 0, count: positions.length, stride: 3 },
        transform: { offset: 0, count: 16, stride: 16 },
      },
    }] },
    buffers: { positions: new Float32Array(positions), transforms: childWorld.elements },
  };
  const resolution = adaptUsdViewerSnapshotToRobotData(snapshot);
  assert.ok(resolution);
  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot, {
    getPreferredLinkWorldTransform: (path) =>
      path === '/root/knob' ? childWorld : new THREE.Matrix4(),
    getWorldTransformForPrimPath: (path) => path.startsWith('/root/knob') ? childWorld : null,
  });
  assert.ok(hydrated);
  const prepared = prepareUsdExportCacheFromResolvedSnapshot(snapshot, hydrated);
  const link = prepared.robotData.links.knob;
  assert.ok(link.visual.meshPath);
  const worldMatrices = computeLinkWorldMatrices(prepared.robotData);
  const actualWorld = worldMatrices[link.id].clone()
    .multiply(createOriginMatrix(link.visual.origin))
    .scale(new THREE.Vector3(link.visual.dimensions.x, link.visual.dimensions.y, link.visual.dimensions.z));
  const obj = new OBJLoader().parse(await prepared.meshFiles[link.visual.meshPath].text());
  const mesh = obj.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  assert.ok(mesh);
  const exportedPositions = mesh.geometry.getAttribute('position');
  for (let vertex = 0; vertex < 3; vertex += 1) {
    const expected = new THREE.Vector3().fromArray(positions, vertex * 3).applyMatrix4(childWorld);
    const actual = new THREE.Vector3().fromBufferAttribute(exportedPositions, vertex).applyMatrix4(actualWorld);
    assert.ok(actual.distanceTo(expected) < 1e-7, `vertex ${vertex}: expected ${expected.toArray()}, got ${actual.toArray()}`);
  }
  mesh.geometry.dispose();
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((material) => material.dispose());
});


test('attaches mass-bearing mesh descendants to their authored body through missing hierarchy edges', () => {
  const bodyMeshPath = '/root/body/translatedPart/BodyMesh';
  const switchMeshPath = '/root/switch/translatedPart/SwitchMesh';
  const bodyMeshWorld = new THREE.Matrix4().makeTranslation(-0.1563896, -0.0266853, 0);
  const switchWorld = new THREE.Matrix4().makeTranslation(0.13, 0, 0.008);
  const switchMeshWorld = switchWorld.clone().multiply(new THREE.Matrix4().makeTranslation(0.01, 0.02, 0.03));
  const snapshot: UsdSceneSnapshot = {
    stageSourcePath: '/faucet.usd',
    stage: { defaultPrimPath: '/root', metersPerUnit: 1 },
    robotTree: { rootLinkPaths: ['/root/body'] },
    robotMetadataSnapshot: {
      source: 'usd-stage-cpp',
      jointCatalogEntries: [{
        jointName: 'switch_joint',
        jointTypeName: 'PhysicsRevoluteJoint',
        parentLinkPath: '/root/body',
        childLinkPath: '/root/switch',
        localPos0: [0.13, 0, 0.008],
        localPos1: [0, 0, 0],
        localRot0Wxyz: [1, 0, 0, 0],
        localRot1Wxyz: [1, 0, 0, 0],
        axisToken: 'Z',
      }],
      linkDynamicsEntries: [
        { linkPath: bodyMeshPath, mass: 0.1 },
        { linkPath: switchMeshPath, mass: 0.02 },
      ],
    },
    render: { meshDescriptors: [bodyMeshPath, switchMeshPath].map((path, index) => ({
      meshId: `/root/visuals.proto_mesh_id${index}`,
      resolvedPrimPath: path,
      sectionName: 'visuals',
      primType: 'mesh',
      ranges: { transform: { offset: index * 16, count: 16, stride: 16 } },
    })) },
    buffers: { transforms: [...bodyMeshWorld.elements, ...switchMeshWorld.elements] },
  };
  const sourceWorldByPath = new Map([
    ['/root/body', new THREE.Matrix4()], ['/root/switch', switchWorld],
    [bodyMeshPath, bodyMeshWorld], [switchMeshPath, switchMeshWorld],
  ]);
  const resolution = adaptUsdViewerSnapshotToRobotData(snapshot);
  assert.ok(resolution);
  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot, {
    getPreferredLinkWorldTransform: (path) => sourceWorldByPath.get(path),
    getWorldTransformForPrimPath: (path) => sourceWorldByPath.get(path),
  });
  assert.ok(hydrated);
  const worldMatrices = computeLinkWorldMatrices(hydrated.robotData);
  for (const [path, expected] of [[bodyMeshPath, bodyMeshWorld], [switchMeshPath, switchMeshWorld]] as const) {
    const link = hydrated.robotData.links[hydrated.linkIdByPath[path]];
    const actual = worldMatrices[link.id].clone().multiply(createOriginMatrix(link.visual.origin));
    const actualPoint = new THREE.Vector3(0.012, 0.017, 0.008).applyMatrix4(actual);
    const expectedPoint = new THREE.Vector3(0.012, 0.017, 0.008).applyMatrix4(expected);
    assert.ok(actualPoint.distanceTo(expectedPoint) < 1e-7, `${path} must retain its authored world pose`);
  }
  hydrated.robotData.joints.switch_joint.angle = 0.3;
  const movedWorld = computeLinkWorldMatrices(hydrated.robotData);
  const switchMeshId = hydrated.linkIdByPath[switchMeshPath];
  const expectedMoved = switchWorld.clone().multiply(new THREE.Matrix4().makeRotationZ(0.3))
    .multiply(new THREE.Matrix4().makeTranslation(0.01, 0.02, 0.03));
  const actualPoint = new THREE.Vector3().setFromMatrixPosition(movedWorld[switchMeshId]);
  assert.ok(actualPoint.distanceTo(new THREE.Vector3().setFromMatrixPosition(expectedMoved)) < 1e-7);
});


test('does not add hierarchy edges between authored bodies when USD prim ancestry opposes the joint graph', () => {
  const snapshot: UsdSceneSnapshot = {
    stage: { defaultPrimPath: '/root' },
    robotMetadataSnapshot: {
      source: 'usd-stage-cpp',
      jointCatalogEntries: [{
        jointName: 'authored_joint',
        jointTypeName: 'PhysicsRevoluteJoint',
        parentLinkPath: '/root/body/nestedOwner',
        childLinkPath: '/root/body',
        axisToken: 'Z',
      }],
    },
  };
  const resolution = adaptUsdViewerSnapshotToRobotData(snapshot);
  assert.ok(resolution);
  assert.equal(Object.keys(resolution.robotData.joints).length, 1);
  assert.equal(resolution.robotData.rootLinkId, resolution.linkIdByPath['/root/body/nestedOwner']);
});


for (const [reflectedParent, reflectedChild] of [[false, false], [true, false], [false, true], [true, true]]) {
  for (const jointTypeName of ['PhysicsRevoluteJoint', 'PhysicsPrismaticJoint']) {
    test(`bakes body scale into both USD joint anchors (${jointTypeName}, reflected parent: ${reflectedParent}, child: ${reflectedChild})`, async () => {
      const parentScale = new THREE.Vector3(0.0272599, 0.0252848, 0.0306951)
        .multiplyScalar(reflectedParent ? -1 : 1);
      const childScale = new THREE.Vector3(0.971404622, 1, 1.215)
        .multiplyScalar(reflectedChild ? -1 : 1);
      const parentRigid = new THREE.Matrix4().compose(
        new THREE.Vector3(-0.0021442, 0.031702, 0.1508495),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, -0.2, 0.4)),
        new THREE.Vector3(1, 1, 1),
      );
      const parentWorld = parentRigid.clone().scale(parentScale);
      const localPos0 = new THREE.Vector3(-8.09867954, -6.3625536, -4.67743063);
      const localPos1 = new THREE.Vector3(0.025, -0.034, 0.013);
      const rotation0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      const rotation1 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.3);
      const parentFrame = new THREE.Matrix4().compose(localPos0.clone().multiply(parentScale), rotation0, new THREE.Vector3(1, 1, 1));
      const childFrame = new THREE.Matrix4().compose(localPos1.clone().multiply(childScale), rotation1, new THREE.Vector3(1, 1, 1));
      const childRigid = parentRigid.clone().multiply(parentFrame).multiply(childFrame.clone().invert());
      const childWorld = childRigid.clone().scale(childScale);
      const axisLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation1);
      const positions = [0.03, 0.01, -0.02, -0.04, 0.06, 0.02, 0.05, -0.02, 0.07];
      const snapshot: UsdSceneSnapshot = {
        stageSourcePath: '/scaled-joint.usd',
        stage: { defaultPrimPath: '/root', metersPerUnit: 1 },
        robotTree: { rootLinkPaths: ['/root/body'] },
        robotMetadataSnapshot: {
          source: 'usd-stage-cpp',
          jointCatalogEntries: [{
            jointName: 'scaled_joint', jointTypeName,
            parentLinkPath: '/root/body', childLinkPath: '/root/child',
            localPos0: localPos0.toArray(), localPos1: localPos1.toArray(),
            localRot0Wxyz: [rotation0.w, rotation0.x, rotation0.y, rotation0.z],
            localRot1Wxyz: [rotation1.w, rotation1.x, rotation1.y, rotation1.z],
            axisToken: 'Y', axisLocal: axisLocal.toArray(),
            lowerLimitDeg: -0.25, upperLimitDeg: 0.25,
          }],
        },
        render: { meshDescriptors: [{
          meshId: '/root/child/visuals.proto_mesh_id0', resolvedPrimPath: '/root/child/Part',
          sectionName: 'visuals', primType: 'mesh',
          ranges: {
            positions: { offset: 0, count: positions.length, stride: 3 },
            transform: { offset: 0, count: 16, stride: 16 },
          },
        }] },
        buffers: { positions: new Float32Array(positions), transforms: childWorld.elements },
      };
      const resolution = adaptUsdViewerSnapshotToRobotData(snapshot);
      assert.ok(resolution);
      const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot, {
        getPreferredLinkWorldTransform: (path) => path === '/root/body' ? parentWorld : childWorld,
        getWorldTransformForPrimPath: (path) => path === '/root/body' ? parentWorld : childWorld,
      });
      assert.ok(hydrated);
      const joint = hydrated.robotData.joints.scaled_joint;
      const expectedPivot = localPos1.clone().multiply(childScale);
      assert.ok(new THREE.Vector3(joint.usdPhysics?.localPos1?.x, joint.usdPhysics?.localPos1?.y, joint.usdPhysics?.localPos1?.z)
        .distanceTo(expectedPivot) < 1e-10, 'child motion pivot must absorb child body scale');
      assert.deepEqual(joint.axis, { x: axisLocal.x, y: axisLocal.y, z: axisLocal.z });
      if (jointTypeName === 'PhysicsPrismaticJoint') {
        assert.equal(joint.limit?.lower, -0.25, 'stage distance limits must not absorb body scale');
        assert.equal(joint.limit?.upper, 0.25);
      }
      const prepared = prepareUsdExportCacheFromResolvedSnapshot(snapshot, hydrated);
      const link = prepared.robotData.links.child;
      assert.ok(link.visual.meshPath);
      const obj = new OBJLoader().parse(await prepared.meshFiles[link.visual.meshPath].text());
      const mesh = obj.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      assert.ok(mesh);
      for (const angle of [0, 0.2]) {
        prepared.robotData.joints.scaled_joint.angle = angle;
        const motion = jointTypeName === 'PhysicsPrismaticJoint'
          ? new THREE.Matrix4().makeTranslation(0, angle, 0)
          : new THREE.Matrix4().makeRotationY(angle);
        const expectedWorld = parentRigid.clone().multiply(parentFrame).multiply(motion)
          .multiply(childFrame.clone().invert()).scale(childScale);
        const actualWorld = computeLinkWorldMatrices(prepared.robotData)[link.id].clone()
          .multiply(createOriginMatrix(link.visual.origin))
          .scale(new THREE.Vector3(link.visual.dimensions.x, link.visual.dimensions.y, link.visual.dimensions.z));
        for (let vertex = 0; vertex < 3; vertex += 1) {
          const expected = new THREE.Vector3().fromArray(positions, vertex * 3).applyMatrix4(expectedWorld);
          const actual = new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute('position'), vertex).applyMatrix4(actualWorld);
          assert.ok(actual.distanceTo(expected) < 1e-7, `angle ${angle}, vertex ${vertex}: expected ${expected.toArray()}, got ${actual.toArray()}`);
        }
      }
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    });
  }
}


test('preserves the source mesh pose when authored USD joint anchors disagree with the body pose', () => {
  // BotWorld storage box004 has a 1.165 mm offset transverse to its Y slide.
  const anchorHeight = 0.220026895404;
  const sourceHeight = 0.221192392470;
  const childWorld = new THREE.Matrix4().makeTranslation(0, 0, sourceHeight);
  const snapshot: UsdSceneSnapshot = {
    stage: { defaultPrimPath: '/root', metersPerUnit: 1 },
    robotTree: { rootLinkPaths: ['/root/body'] },
    robotMetadataSnapshot: {
      source: 'usd-stage-cpp',
      jointCatalogEntries: [{
        jointName: 'tray_joint', jointTypeName: 'PhysicsPrismaticJoint',
        parentLinkPath: '/root/body', childLinkPath: '/root/tray',
        localPos0: [0, 0, anchorHeight], localPos1: [0, 0, 0],
        localRot0Wxyz: [1, 0, 0, 0], localRot1Wxyz: [1, 0, 0, 0], axisToken: 'Y',
      }],
    },
    render: { meshDescriptors: [{
      meshId: '/root/tray/visuals.proto_mesh_id0', resolvedPrimPath: '/root/tray/Part',
      sectionName: 'visuals', primType: 'mesh',
      ranges: { transform: { offset: 0, count: 16, stride: 16 } },
    }] },
    buffers: { transforms: childWorld.elements },
  };
  const resolution = adaptUsdViewerSnapshotToRobotData(snapshot);
  assert.ok(resolution);
  const hydrated = hydrateUsdViewerRobotResolutionFromRuntime(resolution, snapshot, {
    getPreferredLinkWorldTransform: (path) => path === '/root/body' ? new THREE.Matrix4() : childWorld,
    getWorldTransformForPrimPath: (path) => path === '/root/body' ? new THREE.Matrix4() : childWorld,
  });
  assert.ok(hydrated);
  const joint = hydrated.robotData.joints.tray_joint;
  assert.equal(joint.origin?.xyz.z, anchorHeight);
  assert.equal(joint.usdPhysics?.localPos0?.z, anchorHeight, 'source joint anchor must remain unchanged');
  const link = hydrated.robotData.links.tray;
  for (const displacement of [0, 0.1]) {
    joint.angle = displacement;
    const actualWorld = computeLinkWorldMatrices(hydrated.robotData)[link.id].clone()
      .multiply(createOriginMatrix(link.visual.origin));
    assert.ok(new THREE.Vector3().setFromMatrixPosition(actualWorld)
      .distanceTo(new THREE.Vector3(0, displacement, sourceHeight)) < 1e-10);
  }
});
