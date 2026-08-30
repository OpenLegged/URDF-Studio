import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createThreeColorFromSRGB } from '@/core/utils/color.ts';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import {
  syncInertiaVisualizationForLinks,
  syncIkHandleVisualizationForLinks,
  syncJointHelperInteractionStateForJoints,
  syncJointAxesVisualizationForJoints,
  syncLinkHelperInteractionStateForLinks,
  syncLinkVisualColors,
  syncMjcfSiteVisualizationForLinks,
  syncMjcfTendonVisualizationForRobot,
  syncOriginAxesVisualizationForLinks,
} from './visualizationObjectSync.ts';
import { MJCF_TENDON_RENDER_ORDER } from './visualizationFactories.ts';
import { GIZMO_BASE_RENDER_ORDER } from '@/shared/components/3d/unified-transform-controls/gizmoCore.ts';

function assertTupleClose(
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number,
  message: string,
): void {
  assert.equal(actual.length, expected.length, `${message}: tuple length mismatch`);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]!) <= tolerance,
      `${message}[${index}] expected ${expected[index]}, got ${value}`,
    );
  });
}

test('syncOriginAxesVisualizationForLinks is a no-op on the second identical pass', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  const firstChanged = syncOriginAxesVisualizationForLinks({
    links: [link],
    showOrigins: true,
    showOriginsOverlay: false,
    originSize: 0.2,
  });
  const secondChanged = syncOriginAxesVisualizationForLinks({
    links: [link],
    showOrigins: true,
    showOriginsOverlay: false,
    originSize: 0.2,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(link.userData.__originAxes.visible, true);
});

test('syncOriginAxesVisualizationForLinks keeps origin overlay below transform gizmo render order', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  syncOriginAxesVisualizationForLinks({
    links: [link],
    showOrigins: true,
    showOriginsOverlay: true,
    originSize: 0.2,
  });

  const originAxes = link.userData.__originAxes as THREE.Object3D;
  const originMesh = originAxes.children.find((child: any) => child.isMesh) as THREE.Mesh;

  assert.ok(originMesh.renderOrder < GIZMO_BASE_RENDER_ORDER);
});

test('syncJointAxesVisualizationForJoints is a no-op on the second identical pass', () => {
  const joint = new THREE.Group() as THREE.Group & {
    isURDFJoint?: boolean;
    jointType?: string;
    axis?: THREE.Vector3;
  };
  joint.isURDFJoint = true;
  joint.jointType = 'revolute';
  joint.axis = new THREE.Vector3(0, 0, 1);

  const firstChanged = syncJointAxesVisualizationForJoints({
    joints: [joint],
    showJointAxes: true,
    showJointAxesOverlay: true,
    jointAxisSize: 0.5,
  });
  const secondChanged = syncJointAxesVisualizationForJoints({
    joints: [joint],
    showJointAxes: true,
    showJointAxesOverlay: true,
    jointAxisSize: 0.5,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(joint.userData.__jointAxisViz.visible, true);
});

test('syncInertiaVisualizationForLinks is a no-op on the second identical pass', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks: Record<string, UrdfLink> = {
    base_link: {
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  } as any;

  const firstChanged = syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });
  const secondChanged = syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(link.userData.__inertiaVisualGroup.visible, true);
});

test('syncInertiaVisualizationForLinks renders overlay inertia on top of robot meshes', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks: Record<string, UrdfLink> = {
    base_link: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  };

  syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: false,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  const inertiaBox = link.userData.__inertiaBox as THREE.Object3D | undefined;
  assert.ok(inertiaBox, 'inertia box should be created');

  const inertiaRenderables: Array<THREE.Mesh | THREE.LineSegments> = [];
  inertiaBox.traverse((child) => {
    if ((child as THREE.Mesh).isMesh || child.type === 'LineSegments') {
      inertiaRenderables.push(child as THREE.Mesh | THREE.LineSegments);
    }
  });

  assert.equal(inertiaRenderables.length, 2);
  inertiaRenderables.forEach((child) => {
    const material = child.material as THREE.Material;
    assert.equal(material.depthTest, false);
    assert.equal(material.depthWrite, false);
    assert.ok(child.renderOrder > 0, 'overlay inertia should draw in the helper layer');
  });
});

