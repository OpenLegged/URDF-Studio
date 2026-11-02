import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  buildStandaloneImportAssetWarning,
  buildStandalonePrimitiveGeometryHint,
  buildStandalonePackageAssetImportWarning,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
  extractStandaloneImportAssetReferences,
  extractPackageAssetBundleRoots,
  inferCommonPackageAssetBundleRoot,
} from './importPackageAssetReferences.ts';
import { prepareImportPayload } from './importPreparation.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;

test('extractPackageAssetBundleRoots keeps ROS package roots with intermediate model folders', () => {
  const content = `
<robot name="valkyrie">
  <link name="pelvis">
    <visual>
      <geometry>
        <mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />
      </geometry>
    </visual>
  </link>
</robot>`;

  assert.deepEqual(extractPackageAssetBundleRoots(content), ['val_description/model']);
});

test('extractPackageAssetBundleRoots preserves deeper package roots before mesh and texture folders', () => {
  const content = `
<robot name="pointfoot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://robot_description/pointfoot/PF_P441A/meshes/base_Link.STL" />
      </geometry>
    </visual>
  </link>
</robot>`;

  assert.deepEqual(extractPackageAssetBundleRoots(content), [
    'robot_description/pointfoot/PF_P441A',
  ]);
});

test('commented geometry contributes no missing assets or package roots', () => {
  const content = `<robot name="b2">
    <!-- <mesh filename="../meshes/f_oc_link.STL" />
         <texture filename="package://unused/textures/old.png" /> -->
    <link name="base"><visual><geometry>
      <mesh filename="../meshes/base.dae" />
    </geometry></visual></link>
  </robot>`;
  const source = { format: 'urdf', content };
  assert.deepEqual(extractPackageAssetBundleRoots(content), []);
  assert.deepEqual(extractStandaloneImportAssetReferences(source), ['meshes/base.dae']);
  assert.equal(buildStandaloneImportAssetWarning(source, ['b2/meshes/base.dae']), null);
  assert.deepEqual(buildStandaloneImportAssetWarning(source, []), {
    missingAssetPaths: ['meshes/base.dae'],
  });
});

test('inferCommonPackageAssetBundleRoot derives a shared root from package-dependent robot definitions', () => {
  const sources = [
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    {
      format: 'urdf',
      content:
        '<mesh filename="package://val_description/model/materials/textures/pelvistexture.png" />',
    },
  ];

  assert.equal(inferCommonPackageAssetBundleRoot(sources), 'val_description/model');
});

test('buildStandalonePackageAssetImportWarning reports package-backed imports with no accompanying assets', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    [],
  );

  assert.deepEqual(warning, {
    bundleRoots: ['val_description/model'],
    packageNames: ['val_description'],
  });
});

test('buildStandalonePackageAssetImportWarning stays silent once assets are imported together', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    ['val_description/model/meshes/pelvis/pelvis.dae'],
  );

  assert.equal(warning, null);
});

test('buildStandalonePackageAssetImportWarning stays silent for nested ZIP roots that still contain the package bundle', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    ['archives/2026-04-05/val_description/model/meshes/pelvis/pelvis.dae'],
  );

  assert.equal(warning, null);
});

test('buildStandalonePackageAssetImportWarning stays silent when import path collisions rename the package folder', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://autokit/meshes/base_link.STL" />',
    },
    ['autokit (1)/meshes/base_link.STL'],
  );

  assert.equal(warning, null);
});

test('buildStandalonePackageAssetImportWarning ignores unrelated assets from other bundles', () => {
  const warning = buildStandalonePackageAssetImportWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />',
    },
    ['other_description/meshes/base.dae'],
  );

  assert.deepEqual(warning, {
    bundleRoots: ['val_description/model'],
    packageNames: ['val_description'],
  });
});

test('canProceedWithStandaloneImportAssetWarning never hard-stops loading on missing assets', () => {
  assert.equal(canProceedWithStandaloneImportAssetWarning({ format: 'urdf' }), true);
  assert.equal(canProceedWithStandaloneImportAssetWarning({ format: 'mjcf' }), true);
  assert.equal(canProceedWithStandaloneImportAssetWarning({ format: 'sdf' }), true);
  assert.equal(canProceedWithStandaloneImportAssetWarning(null), true);
});

