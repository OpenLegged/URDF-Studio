import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import {
  buildColladaRootNormalizationHints,
  createLoadingManager,
  createMeshLoader,
  createPlaceholderMesh,
  isCoplanarOffsetMaterial,
} from '@/core/loaders';
import { parseURDF } from '@/core/parsers/urdf/parser';
import { URDFLoader } from './URDFLoader';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.Document = dom.window.Document as typeof Document;
globalThis.Element = dom.window.Element as typeof Element;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function toFixedColorArray(color: THREE.Color, digits = 4) {
  return color.toArray().map((value) => Number(value.toFixed(digits)));
}

function getWorldBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function expectBoxEquals(actual: THREE.Box3, expected: THREE.Box3, epsilon = 1e-6) {
  const actualMin = actual.min.toArray();
  const expectedMin = expected.min.toArray();
  const actualMax = actual.max.toArray();
  const expectedMax = expected.max.toArray();

  actualMin.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMin[index]) < epsilon);
  });
  actualMax.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMax[index]) < epsilon);
  });
}

function parseRequiredURDF(source: string) {
  const robot = parseURDF(source);
  assert.ok(robot, 'expected URDF source to parse');
  return robot;
}

async function loadVisualSnapshot(params: {
  urdfContent: string;
  urdfDir: string;
  assets: Record<string, string>;
  robotLinks: ReturnType<typeof parseRequiredURDF>['links'];
  linkName: string;
}) {
  const { urdfContent, urdfDir, assets, robotLinks, linkName } = params;
  const manager = createLoadingManager(assets, urdfDir);
  const meshLoader = createMeshLoader(assets, manager, urdfDir, {
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(robotLinks),
  });

  const loader = new URDFLoader(manager);
  loader.loadMeshCb = meshLoader;

  let robot: ReturnType<URDFLoader['parse']> | null = null as ReturnType<URDFLoader['parse']> | null;
  const snapshotPromise = new Promise<{
    visualChildren: number;
    meshCount: number;
    visualRoot: THREE.Object3D | null;
  }>((resolve) => {
    manager.onLoad = () => {
      const link = robot?.links?.[linkName] as THREE.Object3D | undefined;
      const visualGroup = link?.children.find((child: any) => child.isURDFVisual) as
        | THREE.Object3D
        | undefined;
      const visualRoot = (visualGroup?.children[0] as THREE.Object3D | undefined) ?? null;
      let meshCount = 0;
      visualGroup?.traverse((child: any) => {
        if (child.isMesh) {
          meshCount += 1;
        }
      });

      resolve({
        visualChildren: visualGroup?.children.length ?? 0,
        meshCount,
        visualRoot,
      });
    };
  });

  const loadCompletionKey = `__urdf_loader_snapshot__${linkName}`;
  manager.itemStart(loadCompletionKey);
  try {
    robot = loader.parse(urdfContent);
  } finally {
    manager.itemEnd(loadCompletionKey);
  }

  return snapshotPromise;
}

test('URDFLoader applies local visual material to nested mesh groups', () => {
  const loader = new URDFLoader();
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({ color: new THREE.Color(1, 1, 1) }),
    );
    group.add(mesh);
    onLoad(group);
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="material_group">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="link.obj" />
      </geometry>
      <material name="base_link_mat">
        <color rgba="0.1 0.2 0.3 1" />
      </material>
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  let nestedMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  robot.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && !nestedMesh) {
      nestedMesh = child as THREE.Mesh;
    }
  });

  assert.ok(nestedMesh);
  const material = nestedMesh.material as THREE.MeshPhongMaterial;
  assert.equal(material.name, 'base_link_mat');
  assert.deepEqual(
    toFixedColorArray(material.color),
    toFixedColorArray(new THREE.Color().setRGB(0.1, 0.2, 0.3, THREE.SRGBColorSpace)),
  );
});