test('syncInertiaVisualizationForLinks keeps non-overlay inertia depth-tested', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks: Record<string, UrdfLink> = {
    base_link: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  };

  syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: false,
    showCenterOfMass: false,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  const inertiaBox = link.userData.__inertiaBox as THREE.Object3D | undefined;
  assert.ok(inertiaBox, 'inertia box should be created');

  const inertiaRenderables: Array<THREE.Mesh | THREE.LineSegments> = [];
  inertiaBox.traverse((child) => {
    if ((child as THREE.Mesh).isMesh || child.type === 'LineSegments') {
      inertiaRenderables.push(child as THREE.Mesh | THREE.LineSegments);
    }
  });

  assert.equal(inertiaRenderables.length, 2);
  inertiaRenderables.forEach((child) => {
    const material = child.material as THREE.Material;
    assert.equal(material.depthTest, true);
    assert.equal(material.depthWrite, false);
    assert.equal(child.renderOrder, 0);
  });
});

test('syncIkHandleVisualizationForLinks creates an invisible IK anchor without a visible mesh sphere', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  const robotLinks = {
    base_link: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
      visual: {
        ...DEFAULT_LINK.visual,
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.2 },
        origin: {
          xyz: { x: 0.2, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
      visualBodies: [],
      collision: {
        ...DEFAULT_LINK.collision,
        type: GeometryType.NONE,
        dimensions: { x: 0, y: 0, z: 0 },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
      collisionBodies: [],
    },
  } as any;
  const robotJoints = {};

  const firstChanged = syncIkHandleVisualizationForLinks({
    links: [link],
    robotLinks,
    robotJoints,
    showIkHandles: true,
    showIkHandlesAlwaysOnTop: false,
  });

  assert.equal(firstChanged, true);
  const ikHandle = link.userData.__ikHandle as THREE.Group | undefined;
  assert.ok(ikHandle, 'ik handle should be created');
  assert.equal(ikHandle.children.length, 1, 'ik handle should keep only a hidden pick target');
  assert.equal(ikHandle.children[0]?.name, '__ik_handle_pick_target__');
  assert.equal(ikHandle.visible, true);

  const secondChanged = syncIkHandleVisualizationForLinks({
    links: [link],
    robotLinks,
    robotJoints,
    showIkHandles: true,
    showIkHandlesAlwaysOnTop: true,
  });

  assert.equal(secondChanged, true);
  assert.equal(ikHandle.children.length, 1, 'top-most toggle should keep the hidden pick target');
});

test('syncLinkVisualColors parses 8-digit hex colors without reusing the previous link color', () => {
  const robot = new THREE.Group();

  const brownLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  brownLink.isURDFLink = true;
  brownLink.name = 'wing_right';
  const brownMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#341407' }),
  );
  brownMesh.userData.isVisualMesh = true;
  brownLink.add(brownMesh);

  const membraneLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  membraneLink.isURDFLink = true;
  membraneLink.name = 'wing_right_geom_1';
  const membraneMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: '#89afcc',
      opacity: 0.4,
      transparent: true,
    }),
  );
  membraneMesh.userData.isVisualMesh = true;
  membraneLink.add(membraneMesh);

  robot.add(brownLink, membraneLink);

  const changed = syncLinkVisualColors({
    robot,
    robotLinks: {
      wing_right: {
        ...DEFAULT_LINK,
        id: 'wing_right',
        name: 'wing_right',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          color: '#341407',
        },
      },
      wing_right_geom_1: {
        ...DEFAULT_LINK,
        id: 'wing_right_geom_1',
        name: 'wing_right_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          color: '#89afcc66',
        },
      },
    },
  });

  assert.equal(changed, false);
  assert.equal(
    (membraneMesh.material as THREE.MeshStandardMaterial).color.getHexString(),
    '89afcc',
  );
  assert.equal((membraneMesh.material as THREE.MeshStandardMaterial).opacity, 0.4);
});

test('syncLinkVisualColors uses tracked robot material colors for the primary visual', () => {
  const robot = new THREE.Group();

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#f2f0e8' }),
  );
  mesh.userData.isVisualMesh = true;
  link.add(mesh);
  robot.add(link);

  const changed = syncLinkVisualColors({
    robot,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          color: '#f2f0e8',
        },
      },
    },
    robotMaterials: {
      base_link: { color: '#12ab34' },
    },
  });

  assert.equal(changed, true);
  assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(), '12ab34');
});

