import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, LineSegments, Points } from 'three';

import { HydraPointBased } from './HydraPointBased.js';
import { ThreeRenderDelegateInterface } from './ThreeRenderDelegateInterface.js';

function createHydraInterfaceStub() {
  return {
    config: { usdRoot: new Group() },
    materials: {},
  };
}

test('UsdGeomPoints creates THREE.Points with stable positions and vertex colors', () => {
  const hydraInterface = createHydraInterfaceStub();
  const pointPrim = new HydraPointBased('points', '/World/Particles', hydraInterface);

  pointPrim.applyUpdates({
    points: new Float32Array([0, 0, 0, 1, 2, 3]),
    primvars: [{
      name: 'displayColor',
      data: new Float32Array([1, 0, 0, 0, 1, 0]),
      dimension: 3,
      interpolation: 'vertex',
    }],
  });

  assert.ok(pointPrim._mesh instanceof Points);
  assert.equal(pointPrim._geometry.getAttribute('position').count, 2);
  assert.equal(pointPrim._geometry.getAttribute('color').count, 2);
  assert.equal(pointPrim._mesh.userData.usdPrimType, 'Points');
});

test('linear BasisCurves preserves curve boundaries instead of joining separate curves', () => {
  const curvePrim = new HydraPointBased('basisCurves', '/World/Curves', createHydraInterfaceStub());

  curvePrim.applyUpdates({
    points: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      2, 0, 0,
      10, 0, 0,
      11, 0, 0,
    ]),
    curveTopology: {
      curveVertexCounts: [3, 2],
      curveIndices: [],
      type: 'linear',
      basis: 'bezier',
      wrap: 'nonperiodic',
    },
  });

  assert.ok(curvePrim._mesh instanceof LineSegments);
  assert.equal(curvePrim._geometry.getAttribute('position').count, 6);
  const values = Array.from(curvePrim._geometry.getAttribute('position').array);
  assert.deepEqual(values.slice(-6), [10, 0, 0, 11, 0, 0]);
});

test('periodic cubic Bezier BasisCurves are sampled into closed renderable segments', () => {
  const curvePrim = new HydraPointBased('basisCurves', '/World/Bezier', createHydraInterfaceStub());
  const points = new Float32Array(18 * 3);
  for (let index = 0; index < 18; index += 1) {
    points[index * 3] = Math.cos((index / 18) * Math.PI * 2);
    points[index * 3 + 1] = Math.sin((index / 18) * Math.PI * 2);
  }

  curvePrim.applyUpdates({
    points,
    curveTopology: {
      curveVertexCounts: [18],
      curveIndices: [],
      type: 'cubic',
      basis: 'bezier',
      wrap: 'periodic',
    },
  });

  assert.equal(curvePrim._geometry.getAttribute('position').count, 6 * 12 * 2);
  assert.ok(curvePrim._geometry.boundingBox);
  assert.ok(curvePrim._geometry.boundingSphere);
});

test('point-based prim disposal removes the object and releases Three resources', () => {
  const hydraInterface = createHydraInterfaceStub();
  const pointPrim = new HydraPointBased('points', '/World/Particles', hydraInterface);
  let geometryDisposeCount = 0;
  let materialDisposeCount = 0;
  pointPrim._geometry.dispose = () => { geometryDisposeCount += 1; };
  pointPrim._mesh.material.dispose = () => { materialDisposeCount += 1; };

  pointPrim.dispose();

  assert.equal(hydraInterface.config.usdRoot.children.length, 0);
  assert.equal(geometryDisposeCount, 1);
  assert.equal(materialDisposeCount, 1);
});

test('render delegate dispatches Points and BasisCurves away from HydraMesh', () => {
  const delegate = new ThreeRenderDelegateInterface({ usdRoot: new Group() });

  delegate.createRPrim('points', '/World/Points', null);
  delegate.createRPrim('basisCurves', '/World/Curves', null);
  const meshes = delegate.meshes as Record<string, HydraPointBased>;

  assert.ok(meshes['/World/Points'] instanceof HydraPointBased);
  assert.ok(meshes['/World/Curves'] instanceof HydraPointBased);
  assert.ok(meshes['/World/Points']._mesh instanceof Points);
  assert.ok(meshes['/World/Curves']._mesh instanceof LineSegments);

  meshes['/World/Points'].dispose();
  meshes['/World/Curves'].dispose();
  delegate.dispose();
});