test('buildStandaloneImportAssetWarning reports missing mesh assets for standalone MJCF imports', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'robots/demo/missing.xml',
      format: 'mjcf',
      content: `
        <mujoco model="missing-mjcf-assets">
          <compiler meshdir="assets" />
          <asset>
            <mesh name="nut_2_5" file="nut_2_5.stl" />
          </asset>
        </mujoco>`,
    },
    [],
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['robots/demo/assets/nut_2_5.stl'],
  });
});

test('buildStandaloneImportAssetWarning accepts compiler-normalized MJCF bundle paths', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'myosuite/envs/myo/assets/arm/myoarm_tabletennis.xml',
      format: 'mjcf',
      content: `
        <mujoco model="tabletennis">
          <compiler meshdir="../../../../simhive/myo_sim" />
          <asset>
            <mesh name="tabletennis_table" file="../../envs/myo/assets/tabletennis_table.obj" />
          </asset>
        </mujoco>`,
    },
    ['myosuite/envs/myo/assets/tabletennis_table.obj'],
  );

  assert.equal(warning, null);
});

test('buildStandaloneImportAssetWarning resolves missing MJCF includes from the source XML directory', () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const warning = buildStandaloneImportAssetWarning(
      {
        name: 'test/myosuite-main/myosuite/envs/myo/assets/arm/myoarm_relocate.xml',
        format: 'mjcf',
        content: `
          <mujoco model="myoarm">
            <include file="../../../../simhive/myo_sim/arm/assets/myoarm_assets.xml" />
            <worldbody />
          </mujoco>`,
      },
      [],
    );

    assert.deepEqual(warning, {
      missingAssetPaths: [
        'test/myosuite-main/myosuite/simhive/myo_sim/arm/assets/myoarm_assets.xml',
      ],
    });
  } finally {
    console.error = originalConsoleError;
  }
});

test('buildStandaloneImportAssetWarning respects compiler directories from resolved MJCF includes', () => {
  const sourcePath = 'test/myosuite-main/myosuite/envs/myo/assets/arm/myoarm_relocate.xml';
  const scenePath = 'test/myosuite-main/myosuite/simhive/myo_sim/scene/myosuite_scene.xml';
  const sourceContent = `
    <mujoco model="myoarm">
      <include file="../../../../simhive/myo_sim/scene/myosuite_scene.xml" />
      <worldbody />
    </mujoco>`;
  const sceneContent = `
    <mujocoinclude model="myosuite_scene">
      <compiler meshdir=".." texturedir=".." />
      <asset>
        <texture name="texfloor" type="2d" file="../myo_sim/scene/floor0.png" />
      </asset>
    </mujocoinclude>`;

  const warning = buildStandaloneImportAssetWarning(
    {
      name: sourcePath,
      format: 'mjcf',
      content: sourceContent,
    },
    ['test/myosuite-main/myosuite/simhive/myo_sim/scene/floor0.png'],
    {
      sourcePath,
      availableFiles: [
        { name: sourcePath, format: 'mjcf', content: sourceContent },
        { name: scenePath, format: 'mjcf', content: sceneContent },
      ],
      allFileContents: {
        [sourcePath]: sourceContent,
        [scenePath]: sceneContent,
      },
    },
  );

  assert.equal(warning, null);
});

test('buildStandaloneImportAssetWarning accepts MJCF scene wrapper textures resolved through included compiler assetdir', () => {
  const sourcePath = 'mujoco_menagerie-main/hello_robot_stretch/scene.xml';
  const robotPath = 'mujoco_menagerie-main/hello_robot_stretch/stretch.xml';
  const sourceContent = `
    <mujoco model="stretch scene">
      <include file="stretch.xml" />
      <asset>
        <texture type="2d" name="wood" file="wood.png" />
        <material name="wood" texture="wood" />
      </asset>
      <worldbody>
        <geom type="box" size=".6 .5 .24" material="wood" />
      </worldbody>
    </mujoco>`;
  const robotContent = `
    <mujocoinclude>
      <compiler assetdir="assets" />
      <asset>
        <texture type="2d" name="hand_crush" file="hand_crush.png" />
        <material name="hand_crush" texture="hand_crush" />
      </asset>
    </mujocoinclude>`;

  const warning = buildStandaloneImportAssetWarning(
    {
      name: sourcePath,
      format: 'mjcf',
      content: sourceContent,
    },
    [
      sourcePath,
      robotPath,
      'mujoco_menagerie-main/hello_robot_stretch/assets/hand_crush.png',
      'mujoco_menagerie-main/hello_robot_stretch/assets/wood.png',
    ],
    {
      sourcePath,
      availableFiles: [
        { name: sourcePath, format: 'mjcf', content: sourceContent },
        { name: robotPath, format: 'mjcf', content: robotContent },
      ],
      allFileContents: {
        [sourcePath]: sourceContent,
        [robotPath]: robotContent,
      },
    },
  );

  assert.equal(warning, null);
});