test('syncLinkVisualColors keeps an authored texture on its neutral base color', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'cabinet_top';

  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: new THREE.Texture(),
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.userData.isVisualMesh = true;
  link.add(mesh);
  robot.add(link);

  const changed = syncLinkVisualColors({
    robot,
    robotLinks: {
      cabinet_top: {
        ...DEFAULT_LINK,
        id: 'cabinet_top',
        name: 'cabinet_top',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          color: '#2290cb',
        },
      },
    },
    robotMaterials: {
      cabinet_top: { color: '#2290cb' },
    },
  });

  assert.equal(changed, false);
  assert.equal(material.color.getHexString(), 'ffffff');
});

test('syncLinkVisualColors applies visualBodies colors to their matching visual groups', () => {
  const robot = new THREE.Group();

  const wingLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  wingLink.isURDFLink = true;
  wingLink.name = 'wing_right';

  const brownGroup = new THREE.Group() as THREE.Group & { isURDFVisual?: boolean };
  brownGroup.isURDFVisual = true;
  const brownMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#341407' }),
  );
  brownMesh.userData.isVisualMesh = true;
  brownGroup.add(brownMesh);

  const membraneGroup = new THREE.Group() as THREE.Group & { isURDFVisual?: boolean };
  membraneGroup.isURDFVisual = true;
  const membraneMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#341407' }),
  );
  membraneMesh.userData.isVisualMesh = true;
  membraneGroup.add(membraneMesh);

  wingLink.add(brownGroup, membraneGroup);
  robot.add(wingLink);

  const changed = syncLinkVisualColors({
    robot,
    robotLinks: {
      wing_right: {
        ...DEFAULT_LINK,
        id: 'wing_right',
        name: 'wing_right',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          color: '#341407',
        },
        visualBodies: [
          {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            color: '#89afcc66',
          },
        ],
      },
    },
  });

  assert.equal(changed, true);
  assert.equal((brownMesh.material as THREE.MeshStandardMaterial).color.getHexString(), '341407');
  assert.equal(
    (membraneMesh.material as THREE.MeshStandardMaterial).color.getHexString(),
    '89afcc',
  );
  assert.equal((membraneMesh.material as THREE.MeshStandardMaterial).opacity, 0.4);
});

