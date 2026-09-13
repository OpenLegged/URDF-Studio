import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createUsdBaseMaterial } from './usdMaterialNormalization.ts';
import { collectUsdSerializationContext } from './usdSerializationContext.ts';
import { applyUsdMaterialMetadata, buildUsdBaseLayerContent } from './usdSceneSerialization.ts';

// Scene-linear reference values from the standard sRGB transfer function.
const LINEAR_GREEN_COLOR = [0.006048833022857055, 0.4072402119017367, 0.03433980680868217];
const LINEAR_ORANGE_COLOR = [1, 0.14995978981082975, 0.003035269835487616];

function assertTupleClose(content: string, attributeName: string, expected: readonly number[]): void {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`${escapedName} = (?:\\[)?\\(([^)]+)\\)`));
  assert.ok(match, `expected ${attributeName} to be serialized`);
  const values = match[1].split(',').map(Number);
  assert.equal(values.length, expected.length);
  values.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 1e-10,
    `expected ${attributeName}[${index}] near ${expected[index]}, got ${value}`));
}

const createTexturedTriangleGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return geometry;
};

const createInterleavedTexturedTriangleGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  const interleaved = new THREE.InterleavedBuffer(
    new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    5,
  );
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleaved, 2, 3));
  return geometry;
};

test('buildUsdBaseLayerContent serializes scene nodes alongside shared mesh and material libraries', async () => {
  const root = new THREE.Group();
  root.name = 'demo_robot';

  const primitive = new THREE.Object3D();
  primitive.name = 'box';
  primitive.userData.usdGeomType = 'Cube';
  primitive.userData.usdDisplayColor = '#12ab34';
  applyUsdMaterialMetadata(primitive, { color: '#12ab34' });

  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  mesh.name = 'mesh';
  mesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(mesh, { texture: 'textures/checker.png' });

  const guide = new THREE.Group();
  guide.name = 'guide';
  guide.userData.usdPurpose = 'guide';

  root.add(primitive, mesh, guide);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'demo_robot',
  });
  const content = await buildUsdBaseLayerContent(root, context);

  assert.match(content, /defaultPrim = "demo_robot"/);
  assert.match(content, /def Xform "demo_robot"/);
  assert.match(content, /class Scope "__MeshLibrary"/);
  assert.match(content, /class Mesh "Geometry_0"/);
  assert.match(content, /def Scope "Looks"/);
  assert.match(content, /def Scope "joints"/);
  assert.match(content, /prepend references = <\/demo_robot\/__MeshLibrary\/Geometry_0>/);
  assert.match(content, /rel material:binding = <\/demo_robot\/Looks\/Material_0>/);
  assert.match(content, /asset inputs:file = @\.\.\/assets\/checker\.png@/);
  assert.match(content, /custom string urdf:materialColor = "#12ab34"/);
  assert.match(content, /uniform token purpose = "guide"/);
});

test('buildUsdBaseLayerContent serializes interleaved mesh attributes without changing output shape', async () => {
  const root = new THREE.Group();
  root.name = 'demo_robot';

  const mesh = new THREE.Mesh(
    createInterleavedTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  mesh.name = 'interleaved_mesh';
  mesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(mesh, { texture: 'textures/checker.png' });

  root.add(mesh);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'demo_robot',
  });
  const content = await buildUsdBaseLayerContent(root, context);

  assert.match(content, /point3f\[] points = \[\n\s+\(0, 0, 0\), \(1, 0, 0\), \(0, 1, 0\)\n\s+\]/);
  assert.match(content, /texCoord2f\[] primvars:st = \[\n\s+\(0, 0\), \(1, 0\), \(0, 1\)\n\s+\]/);
  assert.match(content, /uniform token primvars:st:interpolation = "faceVarying"/);
});

