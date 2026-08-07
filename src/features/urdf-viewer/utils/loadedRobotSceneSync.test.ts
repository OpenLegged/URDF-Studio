import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { parseURDF } from '@/core/parsers';
import { URDFLink, URDFVisual } from '@/core/parsers/urdf/loader/URDFClasses';
import { prepareAssemblyRobotData } from '@/core/robot/assemblyComponentPreparation';
import {
  createAssemblySceneProjection,
  createSingleComponentWorkspace,
} from '@/core/robot';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { DEFAULT_LINK, GeometryType } from '@/types';

import {
  COLLISION_OVERLAY_RENDER_ORDER,
  COLLISION_STANDARD_RENDER_ORDER,
  MATERIAL_CONFIG,
  collisionBaseMaterial,
} from './materials';
import {
  collectURDFMaterialsFromLinks,
  parseURDFMaterials,
  resolveURDFMaterialsForScene,
} from './urdfMaterials';
import { syncLoadedRobotScene } from './loadedRobotSceneSync';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function toLinearTuple(r: number, g: number, b: number): number[] {
  return new THREE.Color()
    .setRGB(r, g, b, THREE.SRGBColorSpace)
    .toArray()
    .map((value) => Number(value.toFixed(4)));
}

function toViewerTuple(r: number, g: number, b: number, materialName: string): number[] {
  const material = createMatteMaterial({
    color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace),
    name: materialName,
    preserveExactColor: true,
  });
  return material.color.toArray().map((value) => Number(value.toFixed(4)));
}

function readPreparedAssemblyRobotData(filePath: string) {
  const parsed = parseURDF(readFileSync(filePath, 'utf8'));
  assert.ok(parsed, `expected ${filePath} to parse`);
  const { selection: _selection, ...robot } = parsed;
  return prepareAssemblyRobotData(robot, {
    sourceFilePath: filePath,
    sourceFormat: 'urdf',
  });
}

function createUrdfVisualRoot(
  runtimeKey: string,
  materialName: string,
): { visual: URDFVisual; mesh: THREE.Mesh } {
  const visual = new URDFVisual();
  visual.name = runtimeKey;
  visual.userData.runtimeKey = runtimeKey;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: materialName, color: new THREE.Color('#ffffff') }),
  );
  visual.add(mesh);

  return { visual, mesh };
}

function createMjcfVisualRoot(
  name: string,
  color: string,
  visualOrder: number,
): { visual: URDFVisual; mesh: THREE.Mesh } {
  const visual = new URDFVisual();
  visual.name = name;
  visual.userData.visualOrder = visualOrder;

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name, color: new THREE.Color(color) }),
  );
  visual.add(mesh);

  return { visual, mesh };
}

test('syncLoadedRobotScene upgrades late URDF visual meshes to shared matte materials', () => {
  const urdfMaterials = parseURDFMaterials(`<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo/meshes/base.dae" />
      </geometry>
      <material name="Material">
        <color rgba="0.9 0.95 0.95 1" />
      </material>
      <material name="dark-rubber">
        <color rgba="0.05 0.05 0.05 1" />
      </material>
    </visual>
  </link>
</robot>`);

  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const colladaScene = new THREE.Group();
  colladaScene.name = 'Scene';

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
    new THREE.MeshLambertMaterial({ name: 'Material', color: new THREE.Color(1, 1, 1) }),
    new THREE.MeshLambertMaterial({ name: 'dark-rubber', color: new THREE.Color(0, 0, 0) }),
  ]);

  colladaScene.add(mesh);
  visual.add(colladaScene);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials,
  });

  if (!Array.isArray(mesh.material)) {
    assert.fail('expected upgraded URDF visual mesh to keep array material slots');
  }

  const nextMaterials = mesh.material;
  const [primaryMaterial, secondaryMaterial] = nextMaterials;
  assert.equal(result.changed, true);
  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(mesh), true);
  assert.equal(primaryMaterial instanceof THREE.MeshStandardMaterial, true);
  assert.equal(secondaryMaterial instanceof THREE.MeshStandardMaterial, true);
  if (
    !(primaryMaterial instanceof THREE.MeshStandardMaterial) ||
    !(secondaryMaterial instanceof THREE.MeshStandardMaterial)
  ) {
    assert.fail('expected URDF visual materials to upgrade to MeshStandardMaterial');
  }
  assert.equal(mesh.userData.parentLinkName, 'base_link');
  assert.equal(mesh.userData.isVisualMesh, true);
  assert.equal(mesh.userData.isCollisionMesh, false);
  assert.deepEqual(
    primaryMaterial.color.toArray().map((value) => Number(value.toFixed(4))),
    toLinearTuple(0.9, 0.95, 0.95),
  );
  assert.deepEqual(
    secondaryMaterial.color.toArray().map((value) => Number(value.toFixed(4))),
    toLinearTuple(0.05, 0.05, 0.05),
  );
  assert.equal(primaryMaterial.roughness, MATERIAL_CONFIG.roughness);
  assert.equal(primaryMaterial.metalness, MATERIAL_CONFIG.metalness);
  assert.equal(primaryMaterial.envMapIntensity, MATERIAL_CONFIG.envMapIntensity);
  assert.equal(primaryMaterial.toneMapped, false);
  assert.equal(secondaryMaterial.toneMapped, false);
});