test('syncIkHandleVisualizationForLinks exposes a hidden anchor for intermediate links when IK drag is active', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link1';

  const robotLinks = {
    base: {
      ...DEFAULT_LINK,
      id: 'base',
      name: 'base',
    },
    link1: {
      ...DEFAULT_LINK,
      id: 'link1',
      name: 'link1',
      visual: {
        ...DEFAULT_LINK.visual,
        type: GeometryType.BOX,
        dimensions: { x: 0.8, y: 0.1, z: 0.1 },
        origin: {
          xyz: { x: 0.4, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
      visualBodies: [],
    },
    link2: {
      ...DEFAULT_LINK,
      id: 'link2',
      name: 'link2',
      visual: {
        ...DEFAULT_LINK.visual,
        type: GeometryType.BOX,
        dimensions: { x: 0.6, y: 0.1, z: 0.1 },
        origin: {
          xyz: { x: 0.3, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
      visualBodies: [],
    },
  };
  const robotJoints: Record<string, UrdfJoint> = {
    joint1: {
      ...DEFAULT_JOINT,
      id: 'joint1',
      name: 'joint1',
      type: JointType.REVOLUTE,
      parentLinkId: 'base',
      childLinkId: 'link1',
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 0, y: 0, z: 1 },
    },
    joint2: {
      ...DEFAULT_JOINT,
      id: 'joint2',
      name: 'joint2',
      type: JointType.REVOLUTE,
      parentLinkId: 'link1',
      childLinkId: 'link2',
      origin: {
        xyz: { x: 0.8, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 0, y: 0, z: 1 },
    },
  };

  const passiveChanged = syncIkHandleVisualizationForLinks({
    links: [link],
    robotLinks,
    robotJoints,
    showIkHandles: true,
    showIkHandlesAlwaysOnTop: false,
    ikDragActive: false,
  });

  assert.equal(passiveChanged, false);
  assert.equal(link.userData.__ikHandle, undefined);

  const directDragChanged = syncIkHandleVisualizationForLinks({
    links: [link],
    robotLinks,
    robotJoints,
    showIkHandles: true,
    showIkHandlesAlwaysOnTop: false,
    ikDragActive: true,
  });

  assert.equal(directDragChanged, true);
  const ikHandle = link.userData.__ikHandle as THREE.Group | undefined;
  assert.ok(ikHandle, 'direct IK drag should create a hidden anchor on intermediate links');
  assert.equal(ikHandle.children.length, 1, 'direct IK drag handle should stay invisible');
  assert.equal(ikHandle.children[0]?.name, '__ik_handle_pick_target__');
  assert.equal(ikHandle.visible, true);
});

test('syncMjcfSiteVisualizationForLinks creates MJCF site helpers lazily and hides them when disabled', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__mjcfSitesData = [
    {
      name: 'tool_center',
      type: 'sphere',
      size: [0.02],
      pos: [0, 0, 0.1],
      rgba: [1, 0.4, 0, 1],
    },
  ];

  const firstChanged = syncMjcfSiteVisualizationForLinks({
    links: [link],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: true,
  });
  const secondChanged = syncMjcfSiteVisualizationForLinks({
    links: [link],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: true,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(link.userData.__mjcfSites.visible, true);

  const hiddenChanged = syncMjcfSiteVisualizationForLinks({
    links: [link],
    sourceFormat: 'mjcf',
    showMjcfSites: false,
    showMjcfWorldLink: true,
  });

  assert.equal(hiddenChanged, true);
  assert.equal(link.userData.__mjcfSites.visible, false);
});

test('syncMjcfSiteVisualizationForLinks respects the MJCF world visibility toggle', () => {
  const worldLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  worldLink.isURDFLink = true;
  worldLink.name = 'world';
  worldLink.userData.__mjcfSitesData = [
    {
      name: 'ground_marker',
      type: 'box',
      size: [0.1, 0.1, 0.001],
      pos: [0, 0, 0],
    },
  ];

  syncMjcfSiteVisualizationForLinks({
    links: [worldLink],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: false,
  });

  assert.equal(worldLink.userData.__mjcfSites.visible, false);

  const changed = syncMjcfSiteVisualizationForLinks({
    links: [worldLink],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: true,
  });

  assert.equal(changed, true);
  assert.equal(worldLink.userData.__mjcfSites.visible, true);
});

test('syncMjcfTendonVisualizationForRobot creates hover-pickable tendon meshes with endpoint anchors', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'ankle_bar',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'site_b'],
    },
  ];

  const linkA = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkA.isURDFLink = true;
  linkA.name = 'link_a';
  linkA.userData.__mjcfSitesData = [{ name: 'site_a', pos: [1, 2, 3], size: [0.005] }];
  robot.add(linkA);

  const linkB = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkB.isURDFLink = true;
  linkB.name = 'link_b';
  linkB.userData.__mjcfSitesData = [{ name: 'site_b', pos: [4, 5, 6], size: [0.005] }];
  robot.add(linkB);
  robot.updateMatrixWorld(true);

  const firstChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  const secondChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(robot.userData.__mjcfTendons.visible, true);

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  assert.equal(tendonObject.userData.isVisual, true);
  assert.equal(tendonObject.userData.geometryRole, 'visual');
  const segment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as
    | THREE.Group
    | undefined;
  assert.ok(segment);
  assert.deepEqual(segment.position.toArray(), [2.5, 3.5, 4.5]);
  assert.equal(segment.userData.isVisual, true);
  assert.equal(segment.userData.geometryRole, 'visual');

  const shaft = segment.getObjectByName('__mjcf_tendon_shaft__') as THREE.Mesh | undefined;
  assert.ok(shaft);
  assert.equal(shaft.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal((shaft.material as THREE.MeshStandardMaterial).depthTest, false);
  assert.equal((shaft.material as THREE.MeshStandardMaterial).depthWrite, false);
  assert.equal(shaft.renderOrder, MJCF_TENDON_RENDER_ORDER);
  assert.equal(typeof shaft.raycast, 'function');
  assert.deepEqual(shaft.scale.toArray(), [0.003, Math.sqrt(27), 0.003]);
  assert.equal(shaft.userData.parentLinkName, 'link_a');
  assert.equal(shaft.userData.isVisual, true);
  assert.equal(shaft.userData.isVisualMesh, true);
  assert.equal(shaft.userData.isCollision, false);
  assert.equal(shaft.userData.isCollisionMesh, false);
  assert.equal(shaft.userData.geometryRole, 'visual');

  const anchorA = tendonObject.getObjectByName('__mjcf_tendon_anchor__:0') as
    | THREE.Mesh
    | undefined;
  const anchorB = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as
    | THREE.Mesh
    | undefined;
  assert.ok(anchorA);
  assert.ok(anchorB);
  assert.deepEqual(anchorA.position.toArray(), [1, 2, 3]);
  assert.deepEqual(anchorB.position.toArray(), [4, 5, 6]);
  assert.equal(typeof anchorA.raycast, 'function');
  assert.equal(anchorA.userData.parentLinkName, 'link_a');
  assert.equal(anchorB.userData.parentLinkName, 'link_b');
  assert.equal(anchorA.userData.isVisualMesh, true);
  assert.equal(anchorB.userData.isVisualMesh, true);
  assert.equal(anchorA.userData.geometryRole, 'visual');
  assert.equal(anchorB.userData.geometryRole, 'visual');
  assert.ok(anchorA.scale.x > shaft.scale.x);

  linkB.userData.__mjcfSitesData = [{ name: 'site_b', pos: [7, 8, 9], size: [0.005] }];
  linkB.updateMatrixWorld(true);
  robot.updateMatrixWorld(true);

  const movedChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  assert.equal(movedChanged, true);
  assert.deepEqual(segment.position.toArray(), [4, 5, 6]);
  assert.deepEqual(anchorB.position.toArray(), [7, 8, 9]);

  const hiddenChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: false,
  });
  assert.equal(hiddenChanged, true);
  assert.equal(robot.userData.__mjcfTendons.visible, false);
});

test('syncMjcfTendonVisualizationForRobot resolves MJCF wrap geom anchors from RobotState geometry groups', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'wrapped_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [0, 2, 0], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(0, 1, 0);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  const changed = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  assert.equal(changed, true);
  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const firstSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as
    | THREE.Group
    | undefined;
  const secondSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as
    | THREE.Group
    | undefined;
  assert.ok(firstSegment);
  assert.ok(secondSegment);
  assert.equal(firstSegment.visible, true);
  assert.equal(secondSegment.visible, true);
  assert.deepEqual(firstSegment.position.toArray(), [0, 0.5, 0]);
  assert.deepEqual(secondSegment.position.toArray(), [0, 1.5, 0]);
});