test('URDFLoader.parseAsync preserves robot structure while yielding between batches', async () => {
  const loader = new URDFLoader();
  const yieldMarkers: number[] = [];

  const robot = await loader.parseAsync(
    `<?xml version="1.0"?>
<robot name="async_probe">
  <material name="orange">
    <color rgba="1 0.4235294118 0.0392156863 1" />
  </material>
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
  <link name="child_link">
    <visual>
      <geometry>
        <sphere radius="0.2" />
      </geometry>
    </visual>
  </link>
  <joint name="base_to_child" type="fixed">
    <parent link="base_link" />
    <child link="child_link" />
  </joint>
</robot>`,
    '/tmp/',
    {
      yieldIfNeeded: async () => {
        yieldMarkers.push(yieldMarkers.length);
      },
    },
  );

  assert.equal(robot.robotName, 'async_probe');
  assert.equal(Object.keys(robot.links).length, 2);
  assert.equal(Object.keys(robot.joints).length, 1);
  assert.ok(yieldMarkers.length >= 3);
});

test('URDFLoader applies curved primitive detail in sync and async parsing', async () => {
  const source = `
    <robot name="quality_robot">
      <link name="base">
        <visual>
          <geometry><sphere radius="0.2" /></geometry>
        </visual>
        <visual>
          <geometry><capsule radius="0.1" length="0.8" /></geometry>
        </visual>
      </link>
    </robot>
  `;
  const detail = {
    cylinderRadialSegments: 128,
    sphereWidthSegments: 64,
    sphereHeightSegments: 48,
    capsuleCapSegments: 16,
    capsuleRadialSegments: 32,
  };

  for (const parseRobot of [
    () => {
      const loader = new URDFLoader();
      loader.primitiveGeometryDetail = detail;
      return Promise.resolve(loader.parse(source));
    },
    async () => {
      const loader = new URDFLoader();
      loader.primitiveGeometryDetail = detail;
      return loader.parseAsync(source);
    },
  ]) {
    const robot = await parseRobot();
    const spheres: THREE.SphereGeometry[] = [];
    const capsules: THREE.CapsuleGeometry[] = [];
    robot.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.geometry instanceof THREE.SphereGeometry) spheres.push(object.geometry);
      if (object.geometry instanceof THREE.CapsuleGeometry) capsules.push(object.geometry);
    });

    assert.equal(spheres[0]?.parameters.widthSegments, 64);
    assert.equal(spheres[0]?.parameters.heightSegments, 48);
    assert.equal(capsules[0]?.parameters.capSegments, 16);
    assert.equal(capsules[0]?.parameters.radialSegments, 32);
    spheres.forEach((geometry) => geometry.dispose());
    capsules.forEach((geometry) => geometry.dispose());
  }
});

test('URDFLoader preserves named mesh materials for multi-material DAE groups', () => {
  const loader = new URDFLoader();
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
      new THREE.MeshPhongMaterial({ name: '磨砂铝合金.008', color: new THREE.Color(1, 0, 0) }),
      new THREE.MeshPhongMaterial({ name: '灰色硅胶.009', color: new THREE.Color(0, 1, 0) }),
    ]);
    group.add(mesh);
    onLoad(group);
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="material_group">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="link.dae" />
      </geometry>
      <material name="磨砂铝合金_008-effect">
        <color rgba="0.2 0.2 0.2 1" />
      </material>
      <material name="灰色硅胶_009-effect">
        <color rgba="0.6 0.6 0.6 1" />
      </material>
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  let nestedMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  robot.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && !nestedMesh) {
      nestedMesh = child as THREE.Mesh;
    }
  });

  assert.ok(nestedMesh);
  assert.ok(Array.isArray(nestedMesh.material));
  const materialNames = (nestedMesh.material as THREE.Material[]).map((material) => material.name);
  assert.deepEqual(materialNames, ['磨砂铝合金.008', '灰色硅胶.009']);
});

test('URDFLoader keeps placeholder meshes for missing visual geometry', () => {
  const loader = new URDFLoader();
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    onLoad(createPlaceholderMesh('missing-visual.stl'));
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="missing_visual">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="missing-visual.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  const baseLink = robot.links.base_link as THREE.Object3D | undefined;
  assert.ok(baseLink);

  const visualGroup = baseLink.children.find((child: any) => child.isURDFVisual) as
    | THREE.Object3D
    | undefined;
  assert.ok(visualGroup);

  let placeholderMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  visualGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && child.userData?.isPlaceholder) {
      placeholderMesh = child as THREE.Mesh;
    }
  });

  assert.ok(placeholderMesh);
  assert.equal(placeholderMesh.userData?.missingMeshPath, 'missing-visual.stl');
});