test('syncLoadedRobotScene keeps conflicting Unitree workspace materials scoped to each component visual', () => {
  const g1Robot = readPreparedAssemblyRobotData(
    'test/unitree_ros/robots/g1_description/g1_23dof.urdf',
  );
  const h1Robot = readPreparedAssemblyRobotData(
    'test/unitree_ros/robots/h1_description/urdf/h1_with_hand.urdf',
  );

  const workspace = createSingleComponentWorkspace(g1Robot, {
    componentId: 'comp_g1_23dof',
    componentName: 'g1_23dof',
  });
  workspace.components.comp_h1_with_hand = createSingleComponentWorkspace(h1Robot, {
    componentId: 'comp_h1_with_hand',
    componentName: 'h1_with_hand',
  }).components.comp_h1_with_hand!;
  const projectedLinks = createAssemblySceneProjection(workspace).robotData.links;

  const g1LinkId = 'comp_g1_23dof_left_hip_roll_link';
  const h1LinkId = 'comp_h1_with_hand_logo_link';
  const robotLinks = {
    [g1LinkId]: projectedLinks[g1LinkId],
    [h1LinkId]: projectedLinks[h1LinkId],
  };
  const g1WhiteMaterialName = 'comp_g1_23dof_white';
  const h1WhiteMaterialName = 'comp_h1_with_hand_white';
  const urdfMaterials = resolveURDFMaterialsForScene('<robot name="workspace" />', robotLinks);
  const expectedG1White = collectURDFMaterialsFromLinks({
    [g1LinkId]: robotLinks[g1LinkId],
  }).get(g1WhiteMaterialName);
  const expectedH1White = collectURDFMaterialsFromLinks({
    [h1LinkId]: robotLinks[h1LinkId],
  }).get(h1WhiteMaterialName);

  assert.ok(expectedG1White?.rgba, 'expected Unitree G1 fixture to define a white material');
  assert.ok(expectedH1White?.rgba, 'expected Unitree H1 fixture to define a white material');
  assert.notDeepEqual(expectedG1White?.rgba, expectedH1White?.rgba);

  const robot = new THREE.Group();
  const g1Link = new URDFLink();
  g1Link.name = g1LinkId;
  const h1Link = new URDFLink();
  h1Link.name = h1LinkId;

  const g1Visual = createUrdfVisualRoot(`${g1LinkId}::visual::0`, g1WhiteMaterialName);
  const h1Visual = createUrdfVisualRoot(`${h1LinkId}::visual::0`, h1WhiteMaterialName);

  g1Link.add(g1Visual.visual);
  h1Link.add(h1Visual.visual);
  robot.add(g1Link, h1Link);
  (robot as any).links = {
    [g1LinkId]: g1Link,
    [h1LinkId]: h1Link,
  };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials,
    robotLinks,
  });

  assert.equal(result.linkMeshMap.get(`${g1LinkId}:visual`)?.includes(g1Visual.mesh), true);
  assert.equal(result.linkMeshMap.get(`${h1LinkId}:visual`)?.includes(h1Visual.mesh), true);
  assert.equal(g1Visual.mesh.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal(h1Visual.mesh.material instanceof THREE.MeshStandardMaterial, true);
  if (
    !(g1Visual.mesh.material instanceof THREE.MeshStandardMaterial) ||
    !(h1Visual.mesh.material instanceof THREE.MeshStandardMaterial) ||
    !expectedG1White?.rgba ||
    !expectedH1White?.rgba
  ) {
    assert.fail('expected Unitree workspace materials to upgrade into scoped standard materials');
  }

  assert.equal(result.changed, true);
  assert.deepEqual(
    g1Visual.mesh.material.color.toArray().map((value) => Number(value.toFixed(4))),
    toViewerTuple(
      expectedG1White.rgba[0],
      expectedG1White.rgba[1],
      expectedG1White.rgba[2],
      expectedG1White.name ?? 'white',
    ),
  );
  assert.deepEqual(
    h1Visual.mesh.material.color.toArray().map((value) => Number(value.toFixed(4))),
    toViewerTuple(
      expectedH1White.rgba[0],
      expectedH1White.rgba[1],
      expectedH1White.rgba[2],
      expectedH1White.name ?? 'white',
    ),
  );
});