test('syncMjcfTendonVisualizationForRobot projects MJCF wrap geom anchors onto adjacent site path', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'wrapped_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom', sidesite: 'wrap_side' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [0, 2, 0], size: [0.005] },
    { name: 'wrap_side', pos: [1, 1, 0], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(1, 1, 0);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const firstSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const secondSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;
  const wrapAnchor = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as THREE.Mesh;

  assert.deepEqual(firstSegment.position.toArray(), [0, 0.5, 0]);
  assert.deepEqual(secondSegment.position.toArray(), [0, 1.5, 0]);
  assert.deepEqual(wrapAnchor.position.toArray(), [0, 1, 0]);
});

test('syncMjcfTendonVisualizationForRobot expands active sphere wraps into tangent contact segments', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'wrapped_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [4, 0, 0], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(1, 0.5, 0);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.SPHERE;
  wrapGeometry.userData.geometryDimensions = { x: 1, y: 0, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const firstSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const wrapSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;
  const lastSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:2') as THREE.Group;
  const firstContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as THREE.Mesh;
  const secondContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:2') as THREE.Mesh;

  assert.equal(firstSegment.visible, true);
  assert.equal(wrapSegment.visible, true);
  assert.equal(lastSegment.visible, true);
  assertTupleClose(firstContact.position.toArray(), [0.4, -0.3, 0], 1e-7, 'first contact');
  assertTupleClose(
    secondContact.position.toArray(),
    [1.169065850398866, -0.4856047571642403, 0],
    1e-7,
    'second contact',
  );
  assertTupleClose(firstSegment.position.toArray(), [0.2, -0.15, 0], 1e-7, 'first segment');
  assertTupleClose(
    wrapSegment.position.toArray(),
    [0.784532925199433, -0.39280237858212014, 0],
    1e-7,
    'wrap segment',
  );
  assertTupleClose(
    lastSegment.position.toArray(),
    [2.584532925199433, -0.24280237858212014, 0],
    1e-7,
    'last segment',
  );
});

test('syncMjcfTendonVisualizationForRobot expands active cylinder wraps with sidesite-selected contacts', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'cylinder_wrapped_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom', sidesite: 'wrap_side' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [-0.16543177, 0.10792307, 1.1933433], size: [0.005] },
    { name: 'site_b', pos: [-0.1940103, 0.0556474, 0.9636949], size: [0.005] },
    { name: 'wrap_side', pos: [-0.14495786, 0.08223828, 1.11702277], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(-0.149192, 0.096165, 1.103983);
  wrapGeometry.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-0.98226432, -0.13777984, 0.12717513).normalize(),
  );
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.CYLINDER;
  wrapGeometry.userData.geometryDimensions = { x: 0.015, y: 0.04, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const firstSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const wrapSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;
  const lastSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:2') as THREE.Group;
  const firstContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as THREE.Mesh;
  const secondContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:2') as THREE.Mesh;

  assert.equal(firstSegment.visible, true);
  assert.equal(wrapSegment.visible, true);
  assert.equal(lastSegment.visible, true);
  assertTupleClose(
    firstContact.position.toArray(),
    [-0.17401546, 0.07835477, 1.1123561],
    1e-5,
    'first cylinder contact',
  );
  assertTupleClose(
    secondContact.position.toArray(),
    [-0.17436665, 0.07761139, 1.1094447],
    1e-5,
    'second cylinder contact',
  );
});