test('URDFLoader logs when a mesh callback completes without an object', () => {
  const loader = new URDFLoader();
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    onLoad(null, undefined);
  };

  const originalConsoleError = console.error;
  const loggedErrors: unknown[][] = [];
  console.error = (...args) => {
    loggedErrors.push(args);
  };

  try {
    loader.parse(
      `<?xml version="1.0"?>
<robot name="missing_visual_object">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="missing-visual.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      '/tmp/',
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(loggedErrors.length, 1);
  assert.match(String(loggedErrors[0]?.[0] || ''), /Mesh loader completed without an object/);
  assert.deepEqual(loggedErrors[0]?.[1], {
    filePath: '/tmp/missing-visual.stl',
    nodeType: 'visual',
  });
});

test('URDFLoader skips placeholder meshes for missing collision geometry', () => {
  const loader = new URDFLoader();
  loader.parseCollision = true;
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    onLoad(createPlaceholderMesh('missing-collision.stl'));
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="missing_collision">
  <link name="base_link">
    <collision>
      <geometry>
        <mesh filename="missing-collision.stl" />
      </geometry>
    </collision>
  </link>
</robot>`,
    '/tmp/',
  );

  const baseLink = robot.links.base_link as THREE.Object3D | undefined;
  assert.ok(baseLink);

  const collisionGroup = baseLink.children.find((child: any) => child.isURDFCollider) as
    | THREE.Object3D
    | undefined;
  assert.ok(collisionGroup);
  assert.equal(collisionGroup.children.length, 0);

  let meshCount = 0;
  collisionGroup.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshCount += 1;
    }
  });
  assert.equal(meshCount, 0);
});

