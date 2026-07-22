import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import type { AssemblyScenePlacement } from '@/core/robot';
import {
  DEFAULT_LINK,
  type AssemblyComponent,
  type AssemblyState,
  type AssemblyTransform,
  type RobotData,
} from '@/types';

import { resolveAssemblyComponentAutoGrounding } from './assemblyComponentAutoGrounding.ts';

function transform(x = 0, y = 0, z = 0): AssemblyTransform {
  return {
    position: { x, y, z },
    rotation: { r: 0, p: 0, y: 0 },
  };
}

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
      },
    },
    joints: {},
  };
}

function component(id: string, placement: AssemblyTransform): AssemblyComponent {
  return {
    id,
    name: id,
    sourceFile: `${id}.urdf`,
    robot: robot(id),
    transform: placement,
    visible: true,
  };
}

function workspace(components: AssemblyComponent[]): AssemblyState {
  return {
    name: 'workspace',
    transform: transform(),
    components: Object.fromEntries(components.map((entry) => [entry.id, entry])),
    bridges: {},
  };
}

function visualBox(center: THREE.Vector3, size: THREE.Vector3): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(size.x, size.y, size.z),
    new THREE.MeshBasicMaterial(),
  );
  mesh.position.copy(center);
  mesh.userData.isVisualMesh = true;
  return mesh;
}

function assembledPlacement(
  runtimeRobot: THREE.Object3D & { joints?: Record<string, THREE.Object3D> },
  targets: Record<string, THREE.Object3D>,
): AssemblyScenePlacement {
  runtimeRobot.joints = {};
  const componentTransformTargets = new Map();
  Object.entries(targets).forEach(([componentId, target]) => {
    const runtimeJointId = `joint_${componentId}`;
    runtimeRobot.joints![runtimeJointId] = target;
    componentTransformTargets.set(componentId, {
      kind: 'component-root',
      componentId,
      runtimeJointId,
    });
  });
  return {
    robotData: robot('runtime'),
    renderStrategy: 'assembled-scene',
    assemblyTransform: transform(),
    directComponentId: null,
    directComponentTransform: null,
    componentTransformTargets,
  };
}