test('syncLoadedRobotScene indexes visual meshes attached directly to a root link object', () => {
  const robot = new URDFLink();
  robot.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const rootMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'root_visual', color: new THREE.Color('#7f7f7f') }),
  );

  visual.add(rootMesh);
  robot.add(visual);
  (robot as any).links = { base_link: robot };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(rootMesh), true);
  assert.equal(rootMesh.userData.parentLinkName, 'base_link');
  assert.equal(rootMesh.userData.isVisualMesh, true);
  assert.equal(rootMesh.userData.isCollisionMesh, false);
});

test('syncLoadedRobotScene restores visual mesh shadow flags even when the material is already normalized', () => {
  const robot = new URDFLink();
  robot.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const normalizedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    name: 'root_visual',
  });
  const rootMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), normalizedMaterial);
  rootMesh.castShadow = false;
  rootMesh.receiveShadow = false;

  visual.add(rootMesh);
  robot.add(visual);
  (robot as any).links = { base_link: robot };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(rootMesh.material, normalizedMaterial);
  assert.equal(rootMesh.castShadow, true);
  assert.equal(rootMesh.receiveShadow, true);
  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(rootMesh), true);
});

test('syncLoadedRobotScene upgrades MJCF visual meshes to the shared matte viewer materials', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const mjcfMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'mjcf_body', color: new THREE.Color('#7f7f7f') }),
  );

  visual.add(mjcfMesh);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });
  const expectedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    name: 'mjcf_body',
  });

  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(mjcfMesh), true);
  assert.equal(mjcfMesh.material instanceof THREE.MeshStandardMaterial, true);
  if (!(mjcfMesh.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected MJCF visual material to upgrade to MeshStandardMaterial');
  }

  assert.equal(result.changed, true);
  assert.equal(mjcfMesh.userData.parentLinkName, 'base_link');
  assert.equal(mjcfMesh.userData.isVisualMesh, true);
  assert.equal(mjcfMesh.userData.isCollisionMesh, false);
  assert.equal(mjcfMesh.material.roughness, expectedMaterial.roughness);
  assert.equal(mjcfMesh.material.metalness, expectedMaterial.metalness);
  assert.equal(mjcfMesh.material.envMapIntensity, expectedMaterial.envMapIntensity);
});