test('URDFLoader renders collision boxes as boxes', () => {
  const loader = new URDFLoader();
  loader.parseCollision = true;

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="collision_box_display">
  <link name="base_link">
    <collision>
      <geometry>
        <box size="1 4 2" />
      </geometry>
    </collision>
  </link>
</robot>`,
    '/tmp/',
  );

  const baseLink = robot.links.base_link as THREE.Object3D | undefined;
  assert.ok(baseLink);

  const collisionGroup = baseLink.children.find((child: any) => child.isURDFCollider) as
    | THREE.Object3D
    | undefined;
  assert.ok(collisionGroup);
  assert.equal(collisionGroup.children.length, 1);

  const collisionMesh = collisionGroup.children[0] as THREE.Mesh;
  assert.equal(collisionMesh.geometry.type, 'BoxGeometry');
  assert.deepEqual(
    collisionMesh.scale.toArray().map((value) => Number(value.toFixed(4))),
    [1, 4, 2],
  );
  assert.equal(Number(collisionMesh.rotation.x.toFixed(4)), 0);
  assert.equal(Number(collisionMesh.rotation.y.toFixed(4)), 0);
  assert.equal(Number(collisionMesh.rotation.z.toFixed(4)), 0);
});

test('URDFLoader stabilizes coincident sibling visuals on the same link', () => {
  const loader = new URDFLoader();
  let loadCount = 0;
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    const size = loadCount === 0 ? 1 : 1.02;
    const material = new THREE.MeshPhongMaterial({
      name: loadCount === 0 ? 'inner_shell' : 'outer_shell',
      color: new THREE.Color(loadCount === 0 ? 0xffffff : 0x111111),
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
    loadCount += 1;
    onLoad(mesh);
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="coincident_visuals">
  <link name="base_link">
    <visual name="inner_visual">
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="inner_shell.obj" />
      </geometry>
    </visual>
    <visual name="outer_visual">
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="outer_shell.obj" />
      </geometry>
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  const baseLink = robot.links.base_link as THREE.Object3D | undefined;
  assert.ok(baseLink);

  const visualGroups = baseLink.children.filter(
    (child: any) => child.isURDFVisual,
  ) as THREE.Object3D[];
  assert.equal(visualGroups.length, 2);

  const innerMesh = visualGroups[0]?.children[0] as THREE.Mesh | undefined;
  const outerMesh = visualGroups[1]?.children[0] as THREE.Mesh | undefined;
  assert.ok(innerMesh);
  assert.ok(outerMesh);

  assert.equal(innerMesh.renderOrder, 0);
  assert.equal(outerMesh.renderOrder, 1);
  assert.equal(isCoplanarOffsetMaterial(innerMesh.material as THREE.Material), false);
  assert.equal(isCoplanarOffsetMaterial(outerMesh.material as THREE.Material), true);
});

test('URDFLoader stabilizes coincident visuals that arrive through fixed child links', () => {
  const loader = new URDFLoader();
  let loadCount = 0;
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    const size = loadCount === 0 ? 1 : 1.02;
    const material = new THREE.MeshPhongMaterial({
      name: loadCount === 0 ? 'inner_shell' : 'outer_shell',
      color: new THREE.Color(loadCount === 0 ? 0xffffff : 0x111111),
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), material);
    loadCount += 1;
    onLoad(mesh);
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="fixed_overlay_visuals">
  <link name="base_link">
    <visual name="inner_visual">
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="inner_shell.obj" />
      </geometry>
    </visual>
  </link>
  <link name="outer_link">
    <visual name="outer_visual">
      <origin xyz="0 0 0" rpy="0 0 0" />
      <geometry>
        <mesh filename="outer_shell.obj" />
      </geometry>
    </visual>
  </link>
  <joint name="base_to_outer" type="fixed">
    <origin xyz="0 0 0" rpy="0 0 0" />
    <parent link="base_link" />
    <child link="outer_link" />
  </joint>
</robot>`,
    '/tmp/',
  );

  const baseLink = robot.links.base_link as THREE.Object3D | undefined;
  const outerLink = robot.links.outer_link as THREE.Object3D | undefined;
  assert.ok(baseLink);
  assert.ok(outerLink);

  const baseVisual = baseLink.children.find((child: any) => child.isURDFVisual) as
    | THREE.Object3D
    | undefined;
  const outerVisual = outerLink.children.find((child: any) => child.isURDFVisual) as
    | THREE.Object3D
    | undefined;
  assert.ok(baseVisual);
  assert.ok(outerVisual);

  const innerMesh = baseVisual.children[0] as THREE.Mesh | undefined;
  const outerMesh = outerVisual.children[0] as THREE.Mesh | undefined;
  assert.ok(innerMesh);
  assert.ok(outerMesh);

  assert.equal(innerMesh.renderOrder, 0);
  assert.equal(outerMesh.renderOrder, 1);
  assert.equal(isCoplanarOffsetMaterial(innerMesh.material as THREE.Material), false);
  assert.equal(isCoplanarOffsetMaterial(outerMesh.material as THREE.Material), true);
});

test('URDFLoader overrides single named OBJ materials when URDF provides the export color', () => {
  const loader = new URDFLoader();
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({ name: 'material_0', color: new THREE.Color(0.5, 0.5, 0.5) }),
    );
    group.add(mesh);
    onLoad(group);
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="single_named_obj_material">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="link.obj" />
      </geometry>
      <material name="exported_color">
        <color rgba="0.82 0.15 0.15 1" />
      </material>
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  let nestedMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  robot.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && !nestedMesh) {
      nestedMesh = child as THREE.Mesh;
    }
  });

  assert.ok(nestedMesh);
  const material = nestedMesh.material as THREE.MeshPhongMaterial;
  assert.equal(material.name, 'exported_color');
  assert.deepEqual(
    toFixedColorArray(material.color, 2),
    toFixedColorArray(new THREE.Color().setRGB(0.82, 0.15, 0.15, THREE.SRGBColorSpace), 2),
  );
});

