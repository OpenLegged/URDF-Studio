import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { GeometryType, type RobotFile, type RobotState } from '@/types';
import { loadMJCFToThreeJS } from './mjcfLoader.ts';
import { disposeTransientObject3D } from './mjcfLoadLifecycle.ts';
import {
  clearParsedMJCFModelCache,
  getParsedMJCFModelError,
  getParsedMJCFModelCacheSize,
  parseMJCFModel,
} from './mjcfModel.ts';
import { parseMJCF as parseNullableMJCF } from './mjcfParser.ts';
import { resolveMJCFSource } from './mjcfSourceResolver.ts';
import { computeLinkWorldMatrices } from '@/core/robot';

function waitForNextMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 500,
  intervalMs = 5,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out while waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document as any;
  globalThis.DOMParser = dom.window.DOMParser as any;
  globalThis.XMLSerializer = dom.window.XMLSerializer as any;
  globalThis.Node = dom.window.Node as any;
  globalThis.Element = dom.window.Element as any;
  globalThis.Document = dom.window.Document as any;
}

function parseMJCF(xmlContent: string): RobotState {
  const robot = parseNullableMJCF(xmlContent);
  assert.ok(robot, 'expected MJCF source to parse');
  return robot;
}

test('parseMJCF represents unbounded joints without infinite limit values', () => {
  installDomGlobals();
  const robot = parseMJCF(`
    <mujoco model="unbounded_joint_demo">
      <worldbody>
        <body name="base">
          <body name="tip">
            <joint name="spin" type="hinge" limited="false" />
          </body>
        </body>
      </worldbody>
    </mujoco>
  `);

  assert.ok(robot.joints.spin);
  assert.equal(robot.joints.spin.type, 'continuous');
  assert.deepEqual(robot.joints.spin.limit, undefined);
});

const MYOSUITE_FIXTURE_ROOT = path.resolve('test/myosuite-main');
let myosuiteMjcfFilesCache: RobotFile[] | null = null as RobotFile[] | null;
const CASSIE_MUJOCO_HOME_CONNECT_ANCHOR_TOLERANCE = 0.0025;
const CASSIE_MUJOCO_HOME_CONNECT_ANCHORS = new Map<string, THREE.Vector3>([
  [
    'mjcf-connect-left-plantar-rod-left-foot',
    new THREE.Vector3(-0.05961411, 0.12010489, 0.01804305),
  ],
  [
    'mjcf-connect-left-achilles-rod-left-heel-spring',
    new THREE.Vector3(-0.31870218, 0.12839077, 0.49499193),
  ],
  [
    'mjcf-connect-right-plantar-rod-right-foot',
    new THREE.Vector3(-0.05961411, -0.12010489, 0.01804305),
  ],
  [
    'mjcf-connect-right-achilles-rod-right-heel-spring',
    new THREE.Vector3(-0.31870215, -0.1283908, 0.49499192),
  ],
]);

function loadMyosuiteMjcfFiles(): RobotFile[] {
  if (myosuiteMjcfFilesCache) {
    return myosuiteMjcfFilesCache;
  }

  const files: RobotFile[] = [];
  const visitDirectory = (absoluteDirectory: string, relativeDirectory = ''): void => {
    fs.readdirSync(absoluteDirectory, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;

      if (entry.isDirectory()) {
        visitDirectory(absolutePath, relativePath);
        return;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.xml')) {
        return;
      }

      files.push({
        name: path.posix.join('myosuite-main', relativePath),
        format: 'mjcf',
        content: fs.readFileSync(absolutePath, 'utf8'),
      });
    });
  };

  visitDirectory(MYOSUITE_FIXTURE_ROOT);
  myosuiteMjcfFilesCache = files;
  return files;
}

function parseResolvedMyosuiteMjcf(relativePath: string) {
  const files = loadMyosuiteMjcfFiles();
  const fileName = path.posix.join('myosuite-main', relativePath);
  const file = files.find((candidate) => candidate.name === fileName);
  assert.ok(file, `expected MyoSuite fixture to exist: ${fileName}`);

  const resolved = resolveMJCFSource(file, files);
  assert.deepEqual(resolved.issues, []);

  const robot = parseMJCF(resolved.content);
  assert.ok(robot, `expected resolved MyoSuite MJCF to parse: ${fileName}`);
  return robot;
}

test('parseMJCFModel cache can be cleared explicitly', () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const xml = `
        <mujoco model="cache-clear-model">
          <worldbody>
            <body name="base_link">
              <geom type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
    `;

  const parsed = parseMJCFModel(xml);
  assert.ok(parsed);
  assert.equal(getParsedMJCFModelCacheSize(), 1);

  clearParsedMJCFModelCache(xml);
  assert.equal(getParsedMJCFModelCacheSize(), 0);
});

test('loadMJCFToThreeJS surfaces the MJCF parse failure reason', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const invalidXml = `
    <robot name="not-mjcf">
      <link name="base_link" />
    </robot>
  `;

  assert.equal(parseMJCFModel(invalidXml), null);
  assert.equal(getParsedMJCFModelError(invalidXml), 'No <mujoco> root element found.');

  await assert.rejects(
    () => loadMJCFToThreeJS(invalidXml, {}, ''),
    /Failed to parse MJCF model document: No <mujoco> root element found\./,
  );
});