test('syncLoadedRobotScene hides MJCF world runtime geometry when the world toggle is disabled', () => {
  const robot = new THREE.Group();
  const worldLink = new URDFLink();
  worldLink.name = 'world';

  const visual = new URDFVisual();
  visual.name = 'world_visual';
  const worldMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'world_ground', color: new THREE.Color('#7f7f7f') }),
  );
  visual.add(worldMesh);

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'world_collision';
  (collisionGroup as any).isURDFCollider = true;
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  worldLink.add(visual);
  worldLink.add(collisionGroup);
  robot.add(worldLink);
  (robot as any).links = { world: worldLink };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    showMjcfWorldLink: false,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(worldMesh.visible, false);
  assert.equal(collisionGroup.visible, false);
  assert.equal(result.linkMeshMap.get('world:visual')?.includes(worldMesh), true);
});

test('syncLoadedRobotScene boosts collision overlay opacity when visuals are hidden', () => {
  const previousOpacity = collisionBaseMaterial.opacity;
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  (collisionGroup as any).isURDFCollider = true;
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: false,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(collisionBaseMaterial.opacity, 0.72);

  collisionBaseMaterial.opacity = previousOpacity;
  collisionBaseMaterial.needsUpdate = true;
});

test('syncLoadedRobotScene maps folded MJCF visual meshes onto semantic synthetic link ids', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const mainVisual = new URDFVisual();
  mainVisual.name = 'base_visual';
  const mainMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_main', color: new THREE.Color('#7f7f7f') }),
  );
  mainVisual.add(mainMesh);
  link.add(mainVisual);

  const foldedAttachmentVisual = new URDFVisual();
  foldedAttachmentVisual.name = 'base_attachment_visual';
  const attachmentMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_attachment', color: new THREE.Color('#999999') }),
  );
  foldedAttachmentVisual.add(attachmentMesh);
  link.add(foldedAttachmentVisual);

  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
      },
      base_link_geom_1: {
        ...DEFAULT_LINK,
        id: 'base_link_geom_1',
        name: 'base_link_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
      },
    },
  });

  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(mainMesh), true);
  assert.equal(result.linkMeshMap.get('base_link_geom_1:visual')?.includes(attachmentMesh), true);
  assert.equal(mainMesh.userData.parentLinkName, 'base_link');
  assert.equal(attachmentMesh.userData.parentLinkName, 'base_link_geom_1');
  assert.equal(attachmentMesh.userData.runtimeParentLinkName, 'base_link');
});