test('URDFLoader parses Unitree B1 orange visuals as sRGB colors', () => {
  const loader = new URDFLoader();
  loader.loadMeshCb = (_url, _manager, onLoad) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({ color: new THREE.Color(1, 1, 1) }),
    );
    onLoad(mesh);
  };

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="b1_color_probe">
  <material name="orange">
    <color rgba="1 0.4235294118 0.0392156863 1" />
  </material>
  <link name="trunk">
    <visual>
      <geometry>
        <mesh filename="trunkb.dae" />
      </geometry>
      <material name="orange" />
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  let nestedMesh: THREE.Mesh | null = null as THREE.Mesh | null;
  robot.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && !nestedMesh) {
      nestedMesh = child as THREE.Mesh;
    }
  });

  assert.ok(nestedMesh);
  const material = nestedMesh.material as THREE.MeshPhongMaterial;
  const expected = new THREE.Color().setRGB(1, 0.4235294118, 0.0392156863, THREE.SRGBColorSpace);
  const incorrectLinear = new THREE.Color(1, 0.4235294118, 0.0392156863);

  assert.deepEqual(toFixedColorArray(material.color), toFixedColorArray(expected));
  assert.notDeepEqual(toFixedColorArray(material.color), toFixedColorArray(incorrectLinear));
});

test('URDFLoader preserves Z-up semantics for b2w base_link Collada meshes before link attachment', async () => {
  const meshPath = 'test/unitree_ros/robots/b2w_description/meshes/base_link.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2w_description/urdf/b2w_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseRequiredURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = createLoadingManager({
    [meshPath]: meshDataUrl,
    'package://b2w_description/meshes/base_link.dae': meshDataUrl,
    '/tmp/base_link.dae': meshDataUrl,
    'base_link.dae': meshDataUrl,
  });

  const meshLoader = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://b2w_description/meshes/base_link.dae': meshDataUrl,
      '/tmp/base_link.dae': meshDataUrl,
      'base_link.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const referenceObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    meshLoader('package://b2w_description/meshes/base_link.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result!);
    });
  });
  const referenceBox = getWorldBox(referenceObject);

  const loader = new URDFLoader(manager);
  loader.loadMeshCb = meshLoader;

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="b2w_base_link">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://b2w_description/meshes/base_link.dae" />
      </geometry>
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  const visualGroup = robot.children.find((child) => (child as any).isURDFVisual) as
    | THREE.Object3D
    | undefined;
  assert.ok(visualGroup);

  for (let attempt = 0; attempt < 100 && visualGroup.children.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const loadedMeshRoot = visualGroup.children[0];
  assert.ok(loadedMeshRoot);
  assert.ok(Math.abs(loadedMeshRoot.rotation.x - referenceObject.rotation.x) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.rotation.y - referenceObject.rotation.y) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.rotation.z - referenceObject.rotation.z) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.x - referenceObject.quaternion.x) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.y - referenceObject.quaternion.y) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.z - referenceObject.quaternion.z) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.w - referenceObject.quaternion.w) < 1e-6);
  expectBoxEquals(getWorldBox(loadedMeshRoot), referenceBox);
});

test('URDFLoader preserves Z-up semantics for b2 base_link Collada meshes before link attachment', async () => {
  const meshPath = 'test/unitree_ros/robots/b2_description/meshes/base_link.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2_description/urdf/b2_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseRequiredURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = createLoadingManager({
    [meshPath]: meshDataUrl,
    'package://b2_description/meshes/base_link.dae': meshDataUrl,
    '/tmp/base_link.dae': meshDataUrl,
    'base_link.dae': meshDataUrl,
  });

  const meshLoader = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://b2_description/meshes/base_link.dae': meshDataUrl,
      '/tmp/base_link.dae': meshDataUrl,
      'base_link.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const referenceObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    meshLoader('package://b2_description/meshes/base_link.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result!);
    });
  });
  const referenceBox = getWorldBox(referenceObject);

  const loader = new URDFLoader(manager);
  loader.loadMeshCb = meshLoader;

  const robot = loader.parse(
    `<?xml version="1.0"?>
<robot name="b2_base_link">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://b2_description/meshes/base_link.dae" />
      </geometry>
    </visual>
  </link>
</robot>`,
    '/tmp/',
  );

  const visualGroup = robot.children.find((child) => (child as any).isURDFVisual) as
    | THREE.Object3D
    | undefined;
  assert.ok(visualGroup);

  for (let attempt = 0; attempt < 100 && visualGroup.children.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  const loadedMeshRoot = visualGroup.children[0];
  assert.ok(loadedMeshRoot);
  assert.ok(Math.abs(loadedMeshRoot.rotation.x - referenceObject.rotation.x) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.rotation.y - referenceObject.rotation.y) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.rotation.z - referenceObject.rotation.z) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.x - referenceObject.quaternion.x) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.y - referenceObject.quaternion.y) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.z - referenceObject.quaternion.z) < 1e-6);
  assert.ok(Math.abs(loadedMeshRoot.quaternion.w - referenceObject.quaternion.w) < 1e-6);
  expectBoxEquals(getWorldBox(loadedMeshRoot), referenceBox);
});