test('parseMJCF releases parsed model cache after import completes', () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const robot = parseMJCF(`
        <mujoco model="parse-cache-release">
          <worldbody>
            <body name="base_link">
              <geom type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(getParsedMJCFModelCacheSize(), 0);
});

test('loadMJCFToThreeJS releases parsed model cache after scene construction', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const root = await loadMJCFToThreeJS(
    `
        <mujoco model="loader-cache-release">
          <worldbody>
            <body name="base_link">
              <geom type="box" size="0.1 0.1 0.1" />
            </body>
          </worldbody>
        </mujoco>
    `,
    {},
  );

  assert.ok(root);
  assert.equal(getParsedMJCFModelCacheSize(), 0);

  disposeTransientObject3D(root);
});

test('loadMJCFToThreeJS keeps top-level world plane geoms and applies builtin checker textures', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const originalConsoleError = console.error;
  const consoleErrors: string[] = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map((arg) => String(arg)).join(' '));
  };

  let root: THREE.Object3D | null = null as THREE.Object3D | null;
  try {
    root = await loadMJCFToThreeJS(
      `
        <mujoco model="scene-groundplane">
          <asset>
            <texture
              name="groundplane"
              type="2d"
              builtin="checker"
              rgb1="0.2 0.3 0.4"
              rgb2="0.1 0.2 0.3"
              mark="edge"
              markrgb="0.8 0.8 0.8"
              width="64"
              height="64"
            />
            <material name="groundplane" texture="groundplane" texrepeat="5 5" />
          </asset>
          <worldbody>
            <geom name="floor" type="plane" size="5 5 0.1" material="groundplane" />
            <body name="base_link">
              <geom name="body_box" type="box" size="0.1 0.1 0.1" rgba="0.8 0.2 0.2 1" />
            </body>
          </worldbody>
        </mujoco>
    `,
      {},
    );

    const floor = root.getObjectByName('floor');
    assert.ok(floor);
    assert.ok(root.getObjectByName('body_box'));
    assert.ok((root as THREE.Object3D & { links?: Record<string, THREE.Object3D> }).links?.world);

    let floorMaterial: THREE.Material | null = null as THREE.Material | null;
    floor?.traverse((child: any) => {
      if (!child?.isMesh || floorMaterial) {
        return;
      }

      floorMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
    });

    if (!(floorMaterial instanceof THREE.MeshStandardMaterial)) {
      throw new Error('Expected the floor to resolve to a MeshStandardMaterial.');
    }

    const floorTexture = floorMaterial.map;
    assert.ok(floorTexture instanceof THREE.Texture);
    const floorImage = floorTexture.image as { width?: number; height?: number };
    assert.equal(floorTexture.repeat.x, 5);
    assert.equal(floorTexture.repeat.y, 5);
    assert.equal(floorImage.width, 64);
    assert.equal(floorImage.height, 64);
    assert.equal(
      consoleErrors.some((message) => message.includes('missing texture definition')),
      false,
    );
  } finally {
    console.error = originalConsoleError;
    disposeTransientObject3D(root);
  }
});

test('loadMJCFToThreeJS preserves runtime joint parent-child metadata for implicit fixed MJCF bodies', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const root = await loadMJCFToThreeJS(
    `
        <mujoco model="runtime-joint-link-metadata">
          <worldbody>
            <body name="base_link">
              <body name="lower_leg">
                <joint name="knee_joint" type="hinge" axis="0 0 1" stiffness="1500" />
                <geom type="box" size="0.05 0.05 0.05" />
                <body name="tool_link" pos="0 0 0.1">
                  <geom type="box" size="0.02 0.02 0.02" />
                </body>
              </body>
            </body>
          </worldbody>
        </mujoco>
    `,
    {},
  );

  const joints =
    (root as THREE.Object3D & { joints?: Record<string, Record<string, unknown>> }).joints ?? {};

  assert.equal(joints.knee_joint?.parentLinkId, 'base_link');
  assert.equal(joints.knee_joint?.childLinkId, 'lower_leg');
  assert.equal((joints.knee_joint?.parentLink as { name?: string } | undefined)?.name, 'base_link');
  assert.equal((joints.knee_joint?.child as { name?: string } | undefined)?.name, 'lower_leg');
  assert.equal(
    (joints.knee_joint?.userData as { mjcfJointStiffness?: number } | undefined)
      ?.mjcfJointStiffness,
    1500,
  );
  assert.equal(
    (joints.knee_joint?.userData as { mjcfPassiveSpringJoint?: boolean } | undefined)
      ?.mjcfPassiveSpringJoint,
    true,
  );
  assert.equal(
    (joints.knee_joint?.userData as { mjcfHardPassiveSpringJoint?: boolean } | undefined)
      ?.mjcfHardPassiveSpringJoint,
    true,
  );

  assert.ok(joints.lower_leg_to_tool_link);
  assert.equal(joints.lower_leg_to_tool_link?.jointType, 'fixed');
  assert.equal(joints.lower_leg_to_tool_link?.parentLinkId, 'lower_leg');
  assert.equal(joints.lower_leg_to_tool_link?.childLinkId, 'tool_link');
  assert.equal(
    (joints.lower_leg_to_tool_link?.parentLink as { name?: string } | undefined)?.name,
    'lower_leg',
  );
  assert.equal(
    (joints.lower_leg_to_tool_link?.child as { name?: string } | undefined)?.name,
    'tool_link',
  );

  disposeTransientObject3D(root);
});

test('loadMJCFToThreeJS exposes MJCF tendon visualization metadata on the runtime root', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const root = await loadMJCFToThreeJS(
    `
        <mujoco model="runtime-tendon-visualization">
          <worldbody>
            <body name="base_link">
              <site name="site_a" pos="0 0 0" rgba="1 0 0 1" />
              <site name="site_b" pos="0 0 0.2" rgba="1 0 0 1" />
            </body>
          </worldbody>
          <tendon>
            <spatial name="guide" rgba="1 0 0 1">
              <site site="site_a" />
              <site site="site_b" />
            </spatial>
          </tendon>
        </mujoco>
    `,
    {},
  );

  assert.deepEqual(root.userData.__mjcfTendonsData, [
    {
      name: 'guide',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'site_b'],
      attachments: [
        { type: 'site', ref: 'site_a' },
        { type: 'site', ref: 'site_b' },
      ],
    },
  ]);

  disposeTransientObject3D(root);
});

test('loadMJCFToThreeJS keeps flybody-style wing helpers out of the visible runtime scene', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const root = await loadMJCFToThreeJS(
    `
        <mujoco model="runtime-wing-helper-filtering">
          <asset>
            <material name="brown" rgba="0.202 0.0782 0.0262 1" />
            <material name="membrane" rgba="0.539 0.686 0.8 0.4" />
            <material name="blue" rgba="0.2 0.3 1 1" />
          </asset>
          <worldbody>
            <body name="wing_right">
              <geom name="wing_right_brown" type="box" size="0.03 0.003 0.12" group="1" contype="0" conaffinity="0" material="brown" />
              <geom name="wing_right_brown_collision" type="ellipsoid" size="0.002 0.018 0.114" group="4" contype="1" conaffinity="1" material="blue" />
              <geom name="wing_right_membrane" type="box" size="0.08 0.001 0.12" group="1" contype="0" conaffinity="0" material="membrane" />
              <geom name="wing_right_membrane_collision" type="ellipsoid" size="0.001 0.035 0.114" group="5" contype="1" conaffinity="1" material="blue" />
              <geom name="wing_right_fluid" type="ellipsoid" size="0.0005 0.055 0.114" group="3" contype="0" conaffinity="0" material="brown" />
              <geom name="wing_right_inertial" type="box" size="0.0005 0.055 0.114" group="1" contype="0" conaffinity="0" material="brown" />
            </body>
          </worldbody>
        </mujoco>
    `,
    {},
  );

  const membrane = root.getObjectByName('wing_right_membrane');
  assert.ok(membrane);
  let membraneMaterial: THREE.Material | null = null as THREE.Material | null;
  membrane.traverse((node: any) => {
    if (membraneMaterial || !node?.isMesh) {
      return;
    }
    membraneMaterial = Array.isArray(node.material) ? node.material[0] : node.material;
  });

  assert.ok(membraneMaterial instanceof THREE.MeshStandardMaterial);
  assert.equal(`#${membraneMaterial.color.getHexString()}`, '#89afcc');
  assert.ok(Math.abs(membraneMaterial.opacity - 0.4) < 1e-6);
  assert.equal(membraneMaterial.transparent, true);
  assert.equal(root.getObjectByName('wing_right_fluid'), undefined);
  assert.equal(root.getObjectByName('wing_right_inertial'), undefined);

  const membraneCollision = root.getObjectByName('wing_right_membrane_collision');
  assert.ok(membraneCollision);
  assert.equal(membraneCollision.userData.isCollisionGroup, true);
  assert.equal(membraneCollision.visible, false);

  disposeTransientObject3D(root);
});

test('MJCF spatial tendon visualization keeps geom wrap refs and preserves sidesite metadata', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const xml = `
        <mujoco model="runtime-tendon-geom-sidesite">
          <worldbody>
            <body name="base_link">
              <site name="origin_site" pos="0 0 0" rgba="1 0 0 1" />
              <site name="wrap_sidesite" pos="0 0.05 0" rgba="1 0 0 1" />
              <geom name="wrap_geom" type="sphere" size="0.01" />
              <site name="insert_site" pos="0 0.1 0" rgba="1 0 0 1" />
            </body>
          </worldbody>
          <tendon>
            <spatial name="wrapped_path" rgba="1 0 0 1">
              <site site="origin_site" />
              <geom geom="wrap_geom" sidesite="wrap_sidesite" />
              <site site="insert_site" />
            </spatial>
          </tendon>
        </mujoco>
    `;

  const robot = parseMJCF(xml);
  assert.ok(robot);
  assert.deepEqual(robot.inspectionContext?.mjcf?.tendons[0]?.attachmentRefs, [
    'origin_site',
    'wrap_geom',
    'insert_site',
  ]);
  assert.deepEqual(robot.inspectionContext?.mjcf?.tendons[0]?.attachments, [
    { type: 'site', ref: 'origin_site', sidesite: undefined, divisor: undefined, coef: undefined },
    {
      type: 'geom',
      ref: 'wrap_geom',
      sidesite: 'wrap_sidesite',
      divisor: undefined,
      coef: undefined,
    },
    { type: 'site', ref: 'insert_site', sidesite: undefined, divisor: undefined, coef: undefined },
  ]);

  const root = await loadMJCFToThreeJS(xml, {});
  assert.deepEqual(root.userData.__mjcfTendonsData, [
    {
      name: 'wrapped_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['origin_site', 'wrap_geom', 'insert_site'],
      attachments: [
        { type: 'site', ref: 'origin_site' },
        {
          type: 'geom',
          ref: 'wrap_geom',
          sidesite: 'wrap_sidesite',
        },
        { type: 'site', ref: 'insert_site' },
      ],
    },
  ]);

  disposeTransientObject3D(root);
});