test('syncMjcfTendonVisualizationForRobot skips near-end cylinder wraps that MuJoCo leaves direct', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'near_end_cylinder_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom', sidesite: 'wrap_side' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [-0.168790298, 0.093560978, 1.256874798], size: [0.005] },
    { name: 'site_b', pos: [-0.133004718, 0.092025153, 1.328790843], size: [0.005] },
    { name: 'wrap_side', pos: [-0.273205782, -0.012493271, 1.406269299], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(-0.164292616, 0.09650666, 1.297182465);
  wrapGeometry.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-0.01980714, 0.01914694, -0.99962046).normalize(),
  );
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.CYLINDER;
  wrapGeometry.userData.geometryDimensions = { x: 0.0109, y: 0.24, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const directSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const skippedSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;

  assert.equal(directSegment.visible, true);
  assert.equal(skippedSegment.visible, false);
  assertTupleClose(
    directSegment.position.toArray(),
    [-0.150897508, 0.0927930655, 1.2928328205],
    1e-9,
    'near-end cylinder direct segment',
  );
});

test('syncMjcfTendonVisualizationForRobot expands inverse sphere wraps through side-inside sites', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'inverse_sphere_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom', sidesite: 'wrap_side' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [-2, 1, 0], size: [0.005] },
    { name: 'site_b', pos: [2, 1, 0], size: [0.005] },
    { name: 'wrap_side', pos: [0, 0, 0], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(0, 0, 0);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.SPHERE;
  wrapGeometry.userData.geometryDimensions = { x: 1, y: 0, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const firstContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as THREE.Mesh;
  const secondContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:2') as THREE.Mesh;
  const firstSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const wrapSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;
  const lastSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:2') as THREE.Group;

  assert.equal(firstSegment.visible, true);
  assert.equal(wrapSegment.visible, true);
  assert.equal(lastSegment.visible, true);
  assertTupleClose(
    firstContact.position.toArray(),
    [-0.8944271909999159, 0.4472135954999579, 0],
    1e-9,
    'first inverse sphere contact',
  );
  assertTupleClose(
    secondContact.position.toArray(),
    [0.8944271909999159, 0.4472135954999579, 0],
    1e-9,
    'second inverse sphere contact',
  );
});

test('syncMjcfTendonVisualizationForRobot expands inverse cylinder wraps through side-inside sites', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'inverse_cylinder_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom', sidesite: 'wrap_side' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [-2, 1, 0.4], size: [0.005] },
    { name: 'site_b', pos: [2, 1, -0.2], size: [0.005] },
    { name: 'wrap_side', pos: [0, 0, 0], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(0, 0, 0);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.CYLINDER;
  wrapGeometry.userData.geometryDimensions = { x: 1, y: 0.5, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const firstContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as THREE.Mesh;
  const secondContact = tendonObject.getObjectByName('__mjcf_tendon_anchor__:2') as THREE.Mesh;
  const firstSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const wrapSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;
  const lastSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:2') as THREE.Group;

  assert.equal(firstSegment.visible, true);
  assert.equal(wrapSegment.visible, true);
  assert.equal(lastSegment.visible, true);
  assertTupleClose(
    firstContact.position.toArray(),
    [-0.8944271909999159, 0.4472135954999579, 0.17888543819998318],
    1e-9,
    'first inverse cylinder contact',
  );
  assertTupleClose(
    secondContact.position.toArray(),
    [0.8944271909999159, 0.4472135954999579, -0.08944271909999159],
    1e-9,
    'second inverse cylinder contact',
  );
});