test('LoadingManager onLoad waits for imported go2w exported thigh visuals to attach before finalization', async () => {
  const sourceUrdfPath = 'test/unitree_ros/robots/go2w_description/urdf/go2w_description.urdf';
  const sourceUrdfContent = fs.readFileSync(sourceUrdfPath, 'utf8');
  const fullRobotState = parseURDF(sourceUrdfContent);
  assert.ok(fullRobotState);

  const meshPath = 'test/unitree_ros/robots/go2w_description/dae/thigh_mirror.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const importedUrdfDir = 'go2w_description (1)/';
  const importedUrdfContent = `<?xml version="1.0"?>
<robot name="go2w_description">
  <link name="FR_thigh">
    <visual>
      <geometry>
        <mesh filename="package://go2w_description/meshes/dae/thigh_mirror.dae" />
      </geometry>
    </visual>
  </link>
</robot>`;

  const assets = {
    'go2w_description (1)/meshes/dae/thigh_mirror.dae': meshDataUrl,
  };
  const manager = createLoadingManager(assets, importedUrdfDir);
  const meshLoader = createMeshLoader(assets, manager, importedUrdfDir, {
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(fullRobotState.links),
  });

  const loader = new URDFLoader(manager);
  loader.loadMeshCb = meshLoader;

  let robot: ReturnType<URDFLoader['parse']> | null = null as ReturnType<URDFLoader['parse']> | null;
  const onLoadSnapshot = new Promise<{ visualChildren: number; hasVisualMesh: boolean }>(
    (resolve) => {
      manager.onLoad = () => {
        const link = robot?.links?.FR_thigh as THREE.Object3D | undefined;
        const visualGroup = link?.children.find((child: any) => child.isURDFVisual) as
          | THREE.Object3D
          | undefined;
        let hasVisualMesh = false;
        visualGroup?.traverse((child: any) => {
          if (child.isMesh) {
            hasVisualMesh = true;
          }
        });

        resolve({
          visualChildren: visualGroup?.children.length ?? 0,
          hasVisualMesh,
        });
      };
    },
  );

  const loadCompletionKey = '__urdf_loader_async_mesh_setup__';
  manager.itemStart(loadCompletionKey);
  try {
    robot = loader.parse(importedUrdfContent);
  } finally {
    manager.itemEnd(loadCompletionKey);
  }

  const snapshot = await onLoadSnapshot;
  assert.ok(
    snapshot.visualChildren > 0,
    `expected visual children before onLoad finalization, received ${snapshot.visualChildren}`,
  );
  assert.equal(snapshot.hasVisualMesh, true);
});