test('loadMJCFToThreeJS reports ready before deferred textures finish and applies textures asynchronously', async (t) => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const originalLoadAsync = THREE.TextureLoader.prototype.loadAsync;
  let resolveTexture: ((texture: THREE.Texture<HTMLImageElement>) => void) | undefined;

  THREE.TextureLoader.prototype.loadAsync = async function mockLoadAsync(
    _url: string,
    _onProgress?: (event: ProgressEvent<EventTarget>) => void,
  ): Promise<THREE.Texture<HTMLImageElement>> {
    return await new Promise<THREE.Texture<HTMLImageElement>>((resolve) => {
      resolveTexture = resolve;
    });
  };

  t.after(() => {
    THREE.TextureLoader.prototype.loadAsync = originalLoadAsync;
  });

  const progressPhases: string[] = [];
  let asyncSceneMutationCount = 0;
  const loadPromise = loadMJCFToThreeJS(
    `
        <mujoco model="strict-texture-ready">
          <asset>
            <texture name="carbon" file="assets/carbon.png" type="2d" />
            <material name="carbon_fibre" texture="carbon" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="box" size="0.1 0.1 0.1" material="carbon_fibre" />
            </body>
          </worldbody>
        </mujoco>
    `,
    {
      'assets/carbon.png': 'mock://assets/carbon.png',
    },
    '',
    (progress) => {
      progressPhases.push(progress.phase);
    },
    {
      onAsyncSceneMutation: () => {
        asyncSceneMutationCount += 1;
      },
    },
  );

  const root = await Promise.race([
    loadPromise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('MJCF loader did not become ready in time')), 200);
    }),
  ]);

  assert.ok(root);
  assert.ok(progressPhases.includes('finalizing-scene'));
  assert.equal(progressPhases.at(-1), 'ready');
  assert.equal(asyncSceneMutationCount, 0);

  const hasMappedTexture = () => {
    let mapped = false;
    root.traverse((node: any) => {
      if (mapped || !node?.isMesh) {
        return;
      }
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      mapped = materials.some(
        (material: (THREE.Material & { map?: THREE.Texture | null }) | null | undefined) =>
          (material?.map ?? null) !== null,
      );
    });
    return mapped;
  };
  assert.equal(hasMappedTexture(), false);

  const resolvedTexture = new THREE.Texture() as THREE.Texture<HTMLImageElement>;
  resolvedTexture.needsUpdate = true;
  assert.ok(resolveTexture);
  resolveTexture(resolvedTexture);

  await waitForCondition(() => asyncSceneMutationCount > 0);
  await waitForCondition(hasMappedTexture);

  disposeTransientObject3D(root);
});

test('loadMJCFToThreeJS rejects missing mesh assets instead of creating placeholders', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  await assert.rejects(
    loadMJCFToThreeJS(
      `
            <mujoco model="missing-mesh">
              <asset>
                <mesh name="base_mesh" file="meshes/missing.stl" />
              </asset>
              <worldbody>
                <body name="base_link">
                  <geom type="mesh" mesh="base_mesh" />
                </body>
              </worldbody>
            </mujoco>
        `,
      {},
    ),
    /Mesh file could not be resolved: meshes\/missing\.stl/,
  );

  assert.equal(getParsedMJCFModelCacheSize(), 0);
});

test('loadMJCFToThreeJS renders inline vertex mesh assets without external files', async () => {
  installDomGlobals();
  clearParsedMJCFModelCache();

  const root = await loadMJCFToThreeJS(
    `
        <mujoco model="inline-mesh-runtime">
          <asset>
            <mesh
              name="pyramid"
              vertex="0 6 0  0 -6 0  0.5 6 0  0.5 -6 0  0.5 6 0.5  0.5 -6 0.5"
            />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="pyramid" />
            </body>
          </worldbody>
        </mujoco>
    `,
    {},
  );

  const inlineMesh = root.getObjectByProperty('isMesh', true);
  assert.ok(inlineMesh instanceof THREE.Mesh);
  assert.ok(inlineMesh.geometry instanceof THREE.BufferGeometry);
  assert.ok(inlineMesh.geometry.getAttribute('position')?.count > 0);

  const parsedRobot = parseMJCF(`
        <mujoco model="inline-mesh-robot">
          <asset>
            <mesh
              name="pyramid"
              vertex="0 6 0  0 -6 0  0.5 6 0  0.5 -6 0  0.5 6 0.5  0.5 -6 0.5"
            />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="pyramid" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.equal(parsedRobot.links.base_link.visual.type, GeometryType.MESH);
  assert.equal(parsedRobot.links.base_link.visual.meshPath, undefined);
  assert.equal(parsedRobot.links.base_link.visual.assetRef, 'pyramid');
  assert.deepEqual(parsedRobot.links.base_link.visual.mjcfMesh, {
    name: 'pyramid',
    vertices: [0, 6, 0, 0, -6, 0, 0.5, 6, 0, 0.5, -6, 0, 0.5, 6, 0.5, 0.5, -6, 0.5],
  });

  disposeTransientObject3D(root);
});

test('parseMJCF preserves equality connect constraints as closed-loop metadata', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="connect-test">
          <worldbody>
            <body name="base">
              <body name="link_a" pos="1 0 0">
                <joint name="joint_a" type="hinge" />
              </body>
              <body name="link_b" pos="1.2 0 0">
                <joint name="joint_b" type="hinge" />
              </body>
            </body>
          </worldbody>
          <equality>
            <connect body1="link_a" body2="link_b" anchor="0.2 0 0" />
          </equality>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.closedLoopConstraints?.length, 1);

  const [constraint] = robot.closedLoopConstraints ?? [];
  assert.ok(constraint);
  assert.equal(constraint.type, 'connect');
  assert.equal(constraint.linkAId, 'link_a');
  assert.equal(constraint.linkBId, 'link_b');
  assert.deepEqual(constraint.anchorLocalA, { x: 0.2, y: 0, z: 0 });
  assert.deepEqual(constraint.anchorLocalB, { x: 0, y: 0, z: 0 });
  assert.deepEqual(constraint.anchorWorld, { x: 1.2, y: 0, z: 0 });
  assert.deepEqual(constraint.source, {
    format: 'mjcf',
    body1Name: 'link_a',
    body2Name: 'link_b',
  });
});

test('parseMJCF re-bases equality connect anchors when the MJCF joint pivot is offset inside the body frame', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="offset-connect-constraint">
          <compiler angle="radian" autolimits="true" />
          <worldbody>
            <body name="base">
              <body name="link_a">
                <joint name="joint_a" type="hinge" pos="1 0 0" axis="0 0 1" />
              </body>
              <body name="link_b" pos="1 2 0">
                <joint name="joint_b" type="hinge" axis="0 0 1" />
              </body>
            </body>
          </worldbody>
          <equality>
            <connect body1="link_a" body2="link_b" anchor="1 1 0" />
          </equality>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.closedLoopConstraints?.length, 1);

  const [constraint] = robot.closedLoopConstraints ?? [];
  assert.ok(constraint);
  assert.equal(constraint.type, 'connect');
  assert.deepEqual(constraint.anchorLocalA, { x: 0, y: 1, z: 0 });
  assert.deepEqual(constraint.anchorLocalB, { x: 0, y: -1, z: 0 });
  assert.deepEqual(constraint.anchorWorld, { x: 1, y: 1, z: 0 });

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const anchorWorldA = new THREE.Vector3(
    constraint.anchorLocalA.x,
    constraint.anchorLocalA.y,
    constraint.anchorLocalA.z,
  ).applyMatrix4(linkWorldMatrices[constraint.linkAId]);
  const anchorWorldB = new THREE.Vector3(
    constraint.anchorLocalB.x,
    constraint.anchorLocalB.y,
    constraint.anchorLocalB.z,
  ).applyMatrix4(linkWorldMatrices[constraint.linkBId]);

  assert.ok(anchorWorldA.distanceTo(anchorWorldB) <= 1e-9);
});

test('parseMJCF promotes fixed-range two-site spatial tendons to distance closed-loop metadata', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="distance-tendon-constraint">
          <compiler angle="radian" autolimits="true" />
          <worldbody>
            <body name="base">
              <body name="link_a">
                <joint name="joint_a" type="hinge" axis="0 0 1" />
                <site name="tip_a" pos="1 0 0" />
              </body>
              <body name="link_b">
                <joint name="joint_b" type="hinge" axis="0 0 1" />
                <site name="tip_b" pos="1 0 0" />
              </body>
            </body>
          </worldbody>
          <tendon>
            <spatial name="closing_bar" range="0 0.000001">
              <site site="tip_a" />
              <site site="tip_b" />
            </spatial>
          </tendon>
        </mujoco>
    `);

  assert.ok(robot.closedLoopConstraints);
  assert.equal(robot.closedLoopConstraints?.length, 1);

  const [constraint] = robot.closedLoopConstraints ?? [];
  assert.ok(constraint);
  assert.equal(constraint.type, 'distance');
  assert.equal(constraint.linkAId, 'link_a');
  assert.equal(constraint.linkBId, 'link_b');
  assert.deepEqual(constraint.anchorLocalA, { x: 1, y: 0, z: 0 });
  assert.deepEqual(constraint.anchorLocalB, { x: 1, y: 0, z: 0 });
  assert.ok(Math.abs(((constraint as { restDistance?: number }).restDistance ?? 0) - 0) <= 1e-9);
  assert.deepEqual(constraint.source, {
    format: 'mjcf',
    body1Name: 'link_a',
    body2Name: 'link_b',
  });
});