test('buildStandaloneImportAssetWarning treats nested folder-import asset paths as satisfying URDF mesh references', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      format: 'urdf',
      content: '<mesh filename="../meshes/base_link.dae" />',
    },
    ['robots/b2w_description/meshes/base_link.dae'],
  );

  assert.equal(warning, null);
});

test('buildStandaloneImportAssetWarning matches deep package URIs against imported package-root assets', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      format: 'urdf',
      content:
        '<mesh filename="package://drake/examples/pr2/models/pr2_description/meshes/base_v0/base.stl" />',
    },
    ['pr2_description/meshes/base_v0/base.stl'],
  );

  assert.equal(warning, null);
});

test('buildStandaloneImportAssetWarning reports URDF mesh references that only exist under mismatched asset folders', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'google_barkour_v0/barkour_v0.urdf',
      format: 'urdf',
      content: '<mesh filename="meshes/body.stl" />',
    },
    ['google_barkour_v0/assets/body.stl'],
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['meshes/body.stl'],
  });
});

test('extractStandaloneImportAssetReferences includes URDF texture filenames', () => {
  const references = extractStandaloneImportAssetReferences({
    format: 'urdf',
    content: `
      <robot name="textured">
        <material name="painted">
          <texture filename="textures/paint.png" />
        </material>
        <link name="base_link">
          <visual>
            <geometry>
              <mesh filename="meshes/base_link.stl" />
            </geometry>
            <material name="painted" />
          </visual>
        </link>
      </robot>`,
  });

  assert.deepEqual(references, ['meshes/base_link.stl', 'textures/paint.png']);
});

test('buildStandaloneImportAssetWarning reports missing URDF textures alongside meshes', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'demo/robot.urdf',
      format: 'urdf',
      content: `
        <robot name="textured">
          <material name="painted">
            <texture filename="textures/paint.png" />
          </material>
          <link name="base_link">
            <visual>
              <geometry>
                <mesh filename="meshes/base_link.stl" />
              </geometry>
              <material name="painted" />
            </visual>
          </link>
        </robot>`,
    },
    ['demo/meshes/base_link.stl'],
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['textures/paint.png'],
  });
});

test('extractStandaloneImportAssetReferences resolves SDF gazebo material script textures', () => {
  const references = extractStandaloneImportAssetReferences(
    {
      name: 'demo/model.sdf',
      format: 'sdf',
      content: `
        <sdf version="1.7">
          <model name="demo_model">
            <link name="base_link">
              <visual name="visual">
                <geometry>
                  <mesh>
                    <uri>meshes/base_link.dae</uri>
                  </mesh>
                </geometry>
                <material>
                  <script>
                    <uri>materials/scripts</uri>
                    <name>Demo/Painted</name>
                  </script>
                </material>
              </visual>
            </link>
          </model>
        </sdf>`,
    },
    {
      allFileContents: {
        'demo/materials/scripts/demo.material': `
          material Demo/Painted
          {
            technique
            {
              pass
              {
                texture_unit
                {
                  texture ../textures/coat.png
                }
              }
            }
          }`,
      },
    },
  );

  assert.deepEqual(references, ['demo/materials/textures/coat.png', 'meshes/base_link.dae']);
});