test('grounds only the floating component across different authored mesh origins', (t) => {
  const runtimeRobot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, THREE.Object3D>;
  };
  const groundedTarget = new THREE.Group();
  const floatingTarget = new THREE.Group();
  groundedTarget.add(visualBox(new THREE.Vector3(0, 0, 0.5), new THREE.Vector3(1, 1, 1)));
  floatingTarget.position.z = 3;
  floatingTarget.add(visualBox(new THREE.Vector3(0, 0, -1), new THREE.Vector3(1, 1, 2)));
  runtimeRobot.add(groundedTarget, floatingTarget);
  const placement = assembledPlacement(runtimeRobot, {
    grounded: groundedTarget,
    floating: floatingTarget,
  });
  const state = workspace([
    component('grounded', transform()),
    component('floating', transform(4, 0, 3)),
  ]);
  t.after(() => {
    groundedTarget.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        (object as THREE.Mesh).geometry.dispose();
        ((object as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
    floatingTarget.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        (object as THREE.Mesh).geometry.dispose();
        ((object as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
  });

  const result = resolveAssemblyComponentAutoGrounding({
    componentIds: ['grounded', 'floating'],
    groundPlaneOffset: 0,
    runtimeRobot,
    scenePlacement: placement,
    workspace: state,
  });

  assert.deepEqual(result.measuredComponentIds, ['grounded', 'floating']);
  assert.equal(result.runtimeRobotLocalPositionDelta, null);
  assert.deepEqual(result.adjustments, [
    {
      componentId: 'floating',
      transform: transform(4, 0, 2),
    },
  ]);
});

test('aligns a newly appended scene minimum back to the existing component reference', (t) => {
  const runtimeRobot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, THREE.Object3D>;
  };
  const existingTarget = new THREE.Group();
  const appendedTarget = new THREE.Group();
  existingTarget.position.z = 0.003;
  existingTarget.add(visualBox(new THREE.Vector3(0, 0, 0.5), new THREE.Vector3(1, 1, 1)));
  appendedTarget.add(visualBox(new THREE.Vector3(0, 0, 0.5), new THREE.Vector3(1, 1, 1)));
  runtimeRobot.add(existingTarget, appendedTarget);
  const placement = assembledPlacement(runtimeRobot, {
    existing: existingTarget,
    appended: appendedTarget,
  });
  const state = workspace([
    component('existing', transform()),
    component('appended', transform(2, 0, 0)),
  ]);
  t.after(() => {
    existingTarget.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        (object as THREE.Mesh).geometry.dispose();
        ((object as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
    appendedTarget.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        (object as THREE.Mesh).geometry.dispose();
        ((object as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
  });

  const result = resolveAssemblyComponentAutoGrounding({
    componentIds: ['appended'],
    groundPlaneOffset: 0,
    runtimeRobot,
    scenePlacement: placement,
    workspace: state,
  });

  assert.deepEqual(result.measuredComponentIds, ['appended']);
  assert.equal(result.adjustments.length, 1);
  assert.ok(Math.abs(result.adjustments[0]!.transform.position.z - 0.003) < 1e-9);
  assert.ok(result.runtimeRobotLocalPositionDelta);
  assert.ok(Math.abs(result.runtimeRobotLocalPositionDelta!.z + 0.003) < 1e-9);
});

test('converts the world ground correction through rotated parent coordinates', (t) => {
  const assemblyRoot = new THREE.Group();
  assemblyRoot.rotation.x = Math.PI / 2;
  const runtimeRobot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, THREE.Object3D>;
  };
  const target = new THREE.Group();
  target.add(visualBox(new THREE.Vector3(0, -1.5, 0), new THREE.Vector3(1, 1, 1)));
  assemblyRoot.add(runtimeRobot);
  runtimeRobot.add(target);
  const placement = assembledPlacement(runtimeRobot, { rotated: target });
  const state = workspace([component('rotated', transform())]);
  t.after(() => {
    target.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        (object as THREE.Mesh).geometry.dispose();
        ((object as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
  });

  const result = resolveAssemblyComponentAutoGrounding({
    componentIds: ['rotated'],
    groundPlaneOffset: 0,
    runtimeRobot,
    scenePlacement: placement,
    workspace: state,
  });

  assert.equal(result.adjustments.length, 1);
  assert.equal(result.runtimeRobotLocalPositionDelta, null);
  assert.ok(Math.abs(result.adjustments[0]!.transform.position.y - 2) < 1e-9);
  assert.ok(Math.abs(result.adjustments[0]!.transform.position.z) < 1e-9);
});

test('skips bridge-owned child placement instead of overwriting component transform', (t) => {
  const runtimeRobot = new THREE.Group() as THREE.Group & {
    joints?: Record<string, THREE.Object3D>;
  };
  const target = new THREE.Group();
  target.add(visualBox(new THREE.Vector3(0, 0, 2), new THREE.Vector3(1, 1, 1)));
  runtimeRobot.add(target);
  runtimeRobot.joints = { bridge_joint: target };
  const state = workspace([component('child', transform())]);
  const placement: AssemblyScenePlacement = {
    robotData: robot('runtime'),
    renderStrategy: 'assembled-scene',
    assemblyTransform: transform(),
    directComponentId: null,
    directComponentTransform: null,
    componentTransformTargets: new Map([
      [
        'child',
        {
          kind: 'bridge',
          componentId: 'child',
          bridgeId: 'bridge',
          runtimeJointId: 'bridge_joint',
        },
      ],
    ]),
  };
  t.after(() => {
    target.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) {
        (object as THREE.Mesh).geometry.dispose();
        ((object as THREE.Mesh).material as THREE.Material).dispose();
      }
    });
  });

  const result = resolveAssemblyComponentAutoGrounding({
    componentIds: ['child'],
    groundPlaneOffset: 0,
    runtimeRobot,
    scenePlacement: placement,
    workspace: state,
  });

  assert.deepEqual(result, {
    adjustments: [],
    measuredComponentIds: [],
    runtimeRobotLocalPositionDelta: null,
  });
});