test('parseMJCF re-bases spatial tendon anchors when the MJCF joint pivot is offset inside the body frame', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="offset-site-tendon">
          <compiler angle="radian" autolimits="true" />
          <worldbody>
            <body name="base">
              <body name="link_a">
                <joint name="joint_a" type="hinge" pos="1 0 0" axis="0 0 1" />
                <site name="tip_a" pos="1 1 0" />
              </body>
              <body name="link_b" pos="0 2 0">
                <joint name="joint_b" type="hinge" pos="1 0 0" axis="0 0 1" />
                <site name="tip_b" pos="1 -1 0" />
              </body>
            </body>
          </worldbody>
          <tendon>
            <spatial name="closing_bar" range="0 0.000001">
              <site site="tip_a" />
              <site site="tip_b" />
            </spatial>
          </tendon>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.closedLoopConstraints?.length, 1);

  const [constraint] = robot.closedLoopConstraints ?? [];
  assert.ok(constraint);
  assert.equal(constraint.type, 'distance');
  if (constraint.type !== 'distance') {
    assert.fail('expected a distance constraint');
  }

  assert.deepEqual(constraint.anchorLocalA, { x: 0, y: 1, z: 0 });
  assert.deepEqual(constraint.anchorLocalB, { x: 0, y: -1, z: 0 });
  assert.deepEqual(constraint.anchorWorld, { x: 1, y: 1, z: 0 });

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const anchorWorldA = new THREE.Vector3(
    constraint.anchorLocalA.x,
    constraint.anchorLocalA.y,
    constraint.anchorLocalA.z,
  ).applyMatrix4(linkWorldMatrices[constraint.linkAId]);
  const anchorWorldB = new THREE.Vector3(
    constraint.anchorLocalB.x,
    constraint.anchorLocalB.y,
    constraint.anchorLocalB.z,
  ).applyMatrix4(linkWorldMatrices[constraint.linkBId]);

  assert.ok(anchorWorldA.distanceTo(anchorWorldB) <= 1e-9);
});

test('parseMJCF maps fixed-length two-site spatial tendons to distance closed-loop metadata', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="spatial-tendon-loop">
          <worldbody>
            <body name="base">
              <body name="left_link">
                <joint name="left_joint" type="slide" axis="1 0 0" />
                <site name="left_site" pos="0 0 0" />
              </body>
              <body name="right_link" pos="0.4 0 0">
                <joint name="right_joint" type="slide" axis="1 0 0" />
                <site name="right_site" pos="0 0 0" />
              </body>
            </body>
          </worldbody>
          <tendon>
            <spatial range="0.4 0.400001">
              <site site="left_site" />
              <site site="right_site" />
            </spatial>
          </tendon>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.closedLoopConstraints?.length, 1);

  const [constraint] = robot.closedLoopConstraints ?? [];
  assert.ok(constraint);
  assert.equal(constraint.type, 'distance');
  if (constraint.type !== 'distance') {
    assert.fail('expected a distance constraint');
  }

  assert.equal(constraint.linkAId, 'left_link');
  assert.equal(constraint.linkBId, 'right_link');
  assert.equal(constraint.restDistance, 0.4);
  assert.deepEqual(constraint.anchorLocalA, { x: 0, y: 0, z: 0 });
  assert.deepEqual(constraint.anchorLocalB, { x: 0, y: 0, z: 0 });
  assert.deepEqual(constraint.anchorWorld, { x: 0, y: 0, z: 0 });
  assert.deepEqual(constraint.source, {
    format: 'mjcf',
    body1Name: 'left_link',
    body2Name: 'right_link',
  });
});