test('syncLoadedRobotScene prefers MJCF visualOrder over traversal order for folded synthetic links', () => {
  const robot = new THREE.Group();
  const headLink = new URDFLink();
  headLink.name = 'head';

  const tooth = createMjcfVisualRoot('tooth_visual', '#ffffff', 5);
  const nose = createMjcfVisualRoot('nose_visual', '#ffb333', 4);
  const head = createMjcfVisualRoot('head_visual', '#8c9ebf', 0);
  const eyebrow = createMjcfVisualRoot('eyebrow_visual', '#736b59', 1);
  const hair = createMjcfVisualRoot('hair_visual', '#736b59', 2);
  const face = createMjcfVisualRoot('face_visual', '#ffffff', 3);

  // Intentionally scramble runtime child order to match the xuebao regression shape.
  headLink.add(tooth.visual, nose.visual, head.visual, eyebrow.visual, hair.visual, face.visual);
  robot.add(headLink);
  (robot as any).links = { head: headLink };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      head: {
        ...DEFAULT_LINK,
        id: 'head',
        name: 'head',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_1: {
        ...DEFAULT_LINK,
        id: 'head_geom_1',
        name: 'head_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_2: {
        ...DEFAULT_LINK,
        id: 'head_geom_2',
        name: 'head_geom_2',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_3: {
        ...DEFAULT_LINK,
        id: 'head_geom_3',
        name: 'head_geom_3',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_4: {
        ...DEFAULT_LINK,
        id: 'head_geom_4',
        name: 'head_geom_4',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_5: {
        ...DEFAULT_LINK,
        id: 'head_geom_5',
        name: 'head_geom_5',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
    },
  });

  assert.equal(result.linkMeshMap.get('head:visual')?.includes(head.mesh), true);
  assert.equal(result.linkMeshMap.get('head_geom_1:visual')?.includes(eyebrow.mesh), true);
  assert.equal(result.linkMeshMap.get('head_geom_2:visual')?.includes(hair.mesh), true);
  assert.equal(result.linkMeshMap.get('head_geom_3:visual')?.includes(face.mesh), true);
  assert.equal(result.linkMeshMap.get('head_geom_4:visual')?.includes(nose.mesh), true);
  assert.equal(result.linkMeshMap.get('head_geom_5:visual')?.includes(tooth.mesh), true);
  assert.equal(head.mesh.userData.parentLinkName, 'head');
  assert.equal(eyebrow.mesh.userData.parentLinkName, 'head_geom_1');
  assert.equal(hair.mesh.userData.parentLinkName, 'head_geom_2');
  assert.equal(face.mesh.userData.parentLinkName, 'head_geom_3');
  assert.equal(nose.mesh.userData.parentLinkName, 'head_geom_4');
  assert.equal(tooth.mesh.userData.parentLinkName, 'head_geom_5');
});

test('syncLoadedRobotScene normalizes non-zero MJCF visualOrder offsets before mapping synthetic links', () => {
  const robot = new THREE.Group();
  const headLink = new URDFLink();
  headLink.name = 'head';

  const head = createMjcfVisualRoot('head_visual', '#8c9ebf', 4);
  const eyebrow = createMjcfVisualRoot('eyebrow_visual', '#736b59', 5);
  const hair = createMjcfVisualRoot('hair_visual', '#736b59', 6);
  const face = createMjcfVisualRoot('face_visual', '#ffffff', 7);
  const nose = createMjcfVisualRoot('nose_visual', '#ffb333', 8);
  const tooth = createMjcfVisualRoot('tooth_visual', '#ffffff', 9);

  const hiddenOffsetGroup = new THREE.Group();
  hiddenOffsetGroup.name = 'head_geom_offset';
  const hiddenHelperMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'hidden_helper', color: new THREE.Color('#222222') }),
  );
  hiddenOffsetGroup.add(hiddenHelperMesh);
  headLink.add(
    hiddenOffsetGroup,
    head.visual,
    eyebrow.visual,
    hair.visual,
    face.visual,
    nose.visual,
    tooth.visual,
  );

  robot.add(headLink);
  (robot as any).links = { head: headLink };

  syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      head: {
        ...DEFAULT_LINK,
        id: 'head',
        name: 'head',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_1: {
        ...DEFAULT_LINK,
        id: 'head_geom_1',
        name: 'head_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_2: {
        ...DEFAULT_LINK,
        id: 'head_geom_2',
        name: 'head_geom_2',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_3: {
        ...DEFAULT_LINK,
        id: 'head_geom_3',
        name: 'head_geom_3',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_4: {
        ...DEFAULT_LINK,
        id: 'head_geom_4',
        name: 'head_geom_4',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
      head_geom_5: {
        ...DEFAULT_LINK,
        id: 'head_geom_5',
        name: 'head_geom_5',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
    },
  });

  assert.equal(hiddenHelperMesh.userData.parentLinkName, 'head');
  assert.equal(head.mesh.userData.parentLinkName, 'head');
  assert.equal(eyebrow.mesh.userData.parentLinkName, 'head_geom_1');
  assert.equal(hair.mesh.userData.parentLinkName, 'head_geom_2');
  assert.equal(face.mesh.userData.parentLinkName, 'head_geom_3');
  assert.equal(nose.mesh.userData.parentLinkName, 'head_geom_4');
  assert.equal(tooth.mesh.userData.parentLinkName, 'head_geom_5');
});

test('syncLoadedRobotScene keeps MJCF visual and collision ownership on the same semantic link id when assembly prefixes diverge from runtime names', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'left_hand_base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_visual', color: new THREE.Color('#7f7f7f') }),
  );
  visual.add(visualMesh);
  link.add(visual);

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);

  robot.add(link);
  (robot as any).links = { left_hand_base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      comp_left_hand_base_link: {
        ...DEFAULT_LINK,
        id: 'comp_left_hand_base_link',
        name: 'left_hand_base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.SPHERE,
        },
      },
    },
  });

  assert.equal(
    result.linkMeshMap.get('comp_left_hand_base_link:visual')?.includes(visualMesh),
    true,
  );
  assert.equal(
    result.linkMeshMap.get('comp_left_hand_base_link:collision')?.includes(collisionMesh),
    true,
  );
  assert.equal(visualMesh.userData.parentLinkName, 'comp_left_hand_base_link');
  assert.equal(visualMesh.userData.runtimeParentLinkName, 'left_hand_base_link');
  assert.equal(collisionGroup.userData.parentLinkName, 'comp_left_hand_base_link');
  assert.equal(collisionGroup.userData.runtimeParentLinkName, 'left_hand_base_link');
  assert.equal(collisionMesh.userData.parentLinkName, 'comp_left_hand_base_link');
  assert.equal(collisionMesh.userData.runtimeParentLinkName, 'left_hand_base_link');
});

