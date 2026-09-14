import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import {
  computeCameraFrame,
  computeVisibleBounds,
  createCameraFrameStabilityKey,
  isBoundsVisibleToCamera,
} from '../utils/cameraFrame';

function createReadinessCheck(root: THREE.Group, camera: THREE.PerspectiveCamera) {
  const source = ts.createSourceFile(
    'worker.ts',
    readFileSync(new URL('./usdOffscreenViewer.worker.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = [
    'sampleWorkerAutoFrameBounds',
    'applyWorkerCameraFrame',
    'summarizeWorkerRenderedScene',
    'validateWorkerRenderedScene',
  ];
  const declarations = names.map((name) => {
    const declaration = source.statements.find((statement) =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === name,
    );
    assert.ok(declaration, `missing worker function ${name}`);
    return declaration.getText(source);
  });
  const controls = { target: new THREE.Vector3(0.0358738, 0.0146604, -0.71142956) };
  const code = ts.transpileModule(declarations.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const validate = runInNewContext(`${code}\nvalidateWorkerRenderedScene`, {
    THREE,
    usdRoot: root,
    camera,
    controls,
    showVisual: true,
    showCollision: false,
    navigationSceneBounds: undefined,
    runtimeWindow: { renderInterface: { meshes: { mesh: root.children[0] } } },
    computeCameraFrame,
    computeVisibleBounds,
    createCameraFrameStabilityKey,
    isBoundsVisibleToCamera,
    syncOrbitFromCamera: () => {},
    renderScene: () => {},
    emitWorkerCameraState: () => {},
  }) as (name: string) => void;
  return { validate, controls };
}

const fixtures = [
  { name: 'light_dining', min: [-0.22759925, -0.18426311, -1.42393251], max: [0.29934685, 0.21358396, 0.00107336] },
  { name: 'food tongs005', min: [-0.04357569, -0.02867316, -0.24335596], max: [0.05599713, 0.03219521, 0.02898341] },
  { name: 'fume_extractor_arm', min: [-0.2703115, -0.41663704, -1.49841289], max: [0.08866901, 0.06646134, -0.00035018] },
];

for (const fixture of fixtures) {
  test(`worker readiness frames grounded ${fixture.name} before deferred camera samples settle`, () => {
    const bounds = new THREE.Box3(new THREE.Vector3(...fixture.min), new THREE.Vector3(...fixture.max));
    const size = bounds.getSize(new THREE.Vector3());
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(bounds.getCenter(new THREE.Vector3()));
    const root = new THREE.Group();
    root.add(mesh);
    root.position.z = -bounds.min.z;
    // Captured light_dining worker state: root already grounded, but loader
    // controls.update is a stub and the deferred auto-frame has not run yet.
    const camera = new THREE.PerspectiveCamera(68, 1, 0.01995578, 199.55782);
    camera.position.set(0.91692786, -0.86639363, 0.84735839);
    camera.up.set(0, 0, 1);
    const { validate, controls } = createReadinessCheck(root, camera);
    try {
      assert.equal(isBoundsVisibleToCamera(computeVisibleBounds(root), camera), false);
      assert.doesNotThrow(() => validate(fixture.name));
      const visibleBounds = computeVisibleBounds(root);
      assert.ok(visibleBounds);
      assert.equal(isBoundsVisibleToCamera(visibleBounds, camera), true);
      assert.ok(controls.target.distanceTo(visibleBounds.getCenter(new THREE.Vector3())) < 1e-8);
      for (const x of [visibleBounds.min.x, visibleBounds.max.x]) {
        for (const y of [visibleBounds.min.y, visibleBounds.max.y]) {
          for (const z of [visibleBounds.min.z, visibleBounds.max.z]) {
            const projected = new THREE.Vector3(x, y, z).project(camera);
            assert.ok(Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 && Math.abs(projected.z) <= 1);
          }
        }
      }
      mesh.visible = false;
      assert.throws(() => validate(fixture.name), /produced no visible scene/);
    } finally {
      geometry.dispose();
      material.dispose();
    }
  });
}

test('worker readiness still rejects a camera whose clipping planes exclude the scene', () => {
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshBasicMaterial();
  root.add(new THREE.Mesh(geometry, material));
  const camera = new THREE.PerspectiveCamera(68, 1, 100, 101);
  camera.position.set(1, -1, 1);
  try {
    assert.throws(() => createReadinessCheck(root, camera).validate('clipped'), /camera framed: no/);
  } finally {
    geometry.dispose();
    material.dispose();
  }
});