test('parseMJCF maps linear equality joint constraints to ref-aware mimic metadata', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="joint-equality-mimic">
          <compiler angle="radian" />
          <worldbody>
            <body name="base">
              <body name="leader_link">
                <joint name="leader_joint" type="hinge" ref="0.2" />
              </body>
              <body name="follower_link">
                <joint name="follower_joint" type="hinge" ref="-0.3" />
              </body>
            </body>
          </worldbody>
          <equality>
            <joint joint1="follower_joint" joint2="leader_joint" polycoef="0.1 2 0 0 0" />
          </equality>
        </mujoco>
    `);

  assert.ok(robot);
  assert.deepEqual(robot.joints.follower_joint?.mimic, {
    joint: 'leader_joint',
    multiplier: 2,
    offset: -0.6,
  });
});

test('parseMJCF keeps base-link collision boxes out of duplicated visuals', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="base-collision-pairing">
          <asset>
            <mesh name="base_mesh" file="base.stl" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="base_mesh" group="1" contype="0" conaffinity="0" />
              <geom type="box" size="0.1 0.2 0.3" pos="0 0 0.4" />
              <geom type="box" size="0.05 0.06 0.07" pos="0.2 0 0" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.ok(robot.links.base_link);
  assert.equal(robot.links.base_link.visual.type, 'mesh');
  assert.equal(robot.links.base_link.collision.type, 'box');
  assert.deepEqual(robot.links.base_link.collision.origin?.xyz, { x: 0, y: 0, z: 0.4 });
  assert.equal(robot.links.base_link.collisionBodies?.length, 1);
  assert.equal(robot.links.base_link.collisionBodies?.[0]?.type, 'box');
  assert.deepEqual(robot.links.base_link.collisionBodies?.[0]?.origin?.xyz, { x: 0.2, y: 0, z: 0 });
  assert.equal(robot.links.base_link_geom_1, undefined);
});

test('parseMJCF keeps extra visual geoms on the source link while preserving generated names', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="interleaved-visual-collision-geoms">
          <asset>
            <mesh name="base_panel" file="base_panel.obj" />
            <mesh name="top_shell" file="top_shell.obj" />
          </asset>
          <worldbody>
            <body name="base">
              <geom type="mesh" mesh="base_panel" group="2" contype="0" conaffinity="0" />
              <geom type="box" size="0.1 0.2 0.3" group="3" />
              <geom type="mesh" mesh="top_shell" group="2" contype="0" conaffinity="0" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base.collision.name, 'base_geom_1');
  assert.equal(robot.links.base_geom_1, undefined);
  assert.equal(robot.links.base_geom_2, undefined);
  assert.equal(robot.links.base.visualBodies?.[0]?.name, 'base_geom_2');
  assert.equal(robot.links.base.visualBodies?.[0]?.meshPath, 'top_shell.obj');
});

test('parseMJCF keeps ANYmal extra base visual on visualBodies without shadowing collision names', () => {
  installDomGlobals();

  const robot = parseMJCF(
    fs.readFileSync(
      path.resolve('test/mujoco_menagerie-main/anybotics_anymal_c/anymal_c.xml'),
      'utf8',
    ),
  );

  assert.ok(robot);
  assert.equal(robot.links.base.collision.name, 'base_geom_6');
  assert.equal(robot.links.base_geom_6, undefined);
  assert.equal(robot.links.base_geom_11, undefined);
  const topShell = robot.links.base.visualBodies?.find((visual) => visual.name === 'base_geom_11');
  assert.ok(topShell);
  assert.equal(topShell.meshPath, 'assets/top_shell.obj');
  assert.equal(topShell.authoredMaterials?.[0]?.texture, 'assets/top_shell.png');
});

test('parseMJCF keeps flybody wing inertial and fluid helper geoms out of exportable visuals and collisions', () => {
  installDomGlobals();

  const robot = parseMJCF(
    fs.readFileSync(path.resolve('test/mujoco_menagerie-main/flybody/fruitfly.xml'), 'utf8'),
  );

  assert.ok(robot);
  for (const side of ['left', 'right']) {
    const wing = robot.links[`wing_${side}`];
    assert.ok(wing);
    assert.equal(wing.visual.name, `wing_${side}_brown`);
    assert.equal(wing.visual.meshPath, `assets/wing_${side}_brown.obj`);
    assert.equal(robot.links[`wing_${side}_geom_1`], undefined);
    assert.equal(robot.links[`wing_${side}_geom_2`], undefined);
    assert.equal(wing.visualBodies?.[0]?.name, `wing_${side}_membrane`);
    assert.equal(wing.visualBodies?.[0]?.meshPath, `assets/wing_${side}_membrane.obj`);
    assert.equal(wing.visualBodies?.[0]?.authoredMaterials?.[0]?.color, '#89afcc66');
    assert.ok(
      Math.abs((wing.visualBodies?.[0]?.authoredMaterials?.[0]?.roughness ?? 0) - 0.093) < 1e-9,
    );
    assert.equal(
      wing.collisionBodies?.some((collision) => collision.name === `wing_${side}_fluid`),
      false,
    );
    assert.equal(
      Object.values(robot.links).some((link) => link.visual.name === `wing_${side}_inertial`),
      false,
    );
  }
});

test('parseMJCF preserves explicit and default-inherited cylinder collision geoms', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="cylinder-collision-preservation">
          <default>
            <default class="collision">
              <geom type="cylinder" group="3" contype="1" conaffinity="1" />
            </default>
          </default>
          <worldbody>
            <body name="base_link">
              <geom
                name="explicit_cylinder"
                type="cylinder"
                class="collision"
                size="0.05 0.3"
                pos="0.1 0 0"
                quat="1 1 0 0"
              />
              <geom
                name="default_cylinder"
                class="collision"
                size="0.07 0.4"
                pos="-0.1 0 0"
              />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.collision.type, GeometryType.CYLINDER);
  assert.equal(robot.links.base_link.collision.name, 'explicit_cylinder');
  assert.deepEqual(robot.links.base_link.collision.dimensions, { x: 0.05, y: 0.6, z: 0 });
  assert.equal(robot.links.base_link.collisionBodies?.length, 1);
  assert.equal(robot.links.base_link.collisionBodies?.[0]?.type, GeometryType.CYLINDER);
  assert.equal(robot.links.base_link.collisionBodies?.[0]?.name, 'default_cylinder');
  assert.deepEqual(robot.links.base_link.collisionBodies?.[0]?.dimensions, {
    x: 0.07,
    y: 0.8,
    z: 0,
  });
});

test('parseMJCF preserves mesh-backed primitive collision geoms as mesh geometry when primitive parameters are unresolved', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="mesh-backed-collision-fallback">
          <default>
            <default class="collision">
              <geom type="capsule" />
            </default>
          </default>
          <asset>
            <mesh name="link_mesh" file="link.obj" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom mesh="link_mesh" class="collision" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.collision.type, GeometryType.MESH);
  assert.equal(robot.links.base_link.collision.meshPath, 'link.obj');
  assert.deepEqual(robot.links.base_link.collision.dimensions, { x: 1, y: 1, z: 1 });
});

test('parseMJCF preserves root free joint transforms as floating joint origins', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="free-root">
          <worldbody>
            <body name="base_link" pos="0 0 0.5">
              <joint name="floating_base_joint" type="free" limited="false" />
              <body name="child_link" pos="0 0.1 0.2">
                <joint name="child_joint" type="hinge" axis="0 1 0" />
              </body>
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.rootLinkId, 'world');
  assert.deepEqual(robot.joints.floating_base_joint?.origin?.xyz, { x: 0, y: 0, z: 0.5 });
  assert.deepEqual(robot.joints.floating_base_joint?.origin?.rpy, { r: 0, p: 0, y: 0 });
  assert.deepEqual(robot.joints.child_joint?.origin?.xyz, { x: 0, y: 0.1, z: 0.2 });
});

test('parseMJCF applies joint ref as the imported initial joint value', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="joint-ref-defaults">
          <worldbody>
            <body name="base_link">
              <body name="knee_link">
                <joint name="knee_joint" type="hinge" ref="-45" range="-90 90" />
              </body>
              <body name="slider_link" pos="0 0 0.1">
                <joint name="slider_joint" type="slide" ref="0.12" range="-1 1" />
              </body>
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.ok(Math.abs((robot.joints.knee_joint?.angle ?? 0) + Math.PI / 4) < 1e-9);
  assert.ok(Math.abs((robot.joints.knee_joint?.referencePosition ?? 0) + Math.PI / 4) < 1e-9);
  assert.equal(robot.joints.slider_joint?.angle, 0.12);
  assert.equal(robot.joints.slider_joint?.referencePosition, 0.12);

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const kneeWorldQuaternion = new THREE.Quaternion();
  const kneeWorldPosition = new THREE.Vector3();
  linkWorldMatrices.knee_link?.decompose(
    kneeWorldPosition,
    kneeWorldQuaternion,
    new THREE.Vector3(),
  );
  assert.ok(kneeWorldQuaternion.angleTo(new THREE.Quaternion()) <= 1e-9);

  const sliderWorldQuaternion = new THREE.Quaternion();
  const sliderWorldPosition = new THREE.Vector3();
  linkWorldMatrices.slider_link?.decompose(
    sliderWorldPosition,
    sliderWorldQuaternion,
    new THREE.Vector3(),
  );
  assert.ok(sliderWorldQuaternion.angleTo(new THREE.Quaternion()) <= 1e-9);
  assert.ok(sliderWorldPosition.distanceTo(new THREE.Vector3(0, 0, 0.1)) <= 1e-9);
});

test('parseMJCF preserves compiler eulerseq when importing body rotations', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="eulerseq-rotation">
          <compiler angle="radian" eulerseq="zyx" />
          <worldbody>
            <body name="base_link">
              <body name="wrist_link" euler="0.3 0.7 1.1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const wristWorldQuaternion = new THREE.Quaternion();
  linkWorldMatrices.wrist_link?.decompose(
    new THREE.Vector3(),
    wristWorldQuaternion,
    new THREE.Vector3(),
  );

  const expectedQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(1.1, 0.7, 0.3, 'ZYX'),
  );

  assert.ok(wristWorldQuaternion.angleTo(expectedQuaternion) < 1e-9);
});

test('parseMJCF applies the home keyframe qpos as the imported initial pose', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="keyframe-pose">
          <compiler angle="degree" />
          <worldbody>
            <body name="base_link">
              <freejoint name="root_free" />
              <body name="ball_link">
                <joint name="ball_joint" type="ball" />
                <body name="hinge_link">
                  <joint name="hinge_joint" type="hinge" ref="10" range="-90 90" />
                  <body name="slide_link">
                    <joint name="slide_joint" type="slide" ref="0.1" range="-1 1" />
                  </body>
                </body>
              </body>
            </body>
          </worldbody>
          <keyframe>
            <key name="stand" qpos="0 0 0 1 0 0 0 1 0 0 0 0 0" />
            <key name="home" qpos="1 2 3 0.7071067811865476 0 0.7071067811865475 0 0.9238795325112867 0 0 0.3826834323650898 0.7853981633974483 0.25" />
          </keyframe>
        </mujoco>
    `);

  assert.ok(robot);
  assert.deepEqual(robot.joints.root_free?.origin.xyz, { x: 1, y: 2, z: 3 });
  assert.ok(Math.abs((robot.joints.hinge_joint?.referencePosition ?? 0) - Math.PI / 18) < 1e-9);
  assert.ok(Math.abs((robot.joints.hinge_joint?.angle ?? 0) - Math.PI / 4) < 1e-9);
  assert.equal(robot.joints.slide_joint?.referencePosition, 0.1);
  assert.equal(robot.joints.slide_joint?.angle, 0.25);
  assert.ok(Math.abs((robot.joints.ball_joint?.quaternion?.w ?? 0) - 0.9238795325112867) < 1e-9);
  assert.ok(Math.abs((robot.joints.ball_joint?.quaternion?.z ?? 0) - 0.3826834323650898) < 1e-9);

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const baseWorldQuaternion = new THREE.Quaternion();
  const baseWorldPosition = new THREE.Vector3();
  linkWorldMatrices.base_link?.decompose(
    baseWorldPosition,
    baseWorldQuaternion,
    new THREE.Vector3(),
  );
  assert.deepEqual(baseWorldPosition.toArray(), [1, 2, 3]);
  assert.ok(
    baseWorldQuaternion.angleTo(
      new THREE.Quaternion(0, 0.7071067811865475, 0, 0.7071067811865476),
    ) < 1e-9,
  );
});