test('buildUsdBaseLayerContent authors collision properties on shapes instead of parent xforms', async () => {
  const root = new THREE.Group();
  root.name = 'collision_robot';

  const collisionAnchor = new THREE.Group();
  collisionAnchor.name = 'collision_0';
  collisionAnchor.userData.usdCollision = true;
  collisionAnchor.userData.usdPurpose = 'guide';

  const primitive = new THREE.Object3D();
  primitive.name = 'box';
  primitive.userData.usdGeomType = 'Cube';
  primitive.userData.usdCollision = true;
  primitive.userData.usdPurpose = 'guide';
  collisionAnchor.add(primitive);

  const meshAnchor = new THREE.Group();
  meshAnchor.name = 'collision_1';
  meshAnchor.userData.usdCollision = true;
  meshAnchor.userData.usdPurpose = 'guide';

  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  mesh.name = 'mesh';
  mesh.userData.usdCollision = true;
  mesh.userData.usdPurpose = 'guide';
  meshAnchor.add(mesh);

  root.add(collisionAnchor, meshAnchor);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'collision_robot',
  });
  const content = await buildUsdBaseLayerContent(root, context);

  assert.match(
    content,
    /def Cube "box" \(\n\s+prepend apiSchemas = \["PhysicsCollisionAPI"\]\n\s*\)\n\s+\{[\s\S]*bool physics:collisionEnabled = true/,
  );
  assert.match(
    content,
    /def Mesh "mesh" \(\n\s+prepend apiSchemas = \["PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"\][\s\S]*\)\n\s+\{[\s\S]*bool physics:collisionEnabled = true[\s\S]*uniform token physics:approximation = "convexHull"/,
  );
  assert.doesNotMatch(
    content,
    /def Xform "collision_[01]" \(\n\s+prepend apiSchemas = \[[^\]]*PhysicsCollisionAPI/,
  );
});

test('buildUsdBaseLayerContent converts Unitree-style source RGBA to USD scene-linear colors', async () => {
  const root = new THREE.Group();
  root.name = 'a1';

  const primitive = new THREE.Object3D();
  primitive.name = 'orange_shell';
  primitive.userData.usdGeomType = 'Cube';
  primitive.userData.usdDisplayColor = '#ff6c0a';
  applyUsdMaterialMetadata(primitive, {
    color: '#ff6c0a',
    colorRgba: [1, 0.423529411765, 0.0392156862745, 1],
  });
  root.add(primitive);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'a1',
  });
  const content = await buildUsdBaseLayerContent(root, context, undefined, {
    materialProfile: 'isaacsim',
  });

  assertTupleClose(content, 'primvars:displayColor', LINEAR_ORANGE_COLOR);
  assertTupleClose(content, 'color3f inputs:diffuseColor', LINEAR_ORANGE_COLOR);
  assertTupleClose(content, 'color3f inputs:diffuse_color_constant', LINEAR_ORANGE_COLOR);
  assert.doesNotMatch(content, /\(1, 0\.423529, 0\.039216\)/);
});

test('buildUsdBaseLayerContent keeps UV texture fallback constants in USD scene-linear space', async () => {
  const root = new THREE.Group();
  root.name = 'textured_robot';

  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#12ab34'));
  mesh.name = 'textured_mesh';
  mesh.userData.usdDisplayColor = '#12ab34';
  applyUsdMaterialMetadata(mesh, { color: '#12ab34', texture: 'textures/checker.png' });
  root.add(mesh);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'textured_robot',
  });
  const content = await buildUsdBaseLayerContent(root, context);

  assertTupleClose(content, 'primvars:displayColor', LINEAR_GREEN_COLOR);
  assertTupleClose(content, 'float4 inputs:fallback', [...LINEAR_GREEN_COLOR, 1]);
  assert.match(content, /token inputs:sourceColorSpace = "sRGB"/);
});

test('buildUsdBaseLayerContent preserves explicit opacity independently from color encoding', async () => {
  const root = new THREE.Group();
  root.name = 'opacity_robot';

  const primitive = new THREE.Object3D();
  primitive.name = 'glass';
  primitive.userData.usdGeomType = 'Sphere';
  primitive.userData.usdDisplayColor = '#336699';
  applyUsdMaterialMetadata(primitive, {
    color: '#336699',
    opacity: 0.35,
  });
  root.add(primitive);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'opacity_robot',
  });
  const content = await buildUsdBaseLayerContent(root, context, undefined, {
    materialProfile: 'isaacsim',
  });

  assert.match(content, /float inputs:opacity = 0\.35/);
  assert.match(content, /float inputs:opacity_constant = 0\.35/);
  assert.match(content, /bool inputs:enable_opacity = true/);
});

for (const operation of ['translate', 'orient', 'scale'] as const) {
  test(`USD scene serialization retains tiny non-default ${operation} operations`, async () => {
    const root = new THREE.Group();
    root.name = 'precision';
    const child = new THREE.Group();
    child.name = 'tiny_transform';
    root.add(child);
    const expected = operation === 'translate' ? [1e-12, 0, 0]
      : operation === 'scale' ? [1 + 1e-12, 1, 1] : [1, 0, 0, 5e-13];
    if (operation === 'translate') child.position.x = 1e-12;
    if (operation === 'scale') child.scale.x = 1 + 1e-12;
    if (operation === 'orient') child.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1e-12);
    const context = await collectUsdSerializationContext(root, { rootPrimName: root.name });
    const content = await buildUsdBaseLayerContent(root, context);
    const match = content.match(new RegExp(`xformOp:${operation} = \\(([^)]+)\\)`));
    assert.ok(match, `expected tiny ${operation} to be authored`);
    assert.deepEqual(match[1].split(',').map(Number), expected);
    assert.match(content, new RegExp(`xformOpOrder = \\["xformOp:${operation}"\\]`));
  });
}