test('syncLoadedRobotScene keeps all meshes inside one folded MJCF visual body on the same semantic link id', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const mainVisual = new URDFVisual();
  mainVisual.name = 'base_visual';
  mainVisual.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({ name: 'base_main', color: new THREE.Color('#7f7f7f') }),
    ),
  );
  link.add(mainVisual);

  const foldedAttachmentVisual = new URDFVisual();
  foldedAttachmentVisual.name = 'base_attachment_visual';
  const attachmentMeshA = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_attachment_a', color: new THREE.Color('#999999') }),
  );
  const attachmentMeshB = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_attachment_b', color: new THREE.Color('#aaaaaa') }),
  );
  foldedAttachmentVisual.add(attachmentMeshA, attachmentMeshB);
  link.add(foldedAttachmentVisual);

  robot.add(link);
  (robot as any).links = { base_link: link };

  syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
      },
      base_link_geom_1: {
        ...DEFAULT_LINK,
        id: 'base_link_geom_1',
        name: 'base_link_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
    },
  });

  assert.equal(attachmentMeshA.userData.parentLinkName, 'base_link_geom_1');
  assert.equal(attachmentMeshB.userData.parentLinkName, 'base_link_geom_1');
});

test('syncLoadedRobotScene re-normalizes already-standard URDF visual materials that drifted away from viewer shading defaults', () => {
  const urdfMaterials = parseURDFMaterials(`<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo/meshes/base.dae" />
      </geometry>
      <material name="Material">
        <color rgba="0.85 0.2 0.1 1" />
      </material>
    </visual>
  </link>
</robot>`);

  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const standardMaterial = new THREE.MeshStandardMaterial({
    name: 'Material',
    color: new THREE.Color('#ffffff'),
    roughness: 0,
    metalness: 1,
    emissive: new THREE.Color('#ff8800'),
    emissiveIntensity: 1,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standardMaterial);
  visual.add(mesh);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials,
  });

  assert.equal(result.changed, true);
  assert.equal(mesh.material instanceof THREE.MeshStandardMaterial, true);
  if (!(mesh.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected URDF visual material to stay MeshStandardMaterial after normalization');
  }

  assert.deepEqual(
    mesh.material.color.toArray().map((value) => Number(value.toFixed(4))),
    toLinearTuple(0.85, 0.2, 0.1),
  );
  assert.equal(mesh.material.roughness, MATERIAL_CONFIG.roughness);
  assert.equal(mesh.material.metalness, MATERIAL_CONFIG.metalness);
  assert.equal(mesh.material.emissive.getHex(), 0x000000);
  assert.equal(mesh.material.toneMapped, false);
});