test('syncMjcfTendonVisualizationForRobot keeps near-surface side-inside cylinder wraps direct', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'near_surface_cylinder_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom', sidesite: 'wrap_side' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [-2, 0.2, 0], size: [0.005] },
    { name: 'site_b', pos: [2, 0.2, 0], size: [0.005] },
    { name: 'wrap_side', pos: [0, 0.8, 0], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(0, 0, 0);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.CYLINDER;
  wrapGeometry.userData.geometryDimensions = { x: 1, y: 0.5, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const firstSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const wrapSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;
  const lastSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:2') as THREE.Group;
  const directEndpoint = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as THREE.Mesh;

  assert.equal(firstSegment.visible, true);
  assert.equal(wrapSegment.visible, false);
  assert.equal(lastSegment.visible, false);
  assertTupleClose(directEndpoint.position.toArray(), [2, 0.2, 0], 1e-9, 'direct endpoint');
});

test('syncMjcfTendonVisualizationForRobot keeps side-inside sphere wraps direct when the site path already penetrates', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'inverse_sphere_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom', sidesite: 'wrap_side' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [-0.133004718, 0.092025153, 1.328790843], size: [0.005] },
    { name: 'site_b', pos: [-0.176516322, 0.08870263, 1.429928721], size: [0.005] },
    { name: 'wrap_side', pos: [-0.16538567, 0.09260161, 1.38967722], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(-0.154140647, 0.106561975, 1.396);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.SPHERE;
  wrapGeometry.userData.geometryDimensions = { x: 0.0297339, y: 0, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const directSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const skippedSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;

  assert.equal(directSegment.visible, true);
  assert.equal(skippedSegment.visible, false);
  assertTupleClose(
    directSegment.position.toArray(),
    [-0.15476052, 0.0903638915, 1.379359782],
    1e-9,
    'side-inside sphere direct segment',
  );
});

test('syncMjcfTendonVisualizationForRobot skips inactive geom wraps outside the adjacent site path', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'inactive_wrap_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'wrap_geom', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'geom', ref: 'wrap_geom' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [0, 2, 0], size: [0.005] },
  ];

  const wrapGeometry = new THREE.Group();
  wrapGeometry.name = 'link::collision::0';
  wrapGeometry.position.set(1, 1, 0);
  wrapGeometry.userData.geometryName = 'wrap_geom';
  wrapGeometry.userData.geometryRole = 'collision';
  wrapGeometry.userData.geometryType = GeometryType.SPHERE;
  wrapGeometry.userData.geometryDimensions = { x: 0.1, y: 0, z: 0 };
  link.add(wrapGeometry);

  robot.add(link);
  robot.updateMatrixWorld(true);

  syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const directSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as THREE.Group;
  const skippedSegment = tendonObject.getObjectByName('__mjcf_tendon_segment__:1') as THREE.Group;

  assert.equal(directSegment.visible, true);
  assert.equal(skippedSegment.visible, false);
  assert.deepEqual(directSegment.position.toArray(), [0, 1, 0]);
});

test('syncMjcfTendonVisualizationForRobot softens near-white tendon colors for better contrast', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'finger_cable',
      rgba: [1, 1, 1, 1],
      attachmentRefs: ['site_a', 'site_b'],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'finger_link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [0, 0.1, 0], size: [0.005] },
  ];
  robot.add(link);
  robot.updateMatrixWorld(true);

  const changed = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  assert.equal(changed, true);

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const shaft = tendonObject.getObjectByName('__mjcf_tendon_shaft__') as THREE.Mesh | undefined;
  assert.ok(shaft);
  assert.equal(shaft.material instanceof THREE.MeshStandardMaterial, true);
  if (!(shaft.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected MJCF tendon shaft to use MeshStandardMaterial');
  }

  const expectedSoftenedWhite = createThreeColorFromSRGB(1, 1, 1).multiplyScalar(0.93);
  assert.ok(Math.abs(shaft.material.color.r - expectedSoftenedWhite.r) <= 1e-6);
  assert.ok(Math.abs(shaft.material.color.g - expectedSoftenedWhite.g) <= 1e-6);
  assert.ok(Math.abs(shaft.material.color.b - expectedSoftenedWhite.b) <= 1e-6);
  assert.equal(shaft.material.toneMapped, true);
  assert.equal(shaft.material.roughness, 0.76);
  assert.equal(shaft.material.metalness, 0.02);
  assert.equal(shaft.material.envMapIntensity, 0.16);
  assert.ok(shaft.material.emissive.r > 0);
});

test('syncMjcfTendonVisualizationForRobot handles multi-attachment tendons generically', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'routing_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'site_b', 'site_c'],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [1, 0, 0], size: [0.005] },
    { name: 'site_c', pos: [1, 1, 0], size: [0.005] },
  ];
  robot.add(link);
  robot.updateMatrixWorld(true);

  const changed = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  assert.equal(changed, true);

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_segment__:0'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_segment__:1'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_anchor__:0'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_anchor__:1'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_anchor__:2'));
});