test('folder import and exported zip roundtrip converge to the same go2w FR_thigh visual result', async () => {
  const sourceUrdfPath = 'test/unitree_ros/robots/go2w_description/urdf/go2w_description.urdf';
  const sourceUrdfContent = fs.readFileSync(sourceUrdfPath, 'utf8');
  const fullRobotState = parseURDF(sourceUrdfContent);
  assert.ok(fullRobotState);

  const meshPath = 'test/unitree_ros/robots/go2w_description/dae/thigh_mirror.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;

  const folderImportSnapshot = await loadVisualSnapshot({
    urdfDir: 'go2w_description/urdf/',
    urdfContent: `<?xml version="1.0"?>
<robot name="go2w_description">
  <link name="FR_thigh">
    <visual>
      <geometry>
        <mesh filename="package://go2w_description/dae/thigh_mirror.dae" />
      </geometry>
    </visual>
  </link>
</robot>`,
    assets: {
      'go2w_description/dae/thigh_mirror.dae': meshDataUrl,
    },
    robotLinks: fullRobotState.links,
    linkName: 'FR_thigh',
  });

  const exportedZipSnapshot = await loadVisualSnapshot({
    urdfDir: 'go2w_description (1)/',
    urdfContent: `<?xml version="1.0"?>
<robot name="go2w_description">
  <link name="FR_thigh">
    <visual>
      <geometry>
        <mesh filename="package://go2w_description/meshes/dae/thigh_mirror.dae" />
      </geometry>
    </visual>
  </link>
</robot>`,
    assets: {
      'go2w_description (1)/meshes/dae/thigh_mirror.dae': meshDataUrl,
    },
    robotLinks: fullRobotState.links,
    linkName: 'FR_thigh',
  });

  assert.ok(folderImportSnapshot.visualChildren > 0);
  assert.ok(exportedZipSnapshot.visualChildren > 0);
  assert.ok(folderImportSnapshot.meshCount > 0);
  assert.ok(exportedZipSnapshot.meshCount > 0);
  assert.equal(folderImportSnapshot.visualChildren, exportedZipSnapshot.visualChildren);
  assert.equal(folderImportSnapshot.meshCount, exportedZipSnapshot.meshCount);
  assert.ok(folderImportSnapshot.visualRoot);
  assert.ok(exportedZipSnapshot.visualRoot);
  expectBoxEquals(
    getWorldBox(folderImportSnapshot.visualRoot),
    getWorldBox(exportedZipSnapshot.visualRoot),
  );
});

test('URDFLoader preserves Unitree A2 base_link mesh offsets without translating the link frame', async () => {
  const urdfPath = 'test/unitree_ros/robots/a2_description/urdf/a2.urdf';
  const urdfContent = fs.readFileSync(urdfPath, 'utf8');
  const parsed = parseURDF(urdfContent);
  assert.ok(parsed);

  const meshPath = 'test/unitree_ros/robots/a2_description/meshes/base_link.STL';
  const meshDataUrl = `data:model/stl;base64,${Buffer.from(fs.readFileSync(meshPath)).toString('base64')}`;
  const urdfDir = 'test/unitree_ros/robots/a2_description/urdf/';
  const assets = {
    [meshPath]: meshDataUrl,
    'base_link.STL': meshDataUrl,
  };

  const manager = createLoadingManager(assets, urdfDir);
  const meshLoader = createMeshLoader(assets, manager, urdfDir, {
    colladaRootNormalizationHints: buildColladaRootNormalizationHints(parsed.links),
  });

  const loader = new URDFLoader(manager);
  loader.loadMeshCb = meshLoader;

  let robot: ReturnType<URDFLoader['parse']> | null = null as ReturnType<URDFLoader['parse']> | null;
  const onLoadPromise = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
  });

  const loadCompletionKey = '__urdf_loader_a2_base_link_snapshot__';
  manager.itemStart(loadCompletionKey);
  try {
    robot = loader.parse(urdfContent, urdfDir);
  } finally {
    manager.itemEnd(loadCompletionKey);
  }

  await onLoadPromise;

  const baseLink = robot?.links?.base_link as THREE.Object3D | undefined;
  assert.ok(baseLink, 'expected A2 import to expose base_link');
  assert.equal(baseLink.position.x, 0);
  assert.equal(baseLink.position.y, 0);
  assert.equal(baseLink.position.z, 0);

  const visualGroup = baseLink.children.find((child: any) => child.isURDFVisual) as
    | THREE.Object3D
    | undefined;
  assert.ok(visualGroup, 'expected base_link to keep its visual group');
  assert.equal(visualGroup.position.x, 0);
  assert.equal(visualGroup.position.y, 0);
  assert.equal(visualGroup.position.z, 0);

  const visualRoot = visualGroup.children[0] as THREE.Object3D | undefined;
  assert.ok(visualRoot, 'expected base_link visual mesh to load');

  const center = getWorldBox(visualRoot).getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center.x - 0.029698431491851807) < 1e-6);
  assert.ok(Math.abs(center.y - 0.0000037103891372680664) < 1e-6);
  assert.ok(Math.abs(center.z - 0.02502359077334404) < 1e-6);
});