test('syncLoadedRobotScene re-normalizes already-standard MJCF visual materials to the shared matte viewer shading', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const texture = new THREE.Texture();
  const driftedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    map: texture,
    name: 'mjcf_body',
    preserveExactColor: true,
  });
  driftedMaterial.roughness = 0;
  driftedMaterial.metalness = 1;
  driftedMaterial.emissive = new THREE.Color('#ffaa33');
  driftedMaterial.emissiveIntensity = 1;
  const roughnessMap = new THREE.Texture();
  driftedMaterial.roughnessMap = roughnessMap;

  const mjcfMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), driftedMaterial);

  visual.add(mjcfMesh);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });
  const expectedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    map: texture,
    name: 'mjcf_body',
    preserveExactColor: true,
  });

  assert.equal(result.changed, true);
  assert.equal(mjcfMesh.material instanceof THREE.MeshStandardMaterial, true);
  if (!(mjcfMesh.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected MJCF visual material to stay MeshStandardMaterial after normalization');
  }

  assert.equal(mjcfMesh.material.roughness, expectedMaterial.roughness);
  assert.equal(mjcfMesh.material.metalness, expectedMaterial.metalness);
  assert.equal(mjcfMesh.material.envMapIntensity, expectedMaterial.envMapIntensity);
  assert.equal(mjcfMesh.material.emissive.getHex(), 0x000000);
  assert.equal(mjcfMesh.material.roughnessMap, roughnessMap);
  assert.equal(mjcfMesh.material.map, texture);
  assert.equal(mjcfMesh.material.toneMapped, false);
});

test('syncLoadedRobotScene keeps collision meshes as always-on-top overlays', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );

  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(result.linkMeshMap.get('base_link:collision')?.includes(collisionMesh), true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(collisionMesh.userData.parentLinkName, 'base_link');
  assert.equal(collisionMesh.userData.isCollisionMesh, true);
  assert.equal(collisionMesh.userData.isVisualMesh, false);
  assert.equal(collisionMesh.visible, true);
  assert.equal(collisionMesh.renderOrder, COLLISION_OVERLAY_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, false);
  assert.equal(collisionBaseMaterial.depthWrite, false);
});

test('syncLoadedRobotScene can keep collision meshes in normal depth-tested order', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );

  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    showCollisionAlwaysOnTop: false,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(collisionMesh.renderOrder, COLLISION_STANDARD_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, true);
  assert.equal(collisionBaseMaterial.depthWrite, false);

  syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    showCollisionAlwaysOnTop: true,
    urdfMaterials: null,
  });

  assert.equal(collisionMesh.renderOrder, COLLISION_OVERLAY_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, false);
});

test('syncLoadedRobotScene traverses each collider subtree only once', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const nestedGroup = new THREE.Group();
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  nestedGroup.add(collisionMesh);
  collisionGroup.add(nestedGroup);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const originalTraverse = collisionGroup.traverse.bind(collisionGroup);
  let traverseCalls = 0;
  collisionGroup.traverse = ((callback: (object: THREE.Object3D) => void) => {
    traverseCalls += 1;
    return originalTraverse(callback);
  }) as typeof collisionGroup.traverse;

  syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(traverseCalls, 0);
  assert.equal(collisionMesh.userData.parentLinkName, 'base_link');
});

test('syncLoadedRobotScene preserves hidden collider metadata when collisions are disabled', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const collisionMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const collisionMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1), collisionMaterial);
  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.linkMeshMap.has('base_link:collision'), true);
  assert.equal(result.linkMeshMap.get('base_link:collision')?.includes(collisionMesh), true);
  assert.equal(collisionGroup.visible, false);
  assert.equal(collisionGroup.userData.parentLinkName, 'base_link');
  assert.equal(collisionMesh.userData.isCollisionMesh, true);
  assert.equal(collisionMesh.userData.parentLinkName, 'base_link');
  assert.equal(collisionMesh.userData.runtimeParentLinkName, 'base_link');
  assert.equal(collisionMesh.material, collisionBaseMaterial);
});

test('syncLoadedRobotScene disposes replaced collision materials when normalizing collision meshes', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;

  let materialDisposeCalls = 0;
  let textureDisposeCalls = 0;

  const previousTexture = new THREE.Texture();
  previousTexture.dispose = () => {
    textureDisposeCalls += 1;
  };

  const previousMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: previousTexture });
  previousMaterial.dispose = () => {
    materialDisposeCalls += 1;
  };

  const collisionMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previousMaterial);

  collider.add(collisionMesh);
  link.add(collider);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(materialDisposeCalls, 1);
  assert.equal(textureDisposeCalls, 1);
});