test('buildStandaloneImportAssetWarning reports missing SDF gazebo material script textures', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      name: 'demo/model.sdf',
      format: 'sdf',
      content: `
        <sdf version="1.7">
          <model name="demo_model">
            <link name="base_link">
              <visual name="visual">
                <geometry>
                  <mesh>
                    <uri>meshes/base_link.dae</uri>
                  </mesh>
                </geometry>
                <material>
                  <script>
                    <uri>materials/scripts</uri>
                    <name>Demo/Painted</name>
                  </script>
                </material>
              </visual>
            </link>
          </model>
        </sdf>`,
    },
    ['demo/meshes/base_link.dae'],
    {
      allFileContents: {
        'demo/materials/scripts/demo.material': `
          material Demo/Painted
          {
            technique
            {
              pass
              {
                texture_unit
                {
                  texture ../textures/coat.png
                }
              }
            }
          }`,
      },
    },
  );

  assert.deepEqual(warning, {
    missingAssetPaths: ['demo/materials/textures/coat.png'],
  });
});

test('buildStandaloneImportAssetWarning tolerates renamed top-level package folders after import collisions', () => {
  const warning = buildStandaloneImportAssetWarning(
    {
      format: 'urdf',
      content: '<mesh filename="package://autokit/meshes/base_link.STL" />',
    },
    ['autokit (1)/meshes/base_link.STL'],
  );

  assert.equal(warning, null);
});

test('collectStandaloneImportSupportAssetPaths keeps xuebao archive warnings silent when deferred mesh assets are still pending hydration', async () => {
  const zipFile = new File([fs.readFileSync('test/xuebao.zip')], 'xuebao.zip', {
    type: 'application/zip',
  });

  const prepared = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  const preferredFile = prepared.preferredFileName
    ? (prepared.robotFiles.find((file) => file.name === prepared.preferredFileName) ?? null)
    : null;

  assert.ok(preferredFile, 'expected xuebao preferred file');

  const importedAssetPaths = collectStandaloneImportSupportAssetPaths(
    Object.fromEntries(prepared.assetFiles.map((file) => [file.name, `blob:${file.name}`])),
    prepared.robotFiles,
  );

  const warning = buildStandaloneImportAssetWarning(preferredFile, importedAssetPaths, {
    allFileContents: Object.fromEntries(
      prepared.textFiles.map((file) => [file.path, file.content]),
    ),
    sourcePath: preferredFile.name,
  });

  assert.equal(warning, null);
});

test('buildStandalonePrimitiveGeometryHint reports primitive-only URDFs that ship sibling mesh assets', () => {
  const source = {
    name: 'awesome_robot_descriptions_repos/sigmaban_urdf/robot.urdf',
    format: 'urdf' as const,
    content: fs.readFileSync(
      'test/awesome_robot_descriptions_repos/sigmaban_urdf/robot.urdf',
      'utf8',
    ),
  };

  const assetPaths = fs
    .readdirSync('test/awesome_robot_descriptions_repos/sigmaban_urdf')
    .filter((entry) => entry.toLowerCase().endsWith('.stl'))
    .map((entry) => `awesome_robot_descriptions_repos/sigmaban_urdf/${entry}`);

  const hint = buildStandalonePrimitiveGeometryHint(source, assetPaths, {
    sourcePath: source.name,
  });

  assert.deepEqual(hint, {
    siblingMeshAssetPaths: [
      'awesome_robot_descriptions_repos/sigmaban_urdf/cleat.stl',
      'awesome_robot_descriptions_repos/sigmaban_urdf/foot_plate.stl',
      'awesome_robot_descriptions_repos/sigmaban_urdf/hand.stl',
    ],
    siblingMeshAssetCount: 15,
  });
});

test('buildStandalonePrimitiveGeometryHint stays silent when the URDF already references meshes', () => {
  const source = {
    name: 'awesome_robot_descriptions_repos/onshape-to-robot-examples/sigmaban2019_urdf/robot.urdf',
    format: 'urdf' as const,
    content: fs.readFileSync(
      'test/awesome_robot_descriptions_repos/onshape-to-robot-examples/sigmaban2019_urdf/robot.urdf',
      'utf8',
    ),
  };

  const assetPaths = fs
    .readdirSync(
      'test/awesome_robot_descriptions_repos/onshape-to-robot-examples/sigmaban2019_urdf/assets/merged',
    )
    .filter((entry) => entry.toLowerCase().endsWith('.stl'))
    .map(
      (entry) =>
        `awesome_robot_descriptions_repos/onshape-to-robot-examples/sigmaban2019_urdf/assets/merged/${entry}`,
    );

  const hint = buildStandalonePrimitiveGeometryHint(source, assetPaths, {
    sourcePath: source.name,
  });

  assert.equal(hint, null);
});