test('parseMJCF applies Cassie home keyframe qpos and solves passive closed-loop leg joints', () => {
  installDomGlobals();

  const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
  const robot = parseMJCF(xml);

  assert.ok(robot);
  assert.ok(Math.abs((robot.joints['left-hip-pitch']?.angle ?? 0) - 0.497301) < 1e-9);
  assert.ok(Math.abs((robot.joints['left-knee']?.angle ?? 0) + 1.1997) < 1e-9);
  assert.ok(Math.abs((robot.joints['left-foot']?.angle ?? 0) + 1.59681) < 1e-9);
  assert.ok(Math.abs((robot.joints['right-foot']?.angle ?? 0) + 1.59681) < 1e-9);
  assert.equal(robot.joints['left-shin']?.dynamics.stiffness, 1500);
  assert.equal(robot.joints['right-shin']?.dynamics.stiffness, 1500);
  assert.equal(robot.joints['left-heel-spring']?.dynamics.stiffness, 1250);

  assert.ok(Math.abs((robot.joints['left-tarsus']?.angle ?? 0) - 1.4250551414265926) < 1e-9);
  assert.ok(Math.abs((robot.joints['left-foot-crank']?.angle ?? 0) + 1.4888223188309895) < 1e-9);
  assert.ok(Math.abs((robot.joints['left-plantar-rod']?.angle ?? 0) - 1.470421577023918) < 1e-9);
  assert.ok(Math.abs((robot.joints['left-heel-spring']?.angle ?? 0) + 0.0015298326074860882) < 1e-9);
  assert.ok(
    Math.abs((robot.joints['right-tarsus']?.angle ?? 0) - 1.42505450519475) < 1e-9,
  );
  assert.ok(
    Math.abs((robot.joints['right-foot-crank']?.angle ?? 0) + 1.4888223188241143) < 1e-9,
  );
  assert.ok(
    Math.abs((robot.joints['right-plantar-rod']?.angle ?? 0) - 1.4704215770168598) < 1e-9,
  );
  assert.ok(
    Math.abs((robot.joints['right-heel-spring']?.angle ?? 0) + 0.0015281140578806555) < 1e-9,
  );
  assert.ok(
    Math.abs((robot.joints['right-achilles-rod']?.quaternion?.w ?? 0) - 0.9786415639566073) <
      1e-9,
  );
  assert.ok(
    Math.abs((robot.joints['right-achilles-rod']?.quaternion?.y ?? 0) + 0.014423187695796426) <
      1e-9,
  );
});

test('parseMJCF solves Cassie home keyframe closed-loop constraints on import', () => {
  installDomGlobals();

  const xml = fs.readFileSync('test/mujoco_menagerie-main/agility_cassie/cassie.xml', 'utf8');
  const robot = parseMJCF(xml);

  assert.ok(robot);
  assert.ok(robot.closedLoopConstraints);

  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  assert.equal(robot.closedLoopConstraints.length, CASSIE_MUJOCO_HOME_CONNECT_ANCHORS.size);
  robot.closedLoopConstraints.forEach((constraint) => {
    const anchorA = new THREE.Vector3(
      constraint.anchorLocalA.x,
      constraint.anchorLocalA.y,
      constraint.anchorLocalA.z,
    ).applyMatrix4(linkWorldMatrices[constraint.linkAId]);
    const anchorB = new THREE.Vector3(
      constraint.anchorLocalB.x,
      constraint.anchorLocalB.y,
      constraint.anchorLocalB.z,
    ).applyMatrix4(linkWorldMatrices[constraint.linkBId]);

    assert.ok(
      anchorA.distanceTo(
        new THREE.Vector3(
          constraint.anchorWorld.x,
          constraint.anchorWorld.y,
          constraint.anchorWorld.z,
        ),
      ) < 1e-6,
      `expected ${constraint.id} anchorWorld to match the solved import pose`,
    );
    assert.ok(
      anchorA.distanceTo(anchorB) < 1e-6,
      `expected ${constraint.id} to be closed after import`,
    );

    const mujocoHomeAnchor = CASSIE_MUJOCO_HOME_CONNECT_ANCHORS.get(constraint.id);
    assert.ok(mujocoHomeAnchor, `expected MuJoCo home anchor truth for ${constraint.id}`);
    assert.ok(
      anchorA.distanceTo(mujocoHomeAnchor) < CASSIE_MUJOCO_HOME_CONNECT_ANCHOR_TOLERANCE,
      `expected ${constraint.id} to stay within MuJoCo home display anchor tolerance`,
    );
  });
});

test('parseMJCF folds non-zero joint anchors into the imported joint origin instead of scattering the child link frame', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="joint-anchor-offset">
          <worldbody>
            <body name="base_link" pos="1 0 0" quat="0.70710678 0 0 0.70710678">
              <joint name="base_joint" type="hinge" pos="1 0 0" axis="0 0 1" />
              <geom type="box" size="0.1 0.1 0.1" pos="1 0 0" />
              <inertial mass="1" pos="1 0 0" diaginertia="1 1 1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);

  const jointOrigin = robot.joints.base_joint?.origin?.xyz;
  assert.ok(jointOrigin);
  assert.ok(Math.abs(jointOrigin.x - 1) < 1e-6);
  assert.ok(Math.abs(jointOrigin.y - 1) < 1e-6);
  assert.ok(Math.abs(jointOrigin.z - 0) < 1e-6);

  assert.deepEqual(robot.links.base_link.visual.origin?.xyz, { x: 0, y: 0, z: 0 });
  assert.deepEqual(robot.links.base_link.inertial?.origin?.xyz, { x: 0, y: 0, z: 0 });
});

test('parseMJCF syncs visual colors into robot materials state', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="material-sync">
          <asset>
            <material name="gray_mat" rgba="0.59 0.59 0.59 1" />
            <mesh name="base_mesh" file="base.stl" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="base_mesh" material="gray_mat" group="1" contype="0" conaffinity="0" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#969696');
  assert.equal(robot.materials?.base_link?.color, '#969696');
});

test('parseMJCF preserves visual material alpha as exact colorRgba metadata', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="transparent-material-sync">
          <asset>
            <material name="clear_mat" rgba="0.1 0.2 0.3 0.4" />
            <mesh name="base_mesh" file="base.stl" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="base_mesh" material="clear_mat" group="1" contype="0" conaffinity="0" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#1a334d66');
  assert.deepEqual(
    robot.links.base_link.visual.authoredMaterials?.[0]?.colorRgba,
    [0.1, 0.2, 0.3, 0.4],
  );
  assert.deepEqual(robot.materials?.base_link?.colorRgba, [0.1, 0.2, 0.3, 0.4]);
});

test('parseMJCF inherits actuator effort limits from default-backed position actuators', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="default-backed-actuator">
          <default class="main">
            <position ctrlrange="-1 1" />
            <default class="servo">
              <position forcerange="-12 12" kp="40" />
            </default>
          </default>
          <worldbody>
            <body name="base_link">
              <body name="arm_link">
                <joint name="arm_joint" type="hinge" axis="0 0 1" />
              </body>
            </body>
          </worldbody>
          <actuator>
            <position name="arm_joint_servo" joint="arm_joint" class="servo" />
          </actuator>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.joints.arm_joint?.limit?.effort, 12);
});

test('parseMJCFModel exposes site and tendon metadata without changing joint actuator resolution', () => {
  installDomGlobals();

  const parsed = parseMJCFModel(`
        <mujoco model="site-tendon-metadata">
          <compiler autolimits="true" />
          <default class="main">
            <site type="sphere" size="0.02" rgba="1 0 0 1" />
            <tendon width="0.03" rgba="0 1 0 1" />
            <position ctrlrange="-1 1" />
            <default class="servo">
              <position forcerange="-5 5" />
            </default>
          </default>
          <worldbody>
            <body name="base_link" childclass="main">
              <site name="tip_site" pos="0 0 0.1" />
              <frame pos="0 0 0.2">
                <site name="frame_site" pos="0 0 0.1" />
              </frame>
              <body name="arm_link">
                <joint name="arm_joint" type="hinge" axis="0 0 1" range="-1 1" />
              </body>
            </body>
          </worldbody>
          <tendon>
            <spatial
              name="finger_tendon"
              range="0 1"
              group="4"
              stiffness="12"
              springlength="0.2"
            >
              <site site="tip_site" />
              <site site="frame_site" />
            </spatial>
          </tendon>
          <actuator>
            <position name="arm_servo" joint="arm_joint" class="servo" />
            <motor name="finger_motor" tendon="finger_tendon" gear="2" />
          </actuator>
        </mujoco>
    `);

  assert.ok(parsed);

  const baseLink = parsed.worldBody.children.find((body) => body.name === 'base_link');
  assert.ok(baseLink);
  assert.equal(baseLink.sites.length, 2);
  assert.deepEqual(
    baseLink.sites.map((site) => site.name),
    ['tip_site', 'frame_site'],
  );
  assert.deepEqual(baseLink.sites[0]?.size, [0.02]);
  assert.deepEqual(baseLink.sites[0]?.pos, [0, 0, 0.1]);
  assert.ok(baseLink.sites[1]?.pos);
  assert.ok(Math.abs((baseLink.sites[1]?.pos?.[0] ?? 0) - 0) <= 1e-9);
  assert.ok(Math.abs((baseLink.sites[1]?.pos?.[1] ?? 0) - 0) <= 1e-9);
  assert.ok(Math.abs((baseLink.sites[1]?.pos?.[2] ?? 0) - 0.3) <= 1e-9);

  const tendon = parsed.tendonMap.get('finger_tendon');
  assert.ok(tendon);
  assert.equal(tendon.type, 'spatial');
  assert.equal(tendon.limited, true);
  assert.equal(tendon.group, 4);
  assert.equal(tendon.width, 0.03);
  assert.equal(tendon.stiffness, 12);
  assert.equal(tendon.springlength, 0.2);
  assert.deepEqual(tendon.rgba, [0, 1, 0, 1]);
  assert.deepEqual(tendon.attachments, [
    { type: 'site', ref: 'tip_site' },
    { type: 'site', ref: 'frame_site' },
  ]);

  assert.equal(parsed.tendonActuators.length, 1);
  assert.equal(parsed.tendonActuators[0]?.name, 'finger_motor');
  assert.equal(parsed.tendonActuators[0]?.tendon, 'finger_tendon');
  assert.deepEqual(parsed.tendonActuators[0]?.gear, [2]);

  const jointActuators = parsed.actuatorMap.get('arm_joint');
  assert.ok(jointActuators);
  assert.equal(jointActuators.length, 1);
  assert.deepEqual(jointActuators[0]?.ctrlrange, [-1, 1]);
  assert.deepEqual(jointActuators[0]?.forcerange, [-5, 5]);
  assert.equal(jointActuators[0]?.ctrllimited, true);
  assert.equal(jointActuators[0]?.forcelimited, true);
});