test('syncJointHelperInteractionStateForJoints promotes hovered joint-axis helpers', () => {
  const joint = new THREE.Group() as THREE.Group & {
    isURDFJoint?: boolean;
    jointType?: string;
    axis?: THREE.Vector3;
  };
  joint.isURDFJoint = true;
  joint.name = 'hip_joint';
  joint.jointType = 'revolute';
  joint.axis = new THREE.Vector3(0, 0, 1);

  syncJointAxesVisualizationForJoints({
    joints: [joint],
    showJointAxes: true,
    showJointAxesOverlay: true,
    jointAxisSize: 0.5,
  });

  const helper = joint.userData.__jointAxisViz as THREE.Object3D;
  const mesh = helper.children.find((child: any) => child.isMesh) as THREE.Mesh;
  const baseRenderOrder = mesh.renderOrder;

  const changed = syncJointHelperInteractionStateForJoints({
    joints: [joint],
    hoveredJointId: 'hip_joint',
  });

  assert.equal(changed, true);
  assert.equal(helper.scale.x, 1);
  assert.equal(helper.scale.y, 1);
  assert.equal(helper.scale.z, 1);
  assert.ok(mesh.renderOrder > baseRenderOrder);
  assert.equal((mesh.material as THREE.MeshBasicMaterial).color.getHex(), 0xfbbf24);
});

test('syncLinkHelperInteractionStateForLinks keeps hovered origin axes at a stable scale', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  syncOriginAxesVisualizationForLinks({
    links: [link],
    showOrigins: true,
    showOriginsOverlay: true,
    originSize: 0.2,
  });

  const originAxes = link.userData.__originAxes as THREE.Object3D;
  const originMesh = originAxes.children.find((child: any) => child.isMesh) as THREE.Mesh;
  const baseRenderOrder = originMesh.renderOrder;
  const baseColor = (originMesh.material as THREE.MeshBasicMaterial).color.clone();

  const changed = syncLinkHelperInteractionStateForLinks({
    links: [link],
    hoveredLinkId: 'base_link',
    hoveredHelperKind: 'origin-axes',
  });

  assert.equal(changed, true);
  assert.equal(originAxes.scale.x, 1);
  assert.equal(originAxes.scale.y, 1);
  assert.equal(originAxes.scale.z, 1);
  assert.ok(originMesh.renderOrder > baseRenderOrder);
  assert.notEqual(
    (originMesh.material as THREE.MeshBasicMaterial).color.getHex(),
    baseColor.getHex(),
  );
  assert.ok(
    (originMesh.material as THREE.MeshBasicMaterial).color.r >= baseColor.r,
    'origin axis hover should brighten the helper color',
  );
});

test('syncLinkHelperInteractionStateForLinks boosts hovered inertia helpers', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks = {
    base_link: {
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  } as any;

  syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  const comVisual = link.userData.__comVisual as THREE.Object3D;
  const comMesh = comVisual.children[0] as THREE.Mesh;
  const baseOpacity = (comMesh.material as THREE.MeshBasicMaterial).opacity;
  const baseRenderOrder = comMesh.renderOrder;

  const changed = syncLinkHelperInteractionStateForLinks({
    links: [link],
    hoveredLinkId: 'base_link',
  });

  assert.equal(changed, true);
  assert.ok(comVisual.scale.x > 1);
  assert.ok((comMesh.material as THREE.MeshBasicMaterial).opacity >= baseOpacity);
  assert.ok(comMesh.renderOrder > baseRenderOrder);
});

test('syncLinkHelperInteractionStateForLinks scopes hover to the active helper kind', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks = {
    base_link: {
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  } as any;

  syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  const comVisual = link.userData.__comVisual as THREE.Object3D;
  const inertiaGroup = link.userData.__inertiaVisualGroup as THREE.Object3D;
  const inertiaBox = inertiaGroup.children.find(
    (child) => child.name === '__inertia_box__',
  ) as THREE.Object3D;

  const changed = syncLinkHelperInteractionStateForLinks({
    links: [link],
    hoveredLinkId: 'base_link',
    hoveredHelperKind: 'center-of-mass',
  });

  assert.equal(changed, true);
  assert.ok(comVisual.scale.x > 1);
  assert.equal(inertiaBox.scale.x, 1);
});