test('parseMJCFModel merges sibling root tendon and actuator sections in source order', () => {
  installDomGlobals();

  const parsed = parseMJCFModel(`
        <mujoco model="multi-root-sections">
          <worldbody>
            <body name="base_link">
              <site name="site_a" pos="0 0 0" />
              <site name="site_b" pos="0 0 0.1" />
              <body name="finger_link">
                <joint name="finger_joint" type="hinge" axis="0 0 1" />
              </body>
            </body>
          </worldbody>
          <tendon>
            <spatial name="first_tendon">
              <site site="site_a" />
              <site site="site_b" />
            </spatial>
          </tendon>
          <tendon>
            <fixed name="second_tendon">
              <joint joint="finger_joint" coef="1" />
            </fixed>
          </tendon>
          <actuator>
            <motor name="finger_motor" joint="finger_joint" forcerange="-2 2" />
          </actuator>
          <actuator>
            <motor name="second_motor" tendon="second_tendon" gear="3" />
          </actuator>
        </mujoco>
    `);

  assert.ok(parsed);
  assert.deepEqual(Array.from(parsed.tendonMap.keys()), ['first_tendon', 'second_tendon']);
  assert.equal(parsed.actuatorMap.get('finger_joint')?.length, 1);
  assert.equal(parsed.actuatorMap.get('finger_joint')?.[0]?.name, 'finger_motor');
  assert.equal(parsed.tendonActuators.length, 1);
  assert.equal(parsed.tendonActuators[0]?.name, 'second_motor');
  assert.equal(parsed.tendonActuators[0]?.tendon, 'second_tendon');
  assert.deepEqual(parsed.tendonActuators[0]?.gear, [3]);
});

test('parseMJCF matches MuJoCo tendon metadata counts for MyoSuite arm fixtures', () => {
  installDomGlobals();

  const cases = [
    {
      relativePath: 'myosuite/envs/myo/assets/arm/myoarm_bionic_bimanual.xml',
      siteCount: 532,
      tendonCount: 75,
      tendonActuatorCount: 63,
      lastTendonName: 'prosthesis/T_pinky21_cpl',
    },
    {
      relativePath: 'myosuite/envs/myo/assets/arm/myoarm_relocate.xml',
      siteCount: 516,
      tendonCount: 67,
      tendonActuatorCount: 63,
      lastTendonName: 'UI_UB5_tendon',
    },
    {
      relativePath: 'myosuite/envs/myo/assets/arm/myoarm_tabletennis.xml',
      siteCount: 1514,
      tendonCount: 277,
      tendonActuatorCount: 273,
      lastTendonName: 'UI_UB5_tendon',
    },
  ];

  cases.forEach(
    ({ relativePath, siteCount, tendonCount, tendonActuatorCount, lastTendonName }) => {
      const robot = parseResolvedMyosuiteMjcf(relativePath);
      const mjcfContext = robot.inspectionContext?.mjcf;

      assert.equal(mjcfContext?.siteCount, siteCount, relativePath);
      assert.equal(mjcfContext?.tendonCount, tendonCount, relativePath);
      assert.equal(mjcfContext?.tendonActuatorCount, tendonActuatorCount, relativePath);
      assert.equal(mjcfContext?.tendons.at(-1)?.name, lastTendonName, relativePath);
    },
  );
});

test('parseMJCF preserves rebased MJCF site metadata on imported links', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="site-link-metadata">
          <worldbody>
            <body name="base_link">
              <joint name="base_joint" type="hinge" pos="0 0 0.2" axis="0 0 1" range="-1 1" />
              <site name="attachment_site" pos="0 0 0.3" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  const baseLink = robot.links.base_link;
  assert.ok(baseLink);
  assert.equal(baseLink.mjcfSites?.length, 1);
  assert.equal(baseLink.mjcfSites?.[0]?.name, 'attachment_site');
  assert.ok(baseLink.mjcfSites?.[0]?.pos);
  assert.ok(Math.abs(baseLink.mjcfSites?.[0]?.pos?.[0] ?? 0) < 1e-9);
  assert.ok(Math.abs(baseLink.mjcfSites?.[0]?.pos?.[1] ?? 0) < 1e-9);
  assert.ok(Math.abs((baseLink.mjcfSites?.[0]?.pos?.[2] ?? 0) - 0.1) < 1e-9);
});

test('parseMJCFModel expands frame-wrapped bodies and frame childclass-scoped joints', () => {
  installDomGlobals();

  const parsed = parseMJCFModel(`
        <mujoco model="frame-body-joint-semantics">
          <default class="main">
            <joint damping="1" axis="1 0 0" />
            <default class="alt">
              <joint axis="0 1 0" />
            </default>
          </default>
          <worldbody>
            <frame pos="1 2 0" euler="0 0 90" childclass="main">
              <body name="framed_body" pos="0 1 0">
                <frame pos="0 0 1" childclass="alt">
                  <joint name="framed_joint" type="hinge" pos="0 0 0.5" />
                </frame>
                <frame pos="0 0 2">
                  <body name="nested_body" pos="0 0 1" />
                </frame>
              </body>
            </frame>
          </worldbody>
        </mujoco>
    `);

  assert.ok(parsed);

  const framedBody = parsed.worldBody.children.find((body) => body.name === 'framed_body');
  assert.ok(framedBody);
  assert.ok(Math.abs((framedBody.pos?.[0] ?? 0) - 0) <= 1e-9);
  assert.ok(Math.abs((framedBody.pos?.[1] ?? 0) - 2) <= 1e-9);
  assert.ok(Math.abs((framedBody.pos?.[2] ?? 0) - 0) <= 1e-9);
  assert.equal(framedBody.euler, undefined);
  assert.ok(framedBody.quat);

  const framedJoint = framedBody.joints.find((joint) => joint.name === 'framed_joint');
  assert.ok(framedJoint);
  assert.deepEqual(framedJoint.pos, [0, 0, 1.5]);
  assert.ok(Math.abs((framedJoint.axis?.[0] ?? 0) - 0) <= 1e-9);
  assert.ok(Math.abs((framedJoint.axis?.[1] ?? 0) - 1) <= 1e-9);
  assert.ok(Math.abs((framedJoint.axis?.[2] ?? 0) - 0) <= 1e-9);
  assert.equal(framedJoint.damping, 1);

  const nestedBody = framedBody.children.find((body) => body.name === 'nested_body');
  assert.ok(nestedBody);
  assert.deepEqual(nestedBody.pos, [0, 0, 3]);
});

test('parseMJCF rotates frame-wrapped joint anchors and axes into the parent body frame', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="frame-joint-robot-state">
          <worldbody>
            <body name="base_link">
              <body name="child_link">
                <frame pos="0 1 0" euler="0 0 90">
                  <joint name="hinge_joint" type="hinge" axis="1 0 0" range="-1 1" />
                </frame>
                <geom type="box" size="0.1 0.1 0.1" />
              </body>
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.joints.hinge_joint?.parentLinkId, 'base_link');
  assert.equal(robot.joints.hinge_joint?.childLinkId, 'child_link');
  assert.ok(Math.abs((robot.joints.hinge_joint?.origin?.xyz?.x ?? 0) - 0) <= 1e-9);
  assert.ok(Math.abs((robot.joints.hinge_joint?.origin?.xyz?.y ?? 0) - 1) <= 1e-9);
  assert.ok(Math.abs((robot.joints.hinge_joint?.origin?.xyz?.z ?? 0) - 0) <= 1e-9);
  assert.ok(Math.abs((robot.joints.hinge_joint?.axis?.x ?? 0) - 0) <= 1e-9);
  assert.ok(Math.abs((robot.joints.hinge_joint?.axis?.y ?? 0) - 1) <= 1e-9);
  assert.ok(Math.abs((robot.joints.hinge_joint?.axis?.z ?? 0) - 0) <= 1e-9);
});

test('parseMJCF preserves ellipsoid geoms as ellipsoid geometry types', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="ellipsoid-geom">
          <worldbody>
            <body name="base_link">
              <geom type="ellipsoid" size="0.03 0.04 0.02" rgba="0.5 0.7 0.5 1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.type, GeometryType.ELLIPSOID);
  assert.deepEqual(robot.links.base_link.visual.dimensions, {
    x: 0.03,
    y: 0.04,
    z: 0.02,
  });
});

test('parseMJCF preserves plane geoms as plane geometry types', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="plane-geom">
          <worldbody>
            <body name="base_link">
              <geom type="plane" size="3 2 0.1" rgba="0.2 0.2 0.2 1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.type, GeometryType.PLANE);
  assert.deepEqual(robot.links.base_link.visual.dimensions, {
    x: 6,
    y: 4,
    z: 0,
  });
});

test('parseMJCF preserves mjcf-specific hfield and sdf geom types without folding them into mesh/none', () => {
  installDomGlobals();

  const hfieldRobot = parseMJCF(`
        <mujoco model="hfield-geom">
          <asset>
            <hfield name="terrain_patch" file="terrain.png" size="2 3 0.4 0.1" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="hfield" hfield="terrain_patch" rgba="0.3 0.5 0.3 1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(hfieldRobot);
  assert.equal(hfieldRobot.links.base_link.visual.type, GeometryType.HFIELD);
  assert.equal(hfieldRobot.links.base_link.visual.assetRef, 'terrain_patch');
  assert.equal(hfieldRobot.links.base_link.collision.type, GeometryType.HFIELD);
  assert.equal(hfieldRobot.links.base_link.collision.assetRef, 'terrain_patch');
  assert.deepEqual(hfieldRobot.links.base_link.visual.dimensions, {
    x: 4,
    y: 6,
    z: 0.5,
  });
  assert.deepEqual(hfieldRobot.links.base_link.visual.mjcfHfield, {
    name: 'terrain_patch',
    file: 'terrain.png',
    contentType: undefined,
    nrow: undefined,
    ncol: undefined,
    size: {
      radiusX: 2,
      radiusY: 3,
      elevationZ: 0.4,
      baseZ: 0.1,
    },
    elevation: undefined,
  });
  assert.deepEqual(hfieldRobot.links.base_link.collision.mjcfHfield, {
    name: 'terrain_patch',
    file: 'terrain.png',
    contentType: undefined,
    nrow: undefined,
    ncol: undefined,
    size: {
      radiusX: 2,
      radiusY: 3,
      elevationZ: 0.4,
      baseZ: 0.1,
    },
    elevation: undefined,
  });

  const sdfRobot = parseMJCF(`
        <mujoco model="sdf-geom">
          <asset>
            <mesh name="distance_field_mesh" file="distance_field.obj" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="sdf" mesh="distance_field_mesh" rgba="0.5 0.5 0.7 1" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(sdfRobot);
  assert.equal(sdfRobot.links.base_link.visual.type, GeometryType.SDF);
  assert.equal(sdfRobot.links.base_link.visual.assetRef, 'distance_field_mesh');
  assert.equal(sdfRobot.links.base_link.visual.meshPath, 'distance_field.obj');
});

test('parseMJCF prefers material colors over inherited default geom rgba', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="material-default-precedence">
          <default>
            <geom rgba="0.8 0.6 0.4 1" />
          </default>
          <asset>
            <material name="steel_mat" rgba="0.1 0.2 0.3 1" />
            <mesh name="base_mesh" file="base.stl" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="base_mesh" material="steel_mat" group="1" contype="0" conaffinity="0" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#1a334d');
  assert.equal(robot.materials?.base_link?.color, '#1a334d');
});

test('parseMJCF preserves texture-backed material assets with a neutral white multiplier', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="textured-material-sync">
          <compiler texturedir="textures" />
          <asset>
            <texture name="robot_texture" type="2d" file="robot_texture.png" />
            <material name="robot_mtl" texture="robot_texture" />
            <mesh name="base_mesh" file="base.stl" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="base_mesh" material="robot_mtl" group="1" contype="0" conaffinity="0" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.color, '#ffffff');
  assert.deepEqual(robot.materials?.base_link, {
    color: '#ffffff',
    texture: 'textures/robot_texture.png',
  });
});

test('parseMJCF attaches MJCF-specific inspection context for AI review', () => {
  installDomGlobals();

  const robot = parseMJCF(`
        <mujoco model="inspection-context">
          <default class="main">
            <site type="sphere" size="0.01" />
            <tendon width="0.02" rgba="0 1 0 1" />
          </default>
          <worldbody>
            <body name="base_link" childclass="main">
              <site name="tool_center" pos="0 0 0.1" />
              <body name="finger_link">
                <joint name="finger_joint" type="hinge" axis="0 1 0" range="-0.5 0.5" />
              </body>
            </body>
          </worldbody>
          <tendon>
            <spatial name="finger_tendon">
              <site site="tool_center" />
            </spatial>
          </tendon>
          <actuator>
            <motor name="finger_tendon_motor" tendon="finger_tendon" />
          </actuator>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.inspectionContext?.sourceFormat, 'mjcf');
  assert.equal(robot.inspectionContext?.mjcf?.siteCount, 1);
  assert.equal(robot.inspectionContext?.mjcf?.tendonCount, 1);
  assert.equal(robot.inspectionContext?.mjcf?.tendonActuatorCount, 1);
  assert.deepEqual(robot.inspectionContext?.mjcf?.bodiesWithSites, [
    { bodyId: 'base_link', siteCount: 1, siteNames: ['tool_center'] },
  ]);
  assert.deepEqual(robot.inspectionContext?.mjcf?.tendons, [
    {
      className: undefined,
      group: undefined,
      name: 'finger_tendon',
      type: 'spatial',
      limited: undefined,
      range: undefined,
      width: 0.02,
      stiffness: undefined,
      springlength: undefined,
      rgba: [0, 1, 0, 1],
      attachmentRefs: ['tool_center'],
      attachments: [
        {
          type: 'site',
          ref: 'tool_center',
          sidesite: undefined,
          divisor: undefined,
          coef: undefined,
        },
      ],
      actuatorNames: ['finger_tendon_motor'],
    },
  ]);
});

test('parseMJCF uses underscore-based stable names for anonymous MJCF bodies and sites', () => {
  installDomGlobals();

  const xml = `
        <mujoco model="anonymous-generated-names">
          <worldbody>
            <body>
              <geom type="box" size="0.1 0.2 0.3" />
              <site pos="0 0 0.1" />
            </body>
            <body>
              <geom type="sphere" size="0.1" />
            </body>
          </worldbody>
        </mujoco>
    `;

  const parsedModel = parseMJCFModel(xml);
  assert.ok(parsedModel);
  assert.equal(parsedModel.worldBody.children[0]?.name, 'world_body_0');
  assert.equal(parsedModel.worldBody.children[0]?.geoms[0]?.name, 'world_body_0_geom_0');
  assert.equal(parsedModel.worldBody.children[0]?.sites[0]?.name, 'world_body_0_site_0');
  assert.equal(parsedModel.worldBody.children[1]?.name, 'world_body_1');

  const robot = parseMJCF(xml);
  assert.ok(robot);
  assert.equal(robot.rootLinkId, 'world');
  assert.ok(robot.links['world_body_0']);
  assert.deepEqual(robot.inspectionContext?.mjcf?.bodiesWithSites, [
    {
      bodyId: 'world_body_0',
      siteCount: 1,
      siteNames: ['world_body_0_site_0'],
    },
  ]);
});
