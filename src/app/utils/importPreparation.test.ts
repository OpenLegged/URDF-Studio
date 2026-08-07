import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import {
  prepareImportPayload,
  type ImportPreparationFileDescriptor,
  type PrepareImportProgress,
} from './importPreparation.ts';
import {
  buildUsdRootLayerContent,
  createUsdArchivePackage,
} from '@/features/file-io/utils/usdPackageLayers';
import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';
import { buildPreResolvedImportContentSignature } from './preResolvedImportSignature.ts';

ensureWorkerXmlDomApis(globalThis as typeof globalThis);

function createLooseFile(
  name: string,
  content: BlobPart,
  relativePath?: string,
  options?: FilePropertyBag,
): File {
  const file = new File([content], name, options);

  if (relativePath) {
    Object.defineProperty(file, 'webkitRelativePath', {
      value: relativePath,
      configurable: true,
    });
  }

  return file;
}

function withReportedFileSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', {
    value: size,
    configurable: true,
  });
  return file;
}

function createFixtureLooseFiles(
  fixtureRoot: string,
  selectedFolderName: string,
  shouldInclude: (relativePath: string) => boolean,
): File[] {
  const files: File[] = [];
  const pendingDirectories = [fixtureRoot];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    for (const entry of fs.readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absolutePath);
        continue;
      }

      const relativePath = path.relative(fixtureRoot, absolutePath).split(path.sep).join('/');
      if (!shouldInclude(relativePath)) {
        continue;
      }

      const file = new File([fs.readFileSync(absolutePath)], entry.name);
      Object.defineProperty(file, 'webkitRelativePath', {
        value: `${selectedFolderName}/${relativePath}`,
        configurable: true,
      });
      files.push(file);
    }
  }

  return files;
}

async function createTarGzArchiveFile(
  entries: Array<{ path: string; content: BlobPart; type?: string }>,
  outputFileName = 'bundle.tar.gz',
): Promise<File> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'urdf-studio-targz-'));
  const inputRoot = path.join(tempRoot, 'archive-root');
  const archivePath = path.join(tempRoot, outputFileName);

  fs.mkdirSync(inputRoot, { recursive: true });

  try {
    for (const entry of entries) {
      const entryPath = path.join(inputRoot, ...entry.path.split('/'));
      fs.mkdirSync(path.dirname(entryPath), { recursive: true });
      fs.writeFileSync(entryPath, Buffer.from(await new Blob([entry.content]).arrayBuffer()));
    }

    const topLevelEntries = [
      ...new Set(entries.map((entry) => entry.path.split('/')[0]).filter(Boolean)),
    ];
    const tarResult = spawnSync('tar', ['-czf', archivePath, '-C', inputRoot, ...topLevelEntries], {
      encoding: 'utf8',
    });

    if (tarResult.error) {
      throw tarResult.error;
    }

    if (tarResult.status !== 0) {
      throw new Error(
        `Failed to create tar.gz fixture: ${tarResult.stderr || tarResult.stdout || `exit ${tarResult.status}`}`,
      );
    }

    return new File([fs.readFileSync(archivePath)], outputFileName, {
      type: 'application/gzip',
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('prepareImportPayload renames colliding loose imports while preserving file classifications', async () => {
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'robot/demo.urdf',
    ),
    createLooseFile('base.stl', 'solid demo', 'robot/meshes/base.stl'),
    createLooseFile('M1.txt', '{"name":"M1"}', 'robot/motor library/Acme/M1.txt'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: ['robot/existing.urdf'],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'robot (1)/demo.urdf', format: 'urdf' },
      { name: 'robot (1)/meshes/base.stl', format: 'mesh' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['robot (1)/meshes/base.stl'],
  );
  assert.deepEqual(
    result.libraryFiles.map((file) => file.path),
    ['robot (1)/motor library/Acme/M1.txt'],
  );
});

test('prepareImportPayload excludes non-import candidates from loose folder preparation progress', async () => {
  const files = [
    createLooseFile('pack.bin', new Uint8Array(10), 'unitree_ros/.git/objects/pack/pack.bin'),
    createLooseFile('README.md', '# Unitree ROS', 'unitree_ros/README.md'),
    createLooseFile('CMakeLists.txt', 'cmake_minimum_required(VERSION 3.16)', 'unitree_ros/CMakeLists.txt'),
    createLooseFile('package.xml', '<package><name>demo</name></package>', 'unitree_ros/package.xml'),
    createLooseFile('controller.cpp', 'int main() { return 0; }', 'unitree_ros/src/controller.cpp'),
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'unitree_ros/robots/demo_description/urdf/demo.urdf',
    ),
    createLooseFile('base.stl', 'solid demo', 'unitree_ros/robots/demo_description/meshes/base.stl'),
    createLooseFile(
      'M1.txt',
      '{"name":"M1","armature":0.01,"velocity":10,"effort":5}',
      'unitree_ros/motor library/Acme/M1.txt',
    ),
  ];
  const progressEvents: PrepareImportProgress[] = [];
  const expectedPreparedBytes = files
    .filter((file) =>
      [
        'unitree_ros/robots/demo_description/urdf/demo.urdf',
        'unitree_ros/robots/demo_description/meshes/base.stl',
        'unitree_ros/motor library/Acme/M1.txt',
      ].includes(file.webkitRelativePath),
    )
    .reduce((sum, file) => sum + file.size, 0);

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
    onProgress: (progress) => progressEvents.push(progress),
  });

  assert.deepEqual(
    result.robotFiles.map((file) => ({ name: file.name, format: file.format })),
    [
      { name: 'unitree_ros/robots/demo_description/meshes/base.stl', format: 'mesh' },
      { name: 'unitree_ros/robots/demo_description/urdf/demo.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(
    result.libraryFiles.map((file) => file.path),
    ['unitree_ros/motor library/Acme/M1.txt'],
  );
  assert.equal(progressEvents.length > 0, true);
  assert.equal(progressEvents[0].totalEntries, 3);
  assert.equal(progressEvents[0].totalBytes, expectedPreparedBytes);
  assert.equal(progressEvents.at(-1)?.processedEntries, 3);
  assert.equal(progressEvents.at(-1)?.totalEntries, 3);
});

test('prepareImportPayload imports all loose folder mesh assets like the legacy folder flow', async () => {
  const files = [
    createLooseFile(
      'alpha.urdf',
      `<?xml version="1.0"?>
<robot name="alpha">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://alpha_description/meshes/alpha_base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'unitree_ros/robots/alpha_description/urdf/alpha.urdf',
    ),
    createLooseFile(
      'beta_with_hand.urdf',
      `<?xml version="1.0"?>
<robot name="beta">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://beta_description/meshes/beta_base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'unitree_ros/robots/beta_description/urdf/beta_with_hand.urdf',
    ),
    createLooseFile(
      'alpha_base.stl',
      'solid alpha',
      'unitree_ros/robots/alpha_description/meshes/alpha_base.stl',
    ),
    createLooseFile(
      'beta_base.stl',
      'solid beta',
      'unitree_ros/robots/beta_description/meshes/beta_base.stl',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'unitree_ros/robots/alpha_description/urdf/alpha.urdf');
  assert.deepEqual(
    result.assetFiles.map((file) => file.name).sort(),
    [
      'unitree_ros/robots/alpha_description/meshes/alpha_base.stl',
      'unitree_ros/robots/beta_description/meshes/beta_base.stl',
    ],
  );
  assert.deepEqual(
    result.robotFiles
      .filter((file) => file.format === 'mesh')
      .map((file) => file.name)
      .sort(),
    [
      'unitree_ros/robots/alpha_description/meshes/alpha_base.stl',
      'unitree_ros/robots/beta_description/meshes/beta_base.stl',
    ],
  );
  assert.deepEqual(result.deferredAssetFiles, []);
});

test('prepareImportPayload keeps loose OBJ material sidecars and their textures', async () => {
  const files = [
    createLooseFile(
      'body.obj',
      [
        'mtllib body.mtl',
        'usemtl Painted',
        'o Body',
      ].join('\n'),
      'robot/assets/body.obj',
    ),
    createLooseFile(
      'body.mtl',
      [
        'newmtl Painted',
        'Kd 1 0 0',
        'map_Kd textures/body.png',
      ].join('\n'),
      'robot/assets/body.mtl',
    ),
    createLooseFile(
      'body.png',
      new Uint8Array([137, 80, 78, 71]),
      'robot/assets/textures/body.png',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'robot/assets/body.obj');
  assert.deepEqual(
    result.assetFiles.map((file) => file.name).sort(),
    [
      'robot/assets/body.mtl',
      'robot/assets/body.obj',
      'robot/assets/textures/body.png',
    ],
  );
  assert.deepEqual(result.textFiles, [
    {
      path: 'robot/assets/body.mtl',
      content: [
        'newmtl Painted',
        'Kd 1 0 0',
        'map_Kd textures/body.png',
      ].join('\n'),
    },
  ]);
});

test('prepareImportPayload keeps loose URDF referenced OBJ material sidecars', async () => {
  const files = [
    createLooseFile(
      'robot.urdf',
      [
        '<?xml version="1.0"?>',
        '<robot name="demo">',
        '  <link name="base_link">',
        '    <visual>',
        '      <geometry>',
        '        <mesh filename="assets/body.obj" />',
        '      </geometry>',
        '    </visual>',
        '  </link>',
        '</robot>',
      ].join('\n'),
      'robot/robot.urdf',
    ),
    createLooseFile(
      'body.obj',
      [
        'mtllib body.mtl',
        'usemtl Painted',
        'o Body',
      ].join('\n'),
      'robot/assets/body.obj',
    ),
    createLooseFile('body.mtl', 'newmtl Painted\nKd 1 0 0', 'robot/assets/body.mtl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'robot/robot.urdf');
  assert.ok(
    result.assetFiles.some((file) => file.name === 'robot/assets/body.mtl'),
    'expected OBJ material sidecar to be available as a renderable asset',
  );
  assert.deepEqual(result.textFiles, [
    { path: 'robot/assets/body.mtl', content: 'newmtl Painted\nKd 1 0 0' },
  ]);
});

test('prepareImportPayload keeps archived URDF referenced OBJ material sidecars', async () => {
  const zip = new JSZip();
  zip.file(
    'robot/robot.urdf',
    [
      '<?xml version="1.0"?>',
      '<robot name="demo">',
      '  <link name="base_link">',
      '    <visual>',
      '      <geometry>',
      '        <mesh filename="assets/body.obj" />',
      '      </geometry>',
      '    </visual>',
      '  </link>',
      '</robot>',
    ].join('\n'),
  );
  zip.file(
    'robot/assets/body.obj',
    [
      'mtllib body.mtl',
      'usemtl Painted',
      'o Body',
    ].join('\n'),
  );
  zip.file(
    'robot/assets/body.mtl',
    [
      'newmtl Painted',
      'Kd 1 0 0',
      'map_Kd ../materials/textures/cardboard_box.png',
    ].join('\n'),
  );
  zip.file('robot/materials/textures/cardboard_box.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'robot/robot.urdf');
  assert.ok(
    result.assetFiles.some((file) => file.name === 'robot/assets/body.obj'),
    'expected OBJ mesh to be hydrated as a renderable asset',
  );
  assert.ok(
    result.assetFiles.some((file) => file.name === 'robot/assets/body.mtl'),
    'expected OBJ material sidecar to be hydrated as a renderable asset',
  );
  assert.ok(
    result.assetFiles.some((file) => file.name === 'robot/materials/textures/cardboard_box.png'),
    'expected OBJ material texture sidecar to be hydrated as a renderable asset',
  );
  assert.deepEqual(result.textFiles, [
    {
      path: 'robot/assets/body.mtl',
      content: [
        'newmtl Painted',
        'Kd 1 0 0',
        'map_Kd ../materials/textures/cardboard_box.png',
      ].join('\n'),
    },
  ]);
});

test('prepareImportPayload keeps all loose USD source blobs like the legacy folder flow', async () => {
  const files = [
    createLooseFile(
      'alpha.usd',
      `#usda 1.0
def Xform "alpha" {
  prepend references = @configuration/alpha_base.usd@
}`,
      'unitree_model/Alpha/usd/alpha.usd',
    ),
    createLooseFile(
      'alpha_base.usd',
      '#usda 1.0\ndef Scope "alpha_base" {}',
      'unitree_model/Alpha/usd/configuration/alpha_base.usd',
    ),
    createLooseFile(
      'beta.usd',
      `#usda 1.0
def Xform "beta" {
  prepend references = @configuration/beta_base.usd@
}`,
      'unitree_model/Beta/usd/beta.usd',
    ),
    createLooseFile(
      'beta_base.usd',
      '#usda 1.0\ndef Scope "beta_base" {}',
      'unitree_model/Beta/usd/configuration/beta_base.usd',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'unitree_model/Alpha/usd/alpha.usd');
  assert.deepEqual(
    result.usdSourceFiles.map((file) => file.name).sort(),
    [
      'unitree_model/Alpha/usd/alpha.usd',
      'unitree_model/Alpha/usd/configuration/alpha_base.usd',
      'unitree_model/Beta/usd/beta.usd',
      'unitree_model/Beta/usd/configuration/beta_base.usd',
    ],
  );
});

test('prepareImportPayload scans zip bundles off the main classification path and keeps only visible library entries', async () => {
  const zip = new JSZip();
  zip.file('.hidden/ignored.urdf', '<robot name="ignored" />');
  zip.file(
    'robot/demo.urdf',
    `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
  );
  zip.file('robot/meshes/base.obj', 'o Mesh');
  zip.file('robot/textures/albedo.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('robot/docs/README.md', '# Demo robot');
  zip.file('robot/cache/payload.dat', new Uint8Array([1, 2, 3, 4]));
  zip.file('robot/motor library/Acme/M1.txt', '{"name":"M1"}');
  zip.file('robot/scene.usdc', new Uint8Array([80, 88, 82, 45, 85, 83, 68, 67, 1, 2, 3]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(
    result.robotFiles.some((file) => file.name.includes('.hidden')),
    false,
  );
  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format, content: file.content }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      {
        name: 'robot/demo.urdf',
        format: 'urdf',
        content: `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      },
      { name: 'robot/meshes/base.obj', format: 'mesh', content: '' },
      { name: 'robot/scene.usdc', format: 'usd', content: '' },
      { name: 'robot/textures/albedo.png', format: 'mesh', content: '' },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'robot/meshes/base.obj',
    'robot/textures/albedo.png',
  ]);
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    [],
  );
  assert.deepEqual(
    result.libraryFiles.map((file) => file.path),
    ['robot/motor library/Acme/M1.txt'],
  );
  assert.deepEqual(result.textFiles, []);
  assert.deepEqual(
    result.usdSourceFiles.map((file) => file.name),
    ['robot/scene.usdc'],
  );
  assert.equal(result.usdSourceFiles[0].blob.size > 0, true);
});

test('prepareImportPayload scans supported zip bundles and exposes extracted robot files', async () => {
  const zipFile = new File([fs.readFileSync('test/xuebao.zip')], 'xuebao.zip', {
    type: 'application/zip',
  });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.ok(
    result.robotFiles.some(
      (file) => file.name.endsWith('/xuebao_unified.xml') && file.format === 'mjcf',
    ),
  );
  assert.ok(result.robotFiles.some((file) => file.name.endsWith('.obj') && file.format === 'mesh'));
  assert.ok(result.preferredFileName);
});

test('prepareImportPayload fast-open mode keeps MyoSuite archive assets deferred', async () => {
  const zipFile = new File([fs.readFileSync('test/myosuite-main.zip')], 'myosuite-main.zip', {
    type: 'application/zip',
  });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.deepEqual(result.preResolvedImports, []);
  assert.ok(
    result.robotFiles.some(
      (file) =>
        file.name === 'myosuite-main/myosuite/envs/myo/assets/arm/myoarm_bionic_bimanual.xml',
    ),
  );
  assert.ok(result.deferredAssetFiles.length > result.assetFiles.length);
  assert.ok(
    result.deferredAssetFiles.some((file) =>
      file.name.startsWith('myosuite-main/myosuite/simhive/'),
    ),
  );
});

test('prepareImportPayload expands archive files discovered during loose folder imports', async () => {
  const alphaZip = new JSZip();
  alphaZip.file(
    'alpha/model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.10">
  <model name="alpha">
    <link name="base_link">
      <visual name="visual">
        <geometry>
          <mesh>
            <uri>meshes/base.stl</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  );
  alphaZip.file('alpha/meshes/base.stl', 'solid alpha');

  const betaZip = new JSZip();
  betaZip.file(
    'beta/model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.10">
  <model name="beta">
    <link name="base_link">
      <visual name="visual">
        <geometry>
          <mesh>
            <uri>meshes/base.stl</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  );
  betaZip.file('beta/meshes/base.stl', 'solid beta');

  const alphaArchiveFile = createLooseFile(
    'alpha.zip',
    await alphaZip.generateAsync({ type: 'uint8array' }),
    'sdf/alpha.zip',
    { type: 'application/zip' },
  );
  const betaArchiveFile = createLooseFile(
    'beta.zip',
    await betaZip.generateAsync({ type: 'uint8array' }),
    'sdf/beta.zip',
    { type: 'application/zip' },
  );

  const result = await prepareImportPayload({
    files: [alphaArchiveFile, betaArchiveFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'alpha/meshes/base.stl', format: 'mesh' },
      { name: 'alpha/model.sdf', format: 'sdf' },
      { name: 'beta/meshes/base.stl', format: 'mesh' },
      { name: 'beta/model.sdf', format: 'sdf' },
    ],
  );
  assert.deepEqual(
    result.deferredAssetFiles
      .map((file) => ({
        name: file.name,
        sourceArchiveImportPath: file.sourceArchiveImportPath,
        sourcePath: file.sourcePath,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      {
        name: 'alpha/meshes/base.stl',
        sourceArchiveImportPath: 'sdf/alpha.zip',
        sourcePath: 'alpha/meshes/base.stl',
      },
      {
        name: 'beta/meshes/base.stl',
        sourceArchiveImportPath: 'sdf/beta.zip',
        sourcePath: 'beta/meshes/base.stl',
      },
    ],
  );
  assert.equal(result.preferredFileName, 'alpha/model.sdf');
});

test('prepareImportPayload supports mixed loose folders and archive files in one folder import', async () => {
  const archiveZip = new JSZip();
  archiveZip.file(
    'alpha/model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.10">
  <model name="alpha">
    <link name="base_link">
      <visual name="visual">
        <geometry>
          <mesh>
            <uri>meshes/base.stl</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  );
  archiveZip.file('alpha/meshes/base.stl', 'solid alpha');

  const looseRobot = createLooseFile(
    'model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.10">
  <model name="gamma">
    <link name="base_link">
      <visual name="visual">
        <geometry>
          <mesh>
            <uri>meshes/frame.stl</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
    'gamma/model.sdf',
  );
  const looseMesh = createLooseFile('frame.stl', 'solid gamma', 'gamma/meshes/frame.stl');
  const archivedRobot = createLooseFile(
    'alpha.zip',
    await archiveZip.generateAsync({ type: 'uint8array' }),
    'sdf/alpha.zip',
    { type: 'application/zip' },
  );

  const result = await prepareImportPayload({
    files: [looseRobot, looseMesh, archivedRobot],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.ok(
    result.robotFiles.some((file) => file.name === 'gamma/model.sdf' && file.format === 'sdf'),
  );
  assert.ok(
    result.robotFiles.some(
      (file) => file.name === 'gamma/meshes/frame.stl' && file.format === 'mesh',
    ),
  );
  assert.ok(
    result.robotFiles.some((file) => file.name === 'alpha/model.sdf' && file.format === 'sdf'),
  );
  assert.ok(
    result.robotFiles.some(
      (file) => file.name === 'alpha/meshes/base.stl' && file.format === 'mesh',
    ),
  );
  assert.ok(result.assetFiles.some((file) => file.name === 'gamma/meshes/frame.stl'));
  assert.ok(
    result.deferredAssetFiles.some(
      (file) =>
        file.name === 'alpha/meshes/base.stl' &&
        file.sourcePath === 'alpha/meshes/base.stl' &&
        file.sourceArchiveImportPath === 'sdf/alpha.zip',
    ),
  );
});

test('prepareImportPayload keeps only referenced MJCF text mesh sidecars and OBJ material text', async () => {
  const zip = new JSZip();
  zip.file(
    'robot/demo.xml',
    `<?xml version="1.0"?>
<mujoco model="demo">
  <compiler meshdir="assets" />
  <asset>
    <mesh name="body" file="body.obj" />
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="body" />
    </body>
  </worldbody>
</mujoco>`,
  );
  zip.file(
    'robot/assets/body.obj',
    `mtllib body.mtl
o BodyMesh`,
  );
  zip.file('robot/assets/body.mtl', 'newmtl default');
  zip.file('robot/assets/unused.obj', 'o UnusedMesh');
  zip.file('robot/assets/unused.mtl', 'newmtl unused');

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'robot/demo.xml');
  assert.deepEqual(result.textFiles, [
    { path: 'robot/assets/body.mtl', content: 'newmtl default' },
    {
      path: 'robot/assets/body.obj',
      content: `mtllib body.mtl
o BodyMesh`,
    },
  ]);
});

test('prepareImportPayload does not heuristically mirror MJCF text mesh sidecars from malformed XML', async () => {
  const files = [
    createLooseFile(
      'demo.xml',
      [
        '<?xml version="1.0"?>',
        '<mujoco model="demo">',
        '  <asset>',
        '    <mesh name="body" file="body.obj">',
      ].join('\n'),
      'robot/demo.xml',
    ),
    createLooseFile(
      'body.obj',
      ['mtllib body.mtl', 'o BodyMesh'].join('\n'),
      'robot/assets/body.obj',
    ),
    createLooseFile('body.mtl', 'newmtl body', 'robot/assets/body.mtl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'robot/demo.xml');
  assert.deepEqual(result.textFiles, []);
});

test('prepareImportPayload fast-open mode keeps include-scoped MJCF OBJ, DAE, and MTL sidecars', async () => {
  const files = [
    createLooseFile(
      'robot.xml',
      `<?xml version="1.0"?>
<mujoco model="demo">
  <include file="fragments/assets.xml" />
  <worldbody>
    <include file="fragments/body.xml" />
  </worldbody>
</mujoco>`,
      'demo/robot.xml',
    ),
    createLooseFile(
      'assets.xml',
      `<?xml version="1.0"?>
<mujocoinclude>
  <asset>
    <mesh name="body" file="../meshes/body.obj" />
    <mesh name="shell" file="../meshes/shell.dae" />
  </asset>
</mujocoinclude>`,
      'demo/fragments/assets.xml',
    ),
    createLooseFile(
      'body.xml',
      `<?xml version="1.0"?>
<mujocoinclude>
  <body name="base_link">
    <geom type="mesh" mesh="body" />
    <geom type="mesh" mesh="shell" />
  </body>
</mujocoinclude>`,
      'demo/fragments/body.xml',
    ),
    createLooseFile(
      'body.obj',
      `mtllib body.mtl
o BodyMesh`,
      'demo/meshes/body.obj',
    ),
    createLooseFile('body.mtl', 'newmtl body', 'demo/meshes/body.mtl'),
    createLooseFile(
      'shell.dae',
      `<?xml version="1.0" encoding="utf-8"?>
<COLLADA version="1.4.1"></COLLADA>`,
      'demo/meshes/shell.dae',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'demo/robot.xml');
  assert.deepEqual(result.preResolvedImports, []);
  assert.deepEqual(result.textFiles, [
    { path: 'demo/meshes/body.mtl', content: 'newmtl body' },
    {
      path: 'demo/meshes/body.obj',
      content: `mtllib body.mtl
o BodyMesh`,
    },
    {
      path: 'demo/meshes/shell.dae',
      content: `<?xml version="1.0" encoding="utf-8"?>
<COLLADA version="1.4.1"></COLLADA>`,
    },
  ]);
});

test('prepareImportPayload scans tar.gz bundles through the archive import path', async () => {
  const tarGzFile = await createTarGzArchiveFile([
    {
      path: 'robot/demo.urdf',
      content: `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      type: 'text/xml',
    },
    {
      path: 'robot/meshes/base.obj',
      content: 'o Mesh',
      type: 'text/plain',
    },
    {
      path: 'robot/textures/albedo.png',
      content: new Uint8Array([137, 80, 78, 71]),
      type: 'image/png',
    },
  ]);

  const result = await prepareImportPayload({
    files: [tarGzFile],
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'robot/demo.urdf', format: 'urdf' },
      { name: 'robot/meshes/base.obj', format: 'mesh' },
      { name: 'robot/textures/albedo.png', format: 'mesh' },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'robot/meshes/base.obj',
    'robot/textures/albedo.png',
  ]);
  assert.deepEqual(result.textFiles, []);
});

test('prepareImportPayload exposes loose image assets in the browser file list', async () => {
  const files = [
    createLooseFile('poster.png', new Uint8Array([137, 80, 78, 71]), 'robot/textures/poster.png', {
      type: 'image/png',
    }),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles.map((file) => ({ name: file.name, format: file.format })),
    [{ name: 'robot/textures/poster.png', format: 'mesh' }],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['robot/textures/poster.png'],
  );
});

test('prepareImportPayload returns an empty payload when loose imports contain no supported files', async () => {
  const result = await prepareImportPayload({
    files: [
      createLooseFile('README.md', '# Demo robot', 'robot/README.md'),
      createLooseFile('payload.dat', new Uint8Array([1, 2, 3, 4]), 'robot/raw/payload.dat'),
    ],
    existingPaths: [],
  });

  assert.deepEqual(result, {
    robotFiles: [],
    assetFiles: [],
    deferredAssetFiles: [],
    usdSourceFiles: [],
    libraryFiles: [],
    textFiles: [],
    preferredFileName: null,
    preResolvedImports: [],
  });
});

test('prepareImportPayload classifies motor-library.json as a library file', async () => {
  const files = [
    createLooseFile(
      'motor-library.json',
      JSON.stringify({
        Unitree: [
          {
            name: 'Unitree-Custom-X',
            armature: 0.1,
            velocity: 20,
            effort: 40,
          },
        ],
      }),
      'robot/motor-library.json',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.libraryFiles.map((file) => file.path),
    ['robot/motor-library.json'],
  );
  assert.equal(result.robotFiles.length, 0);
  assert.equal(result.assetFiles.length, 0);
});

test('prepareImportPayload keeps textual usd content available for downstream hydration', async () => {
  const usdText = `#usda 1.0
def Xform "robot"
{
}`;
  const usdFile = createLooseFile('scene.usd', usdText, 'scene/scene.usd');

  const result = await prepareImportPayload({
    files: [usdFile],
    existingPaths: [],
  });

  assert.equal(result.robotFiles.length, 1);
  assert.equal(result.robotFiles[0].name, 'scene/scene.usd');
  assert.equal(result.robotFiles[0].format, 'usd');
  assert.equal(result.robotFiles[0].content, usdText);
  assert.equal(result.usdSourceFiles.length, 1);
  assert.equal(await result.usdSourceFiles[0].blob.text(), usdText);
});

test('prepareImportPayload reopens a current five-layer IsaacSim USD export package', async () => {
  const rootLayerContent = buildUsdRootLayerContent('demo', 'demo', {
    fileFormat: 'usd',
    layoutProfile: 'isaacsim',
  });
  const archive = createUsdArchivePackage(
    'demo',
    {
      rootLayerContent,
      baseLayerContent: `#usda 1.0
(
    defaultPrim = "demo"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "demo"
{
    asset urdfStudio:sourceAsset = @../assets/body.png@
}
`,
      physicsLayerContent: `#usda 1.0
(
    defaultPrim = "demo"
    metersPerUnit = 1
    subLayers = [@demo_base.usd@]
    upAxis = "Z"
)

over "demo"
{
}
`,
      sensorLayerContent: `#usda 1.0
(
    defaultPrim = "demo"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "demo"
{
}
`,
      robotLayerContent: `#usda 1.0
(
    defaultPrim = "demo"
    metersPerUnit = 1
    upAxis = "Z"
)

def Xform "demo"
{
    rel isaac:physics:robotJoints = []
    rel isaac:physics:robotLinks = []
}
`,
    },
    new Map([
      [
        'assets/body.png',
        new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      ],
    ]),
    {
      fileFormat: 'usd',
      layoutProfile: 'isaacsim',
    },
  );
  const zip = new JSZip();
  for (const [filePath, blob] of archive.archiveFiles) {
    zip.file(filePath, new Uint8Array(await blob.arrayBuffer()));
  }
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });

  const result = await prepareImportPayload({
    files: [
      new File([zipBytes], archive.archiveFileName, {
        type: 'application/zip',
      }),
    ],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/demo.usd');
  assert.deepEqual(
    result.usdSourceFiles.map((file) => file.name).sort(),
    [
      'demo/configuration/demo_base.usd',
      'demo/configuration/demo_physics.usd',
      'demo/configuration/demo_robot.usd',
      'demo/configuration/demo_sensor.usd',
      'demo/demo.usd',
    ],
  );
  assert.equal(result.preResolvedImports[0]?.fileName, 'demo/demo.usd');
  assert.equal(result.preResolvedImports[0]?.result.status, 'needs_hydration');
  assert.ok(
    result.assetFiles.some((file) => file.name === 'demo/assets/body.png'),
    'expected the exported USD texture asset to be hydrated with the package',
  );
  assert.equal(result.deferredAssetFiles.length, 0);
});

test('prepareImportPayload keeps unrelated opaque USD package assets deferred', async () => {
  const zip = new JSZip();
  zip.file('lab/scene.usd', new Uint8Array([
    80, 88, 82, 45, 85, 83, 68, 67, 0, 0, 0, 0,
  ]));
  zip.file('lab/textures/albedo.jpg', new Uint8Array([255, 216, 255, 217]));
  zip.file('lab/point_cloud.ply', new Uint8Array([112, 108, 121, 10]));
  zip.file('other/textures/unrelated.png', new Uint8Array([137, 80, 78, 71]));
  const zipBytes = await zip.generateAsync({ type: 'uint8array' });

  const result = await prepareImportPayload({
    files: [
      new File([zipBytes], 'opaque-usd-package.zip', {
        type: 'application/zip',
      }),
    ],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'lab/scene.usd');
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['lab/textures/albedo.jpg'],
  );
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name).sort(),
    ['lab/point_cloud.ply', 'other/textures/unrelated.png'],
  );
});

test('prepareImportPayload keeps large USDA sidecars blob-backed instead of eagerly decoding them', async () => {
  const rootUsdText = `#usda 1.0
(
    defaultPrim = "demo_robot"
)

def Xform "demo_robot"
{
    prepend references = @configuration/demo_base.usda@
}`;
  const largeBaseUsdText = `#usda 1.0\n${'def Mesh "part" {}\n'.repeat(80_000)}`;

  const files = [
    createLooseFile('demo_robot.usda', rootUsdText, 'robot/demo_robot.usda'),
    createLooseFile('demo_base.usda', largeBaseUsdText, 'robot/configuration/demo_base.usda'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'robot/demo_robot.usda');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/demo_robot.usda');
  assert.equal(result.preResolvedImports[0]?.result.status, 'needs_hydration');

  const rootFile = result.robotFiles.find((file) => file.name === 'robot/demo_robot.usda');
  const largeSidecarFile = result.robotFiles.find(
    (file) => file.name === 'robot/configuration/demo_base.usda',
  );

  assert.ok(rootFile, 'expected root USDA file to be present');
  assert.ok(largeSidecarFile, 'expected large USDA sidecar file to be present');
  assert.equal(rootFile?.content, rootUsdText);
  assert.equal(largeSidecarFile?.content, '');
  assert.equal(result.usdSourceFiles.length, 2);
});

test('prepareImportPayload budgets large loose USD layers as blob-backed sources', async () => {
  const reportedLargeUsdBytes = 300 * 1024 * 1024;
  const rootUsdText = `#usda 1.0
(
    defaultPrim = "demo_robot"
    subLayers = [
        @configuration/demo_base_a.usda@,
        @configuration/demo_base_b.usda@
    ]
)

def Xform "demo_robot" {}`;
  const files = [
    createLooseFile('demo_robot.usda', rootUsdText, 'unitree_ros_usda/demo/demo_robot.usda'),
    withReportedFileSize(
      createLooseFile(
        'demo_base_a.usda',
        '#usda 1.0\ndef Scope "demo_base_a" {}',
        'unitree_ros_usda/demo/configuration/demo_base_a.usda',
      ),
      reportedLargeUsdBytes,
    ),
    withReportedFileSize(
      createLooseFile(
        'demo_base_b.usda',
        '#usda 1.0\ndef Scope "demo_base_b" {}',
        'unitree_ros_usda/demo/configuration/demo_base_b.usda',
      ),
      reportedLargeUsdBytes,
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'unitree_ros_usda/demo/demo_robot.usda');
  assert.equal(result.usdSourceFiles.length, 3);
  assert.deepEqual(
    result.robotFiles
      .filter((file) => file.name.includes('/configuration/'))
      .map((file) => file.content),
    ['', ''],
  );
});

test('prepareImportPayload budgets loose URDF and MJCF mesh assets as blob-backed resources', async () => {
  const reportedLargeMeshBytes = 300 * 1024 * 1024;
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="../meshes/base_a.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'robot/urdf/demo.urdf',
    ),
    createLooseFile(
      'demo.xml',
      `<?xml version="1.0"?>
<mujoco model="demo">
  <asset>
    <mesh name="base_b" file="../meshes/base_b.stl" />
  </asset>
  <worldbody>
    <body name="base_link" />
  </worldbody>
</mujoco>`,
      'robot/mjcf/demo.xml',
    ),
    withReportedFileSize(
      createLooseFile('base_a.stl', 'solid a', 'robot/meshes/base_a.stl'),
      reportedLargeMeshBytes,
    ),
    withReportedFileSize(
      createLooseFile('base_b.stl', 'solid b', 'robot/meshes/base_b.stl'),
      reportedLargeMeshBytes,
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.deepEqual(
    result.assetFiles.map((file) => file.name).sort(),
    ['robot/meshes/base_a.stl', 'robot/meshes/base_b.stl'],
  );
  assert.ok(
    result.robotFiles.some((file) => file.name === 'robot/urdf/demo.urdf'),
    'expected URDF definition to stay in the resource library',
  );
  assert.ok(
    result.robotFiles.some((file) => file.name === 'robot/mjcf/demo.xml'),
    'expected MJCF definition to stay in the resource library',
  );
});

test('prepareImportPayload accepts loose text definitions without a total-size budget', async () => {
  const reportedLargeDefinitionBytes = 300 * 1024 * 1024;
  const files = [
    withReportedFileSize(
      createLooseFile('demo_a.urdf', '<robot name="a" />', 'robot/urdf/demo_a.urdf'),
      reportedLargeDefinitionBytes,
    ),
    withReportedFileSize(
      createLooseFile('demo_b.urdf', '<robot name="b" />', 'robot/urdf/demo_b.urdf'),
      reportedLargeDefinitionBytes,
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.deepEqual(
    result.robotFiles.map((file) => file.name).sort(),
    ['robot/urdf/demo_a.urdf', 'robot/urdf/demo_b.urdf'],
  );
});

test('prepareImportPayload fast-open mode skips pre-resolving the preferred URDF candidate', async () => {
  const files = [
    createLooseFile(
      'g1_29dof.urdf',
      `<?xml version="1.0"?>
<robot name="g1_description">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://g1_description/meshes/base_link.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'g1_description/g1_29dof.urdf',
    ),
    createLooseFile(
      'g1_29dof_with_hand.urdf',
      `<?xml version="1.0"?>
<robot name="g1_description">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://g1_description/meshes/base_link.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'g1_description/g1_29dof_with_hand.urdf',
    ),
    createLooseFile('base_link.stl', 'solid demo', 'g1_description/meshes/base_link.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'g1_description/g1_29dof.urdf');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload fast-open mode prefers MJCF over a non-self-contained URDF sidecar', async () => {
  const files = [
    createLooseFile(
      'barkour_v0.urdf',
      `<?xml version="1.0"?>
<robot name="barkour">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/body.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'google_barkour_v0/barkour_v0.urdf',
    ),
    createLooseFile(
      'barkour_v0.xml',
      `<?xml version="1.0"?>
<mujoco model="barkour v0">
  <compiler meshdir="assets" />
  <asset>
    <mesh name="body" file="body.stl" />
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="body" />
    </body>
  </worldbody>
</mujoco>`,
      'google_barkour_v0/barkour_v0.xml',
    ),
    createLooseFile('body.stl', 'solid body', 'google_barkour_v0/assets/body.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'google_barkour_v0/barkour_v0.xml');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload fast-open mode skips MJCF keyframe fragments when ranking archive roots', async () => {
  const zip = new JSZip();
  zip.file(
    'keyframes.xml',
    `<mujoco>
  <keyframe>
    <key name="home" qpos="0 0 0" />
  </keyframe>
</mujoco>`,
  );
  zip.file(
    'left_hand.xml',
    `<?xml version="1.0"?>
<mujoco model="left_shadow_hand">
  <worldbody>
    <body name="hand">
      <geom type="box" size="0.01 0.01 0.01" />
    </body>
  </worldbody>
</mujoco>`,
  );
  zip.file(
    'scene_left.xml',
    `<?xml version="1.0"?>
<mujoco model="left_shadow_hand scene">
  <include file="left_hand.xml"/>
  <worldbody>
    <light pos="0 0 1"/>
    <geom name="floor" pos="0 0 -0.1" size="0 0 0.05" type="plane"/>
  </worldbody>
</mujoco>`,
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'shadow_hand_fixture.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'left_hand.xml');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload imports custom-root MJCF include fragments from franka zip', async () => {
  const zipFile = new File(
    [fs.readFileSync('test/mujoco-franka-simulation-main.zip')],
    'mujoco-franka-simulation-main.zip',
    { type: 'application/zip' },
  );

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'mujoco-franka-simulation-main/world.xml');
  assert.deepEqual(
    result.robotFiles.map((file) => ({ name: file.name, format: file.format })),
    [
      { name: 'mujoco-franka-simulation-main/mujoco_screw.stl', format: 'mesh' },
      { name: 'mujoco-franka-simulation-main/mujoco_square_box.stl', format: 'mesh' },
      { name: 'mujoco-franka-simulation-main/panda.xml', format: 'mjcf' },
      { name: 'mujoco-franka-simulation-main/world.xml', format: 'mjcf' },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name), [
    'mujoco-franka-simulation-main/mujoco_screw.stl',
    'mujoco-franka-simulation-main/mujoco_square_box.stl',
  ]);
  assert.deepEqual(result.deferredAssetFiles, []);
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload fast-open mode prefers standalone MJCF robots over include-based scene wrappers', async () => {
  const files = [
    createLooseFile(
      'stretch.xml',
      `<?xml version="1.0"?>
<mujoco model="stretch">
  <worldbody>
    <body name="base_link">
      <geom type="box" size="0.1 0.1 0.1" />
    </body>
  </worldbody>
  <actuator>
    <motor name="lift_motor" joint="lift_joint" />
  </actuator>
</mujoco>`,
      'hello_robot_stretch/stretch.xml',
    ),
    createLooseFile(
      'scene.xml',
      `<?xml version="1.0"?>
<mujoco model="stretch scene">
  <include file="stretch.xml"/>
  <worldbody>
    <light pos="0 0 1.5"/>
    <body name="table">
      <geom type="box" size=".6 .5 .24"/>
    </body>
    <body name="object">
      <freejoint/>
      <geom type="box" size=".02 .04 .04"/>
    </body>
  </worldbody>
</mujoco>`,
      'hello_robot_stretch/scene.xml',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'hello_robot_stretch/stretch.xml');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload fast-open mode keeps a self-contained URDF preferred when a mixed bundle also ships MJCF', async () => {
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo_description">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo_description/meshes/base_link.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'demo_description/urdf/demo.urdf',
    ),
    createLooseFile(
      'demo.xml',
      `<?xml version="1.0"?>
<mujoco model="demo">
  <worldbody>
    <body name="base_link" />
  </worldbody>
</mujoco>`,
      'demo_description/xml/demo.xml',
    ),
    createLooseFile('base_link.stl', 'solid demo', 'demo_description/meshes/base_link.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'demo_description/urdf/demo.urdf');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload fast-open mode picks the root USDA file without pre-resolving it', async () => {
  const files = [
    createLooseFile(
      'go2_description.usda',
      `#usda 1.0
(
    defaultPrim = "go2_description"
)

def Xform "go2_description"
{
    prepend references = @configuration/go2_description_base.usda@
}`,
      'go2_description/urdf/go2_description.usda',
    ),
    createLooseFile(
      'go2_description_base.usda',
      `#usda 1.0
def Scope "configuration" {}`,
      'go2_description/urdf/configuration/go2_description_base.usda',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'go2_description/urdf/go2_description.usda');
  assert.deepEqual(result.preResolvedImports, []);
});

test('prepareImportPayload synthesizes a bundle root when loose robot folders arrive without their outer directory', async () => {
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo_pkg">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo_pkg/meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'urdf/demo.urdf',
    ),
    createLooseFile(
      'mjmodel.xml',
      `<?xml version="1.0"?>
<mujoco model="demo_pkg">
  <compiler meshdir="../meshes" />
  <asset>
    <mesh name="base_mesh" file="base.stl" />
  </asset>
</mujoco>`,
      'mjcf/mjmodel.xml',
    ),
    createLooseFile('base.stl', 'solid demo', 'meshes/base.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'demo_pkg/meshes/base.stl', format: 'mesh' },
      { name: 'demo_pkg/mjcf/mjmodel.xml', format: 'mjcf' },
      { name: 'demo_pkg/urdf/demo.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['demo_pkg/meshes/base.stl'],
  );
  assert.equal(result.preferredFileName, 'demo_pkg/urdf/demo.urdf');
});

test('prepareImportPayload synthesizes a bundle root for rootless gazebo zip bundles with thumbnails', async () => {
  const zip = new JSZip();
  zip.file(
    'model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/meshes/base_link.dae</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  );
  zip.file(
    'materials/scripts/demo.material',
    `material Demo/Diffuse
{
}`,
  );
  zip.file('materials/textures/demo.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('meshes/base_link.dae', '<dae />');
  zip.file('thumbnails/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY.zip', {
    type: 'application/zip',
  });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/materials/textures/demo.png',
        format: 'mesh',
      },
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/meshes/base_link.dae',
        format: 'mesh',
      },
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/model.sdf',
        format: 'sdf',
      },
      {
        name: 'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/thumbnails/preview.png',
        format: 'mesh',
      },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/meshes/base_link.dae',
  ]);
  assert.deepEqual(result.deferredAssetFiles.map((file) => file.name).sort(), [
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/materials/textures/demo.png',
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/thumbnails/preview.png',
  ]);
  assert.deepEqual([...result.textFiles].map((file) => file.path).sort(), [
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/materials/scripts/demo.material',
    // The SDF-referenced DAE is mirrored as text so authored Collada materials can be
    // extracted from it (parseColladaAuthoredMaterials reads allFileContents).
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/meshes/base_link.dae',
  ]);
  assert.equal(
    result.preferredFileName,
    'NUS_SEDS_OMNIDIRECTIONAL_GROUND_VEHICLE_VISUALS_ONLY/model.sdf',
  );
});

test('prepareImportPayload preserves explicit relativePath metadata when files are worker-cloned', async () => {
  const files: ImportPreparationFileDescriptor[] = [
    {
      file: createLooseFile('mjmodel.xml', '<mujoco model="demo_pkg" />'),
      relativePath: 'casbot mini/mjcf/mjmodel.xml',
    },
    {
      file: createLooseFile('pelvis_link.STL', 'solid demo'),
      relativePath: 'casbot mini/meshes/pelvis_link.STL',
    },
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(result.robotFiles.map((file) => file.name).sort(), [
    'casbot mini/meshes/pelvis_link.STL',
    'casbot mini/mjcf/mjmodel.xml',
  ]);
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['casbot mini/meshes/pelvis_link.STL'],
  );
});

test('prepareImportPayload preserves the imported unitree_ros folder as the asset library root', async () => {
  const files = createFixtureLooseFiles(
    path.join(process.cwd(), 'test/unitree_ros'),
    'unitree_ros',
    (relativePath) =>
      relativePath.startsWith('robots/go2_description/') ||
      relativePath.startsWith('robots/h1_description/'),
  );

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  const visiblePaths = result.robotFiles.map((file) => file.name).sort();
  const assetPaths = result.assetFiles.map((file) => file.name).sort();
  const topLevelPaths = new Set(visiblePaths.map((fileName) => fileName.split('/')[0]));

  assert.deepEqual([...topLevelPaths], ['unitree_ros']);
  assert.ok(visiblePaths.includes('unitree_ros/robots/go2_description/urdf/go2_description.urdf'));
  assert.ok(visiblePaths.includes('unitree_ros/robots/h1_description/urdf/h1.urdf'));
  assert.equal(result.preferredFileName, 'unitree_ros/robots/h1_description/mjcf/h1_with_hand.xml');
  assert.ok(assetPaths.some((fileName) => fileName.includes('/h1_description/')));
  assert.ok(assetPaths.some((fileName) => fileName.includes('/go2_description/')));
  assert.equal(visiblePaths.some((fileName) => fileName.startsWith('go2_description/')), false);
  assert.equal(visiblePaths.some((fileName) => fileName.startsWith('h1_description/')), false);
});

test('prepareImportPayload preserves the imported unitree_model folder as the asset library root', async () => {
  const files = createFixtureLooseFiles(
    path.join(process.cwd(), 'test/unitree_model'),
    'unitree_model',
    (relativePath) =>
      relativePath.startsWith('Go2/usd/') ||
      relativePath.startsWith('Go2W/usd/') ||
      relativePath.startsWith('H1-2/h1_2/'),
  );

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  const visiblePaths = result.robotFiles.map((file) => file.name).sort();
  const usdSourcePaths = result.usdSourceFiles.map((file) => file.name).sort();
  const topLevelPaths = new Set(visiblePaths.map((fileName) => fileName.split('/')[0]));

  assert.deepEqual([...topLevelPaths], ['unitree_model']);
  assert.equal(result.preferredFileName, 'unitree_model/Go2/usd/go2.viewer_roundtrip.usd');
  assert.ok(visiblePaths.includes('unitree_model/Go2/usd/go2.usd'));
  assert.ok(usdSourcePaths.includes('unitree_model/Go2/usd/configuration/go2_description_base.usd'));
  assert.ok(visiblePaths.some((fileName) => fileName.includes('/Go2W/')));
  assert.ok(visiblePaths.some((fileName) => fileName.includes('/H1-2/')));
  assert.equal(visiblePaths.some((fileName) => fileName.startsWith('Go2/')), false);
  assert.equal(visiblePaths.some((fileName) => fileName.startsWith('H1-2/')), false);
});

test('prepareImportPayload eagerly hydrates MJCF deferred textures required by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/bin.xml',
    `<?xml version="1.0"?>
<mujoco model="demo_bin">
  <asset>
    <mesh name="bin_mesh" file="meshes/bin.stl" />
    <texture name="bin_texture" type="2d" file="../demo/common/textures/metal0.png" />
    <material name="bin_material" texture="bin_texture" />
  </asset>
  <worldbody>
    <body name="bin_body">
      <geom type="mesh" mesh="bin_mesh" material="bin_material" />
    </body>
  </worldbody>
</mujoco>`,
  );
  zip.file('demo/meshes/bin.stl', 'solid demo');
  zip.file('demo/common/textures/metal0.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('demo/thumbnails/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/bin.xml');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/common/textures/metal0.png',
    'demo/meshes/bin.stl',
  ]);
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    ['demo/thumbnails/preview.png'],
  );
});

test('prepareImportPayload eagerly hydrates URDF deferred textures referenced by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/robot.urdf',
    `<?xml version="1.0"?>
<robot name="demo_robot">
  <material name="painted">
    <texture filename="textures/paint.png" />
  </material>
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/base.stl" />
      </geometry>
      <material name="painted" />
    </visual>
  </link>
</robot>`,
  );
  zip.file('demo/meshes/base.stl', 'solid demo');
  zip.file('demo/textures/paint.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('demo/docs/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/robot.urdf');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/meshes/base.stl',
    'demo/textures/paint.png',
  ]);
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    ['demo/docs/preview.png'],
  );
});

test('prepareImportPayload eagerly hydrates SDF gazebo material script textures required by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/model.sdf',
    `<?xml version="1.0"?>
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
  );
  zip.file(
    'demo/materials/scripts/demo.material',
    `material Demo/Painted
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
  );
  zip.file('demo/meshes/base_link.dae', '<dae />');
  zip.file('demo/materials/textures/coat.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('demo/docs/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/model.sdf');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/materials/textures/coat.png',
    'demo/meshes/base_link.dae',
  ]);
  assert.deepEqual([...result.textFiles].map((file) => file.path).sort(), [
    'demo/materials/scripts/demo.material',
    'demo/meshes/base_link.dae',
  ]);
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    ['demo/docs/preview.png'],
  );
});

test('prepareImportPayload eagerly hydrates SDF OBJ sidecar textures required by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'ambulance/model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="ambulance">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://ambulance/meshes/ambulance.obj</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
  );
  zip.file(
    'ambulance/meshes/ambulance.obj',
    `mtllib ambulance.mtl
usemtl Ambulance
o AmbulanceBody`,
  );
  zip.file(
    'ambulance/meshes/ambulance.mtl',
    `newmtl Ambulance
map_Kd ambulance.png`,
  );
  zip.file('ambulance/materials/textures/ambulance.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('ambulance/docs/preview.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'ambulance.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'ambulance/model.sdf');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'ambulance/materials/textures/ambulance.png',
    'ambulance/meshes/ambulance.mtl',
    'ambulance/meshes/ambulance.obj',
  ]);
  assert.deepEqual(result.textFiles.map((file) => file.path).sort(), [
    'ambulance/meshes/ambulance.mtl',
    'ambulance/meshes/ambulance.obj',
  ]);
  assert.deepEqual(
    result.deferredAssetFiles.map((file) => file.name),
    ['ambulance/docs/preview.png'],
  );
});

test('prepareImportPayload eagerly hydrates DAE external textures referenced by the preferred model', async () => {
  const zip = new JSZip();
  zip.file(
    'robot/model.urdf',
    `<?xml version="1.0"?>
<robot name="r">
  <link name="base_link">
    <visual>
      <geometry><mesh filename="meshes/base.dae" /></geometry>
    </visual>
  </link>
</robot>`,
  );
  zip.file(
    'robot/meshes/base.dae',
    `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <library_images>
    <image id="tex0" name="tex0"><init_from>../textures/base_color.png</init_from></image>
  </library_images>
  <library_effects>
    <effect id="fx0"><profile_COMMON>
      <newparam sid="s0"><surface type="2D"><init_from>tex0</init_from></surface></newparam>
    </profile_COMMON></effect>
  </library_effects>
</COLLADA>`,
  );
  zip.file('robot/textures/base_color.png', new Uint8Array([137, 80, 78, 71]));
  zip.file('robot/docs/unused.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'robot.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.ok(
    result.assetFiles.some((file) => file.name === 'robot/textures/base_color.png'),
    'expected the DAE-referenced texture to be hydrated into assetFiles',
  );
  assert.equal(
    result.assetFiles.some((file) => file.name === 'robot/docs/unused.png'),
    false,
    'an unreferenced image should remain deferred',
  );
});

test('prepareImportPayload does not heuristically mirror SDF OBJ sidecars from malformed XML', async () => {
  const files = [
    createLooseFile(
      'model.sdf',
      [
        '<?xml version="1.0"?>',
        '<sdf version="1.7>',
        '  <model name="ambulance">',
        '    <link name="base_link">',
        '      <visual name="body">',
        '        <geometry>',
        '          <mesh>',
        '            <uri>model://ambulance/meshes/ambulance.obj</uri>',
      ].join('\n'),
      'ambulance/model.sdf',
    ),
    createLooseFile(
      'ambulance.obj',
      ['mtllib ambulance.mtl', 'usemtl Ambulance', 'o AmbulanceBody'].join('\n'),
      'ambulance/meshes/ambulance.obj',
    ),
    createLooseFile('ambulance.mtl', 'newmtl Ambulance', 'ambulance/meshes/ambulance.mtl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'ambulance/model.sdf');
  assert.equal(
    result.textFiles.some((file) => file.path === 'ambulance/meshes/ambulance.obj'),
    false,
  );
  assert.deepEqual(result.textFiles, [
    { path: 'ambulance/meshes/ambulance.mtl', content: 'newmtl Ambulance' },
  ]);
});

test('prepareImportPayload logs XML probe exceptions without throwing from SDF preparation', async () => {
  const originalDomParser = globalThis.DOMParser;
  const originalConsoleError = console.error;
  const originalNodeEnv = process.env.NODE_ENV;
  const consoleErrors: unknown[][] = [];

  process.env.NODE_ENV = 'production';
  class ThrowingDomParser {
    parseFromString(): Document {
      throw new Error('DOM parser probe failed');
    }
  }

  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    writable: true,
    value: ThrowingDomParser as unknown as typeof DOMParser,
  });
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };

  try {
    const result = await prepareImportPayload({
      files: [
        createLooseFile(
          'model.sdf',
          `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="ambulance">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://ambulance/meshes/ambulance.obj</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
          'ambulance/model.sdf',
        ),
        createLooseFile(
          'ambulance.obj',
          ['mtllib ambulance.mtl', 'usemtl Ambulance', 'o AmbulanceBody'].join('\n'),
          'ambulance/meshes/ambulance.obj',
        ),
        createLooseFile('ambulance.mtl', 'newmtl Ambulance', 'ambulance/meshes/ambulance.mtl'),
      ],
      existingPaths: [],
      preResolvePreferredImport: false,
    });

    assert.equal(result.preferredFileName, 'ambulance/model.sdf');
    assert.equal(
      result.textFiles.some((file) => file.path === 'ambulance/meshes/ambulance.obj'),
      false,
    );
    assert.equal(
      consoleErrors.some(([scope]) =>
        String(scope).includes('[importPreparation:canParseXmlDocumentStrict]'),
      ),
      true,
      'expected XML probe failure to be logged through runtime diagnostics',
    );
  } finally {
    console.error = originalConsoleError;
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalDomParser) {
      globalThis.DOMParser = originalDomParser;
    } else {
      Reflect.deleteProperty(globalThis, 'DOMParser');
    }
  }
});

test('prepareImportPayload keeps referenced SDF OBJ material sidecars blob-backed for loose folder imports', async () => {
  const files = [
    createLooseFile(
      'model.sdf',
      `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="ambulance">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://ambulance/meshes/ambulance.obj</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
      'ambulance/model.sdf',
    ),
    createLooseFile(
      'ambulance.obj',
      `mtllib ambulance.mtl
usemtl Ambulance
o AmbulanceBody`,
      'ambulance/meshes/ambulance.obj',
    ),
    createLooseFile(
      'ambulance.mtl',
      `newmtl Ambulance
map_Kd ambulance.png`,
      'ambulance/meshes/ambulance.mtl',
    ),
    createLooseFile(
      'ambulance.png',
      new Uint8Array([137, 80, 78, 71]),
      'ambulance/materials/textures/ambulance.png',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'ambulance/model.sdf');
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'ambulance/materials/textures/ambulance.png',
    'ambulance/meshes/ambulance.mtl',
    'ambulance/meshes/ambulance.obj',
  ]);
  assert.deepEqual(result.textFiles.map((file) => file.path).sort(), [
    'ambulance/meshes/ambulance.mtl',
    'ambulance/meshes/ambulance.obj',
  ]);
});

test('prepareImportPayload prefixes rootless ROS package contents using package asset roots', async () => {
  const files = [
    createLooseFile(
      'valkyrie_sim.urdf',
      `<?xml version="1.0"?>
<robot name="valkyrie">
  <link name="pelvis">
    <visual>
      <geometry>
        <mesh filename="package://val_description/model/meshes/pelvis/pelvis.dae" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'robots/valkyrie_sim.urdf',
    ),
    createLooseFile('pelvis.dae', '<dae />', 'meshes/pelvis/pelvis.dae'),
    createLooseFile(
      'pelvistexture.png',
      new Uint8Array([137, 80, 78, 71]),
      'materials/textures/pelvistexture.png',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'val_description/model/materials/textures/pelvistexture.png', format: 'mesh' },
      { name: 'val_description/model/meshes/pelvis/pelvis.dae', format: 'mesh' },
      { name: 'val_description/model/robots/valkyrie_sim.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'val_description/model/materials/textures/pelvistexture.png',
    'val_description/model/meshes/pelvis/pelvis.dae',
  ]);
  assert.equal(result.preferredFileName, 'val_description/model/robots/valkyrie_sim.urdf');
});

test('prepareImportPayload prefixes rootless package assets when only the package-dependent definition sits at the root', async () => {
  const files = [
    createLooseFile(
      'robot.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo_pkg/meshes/base.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'robot.urdf',
    ),
    createLooseFile('base.stl', 'solid demo', 'meshes/base.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'demo_pkg/meshes/base.stl', format: 'mesh' },
      { name: 'demo_pkg/robot.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['demo_pkg/meshes/base.stl'],
  );
});

test('prepareImportPayload keeps package-rooted assets stable when the referenced package root is already present', async () => {
  const files = [
    createLooseFile(
      'robot.urdf',
      `<?xml version="1.0"?>
<robot name="sigmaban2019_urdf">
  <link name="tronc">
    <visual>
      <geometry>
        <mesh filename="package://assets/merged/tronc_visual.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'robot.urdf',
    ),
    createLooseFile('tronc_visual.stl', 'solid tronc', 'assets/merged/tronc_visual.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'assets/merged/tronc_visual.stl', format: 'mesh' },
      { name: 'robot.urdf', format: 'urdf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['assets/merged/tronc_visual.stl'],
  );
});

test('prepareImportPayload prefers MJCF when a mixed MuJoCo folder ships an export-only URDF sidecar', async () => {
  const files = [
    createLooseFile(
      'barkour_v0.urdf',
      `<?xml version="1.0"?>
<robot name="barkour">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/body.stl" />
      </geometry>
    </visual>
  </link>
</robot>`,
      'google_barkour_v0/barkour_v0.urdf',
    ),
    createLooseFile(
      'barkour_v0.xml',
      `<?xml version="1.0"?>
<mujoco model="barkour v0">
  <compiler meshdir="assets" />
  <asset>
    <mesh name="body" file="body.stl" />
  </asset>
  <worldbody>
    <body name="base_link">
      <geom type="mesh" mesh="body" />
    </body>
  </worldbody>
</mujoco>`,
      'google_barkour_v0/barkour_v0.xml',
    ),
    createLooseFile('body.stl', 'solid body', 'google_barkour_v0/assets/body.stl'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'google_barkour_v0/assets/body.stl', format: 'mesh' },
      { name: 'google_barkour_v0/barkour_v0.urdf', format: 'urdf' },
      { name: 'google_barkour_v0/barkour_v0.xml', format: 'mjcf' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['google_barkour_v0/assets/body.stl'],
  );
  assert.equal(result.preferredFileName, 'google_barkour_v0/barkour_v0.xml');
});

test('prepareImportPayload pre-resolves standalone urdf imports for immediate loading', async () => {
  const files = [
    createLooseFile(
      'demo.xml',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'robot/demo.xml',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.robotFiles.length, 1);
  assert.equal(result.robotFiles[0]?.format, 'urdf');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/demo.xml');
  assert.equal(result.preResolvedImports[0]?.format, 'urdf');
  assert.equal(
    result.preResolvedImports[0]?.contentSignature,
    buildPreResolvedImportContentSignature(await files[0]!.text()),
  );
  assert.equal(result.preResolvedImports[0]?.result.status, 'ready');
  if (result.preResolvedImports[0]?.result.status !== 'ready') {
    assert.fail('Expected pre-resolved URDF import result to be ready');
  }
  assert.equal(result.preResolvedImports[0].result.robotData.name, 'demo');
  assert.equal(result.preResolvedImports[0].result.robotData.rootLinkId, 'base_link');
  assert.equal(result.preResolvedImports[0].result.resolvedUrdfSourceFilePath, null);
});

test('prepareImportPayload pre-resolves only the preferred robot file to keep worker responses compact', async () => {
  const files = [
    createLooseFile(
      'primary.urdf',
      `<?xml version="1.0"?>
<robot name="primary">
  <link name="base_link" />
</robot>`,
      'robot/primary.urdf',
    ),
    createLooseFile(
      'secondary.urdf',
      `<?xml version="1.0"?>
<robot name="secondary">
  <link name="secondary_link" />
</robot>`,
      'robot/secondary.urdf',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'robot/primary.urdf');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/primary.urdf');
  assert.equal(result.preResolvedImports[0]?.format, 'urdf');
});

test('prepareImportPayload pre-resolves preferred mjcf imports for immediate loading', async () => {
  const files = [
    createLooseFile(
      'mjmodel.xml',
      `<?xml version="1.0"?>
<mujoco model="demo_mjcf">
  <worldbody>
    <body name="base">
      <geom type="box" size="0.1 0.1 0.1" />
    </body>
  </worldbody>
</mujoco>`,
      'robot/mjcf/mjmodel.xml',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'robot/mjcf/mjmodel.xml');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/mjcf/mjmodel.xml');
  assert.equal(result.preResolvedImports[0]?.format, 'mjcf');
  assert.equal(result.preResolvedImports[0]?.result.status, 'ready');
  if (result.preResolvedImports[0]?.result.status !== 'ready') {
    assert.fail('Expected pre-resolved MJCF import result to be ready');
  }
  assert.equal(result.preResolvedImports[0].result.robotData.name, 'demo_mjcf');
});

test('prepareImportPayload pre-resolves xacro imports with package-local includes', async () => {
  const files = [
    createLooseFile(
      'robot.xacro',
      `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo_xacro">
  <xacro:include filename="parts/link.xacro" />
</robot>`,
      'demo_pkg/xacro/robot.xacro',
    ),
    createLooseFile(
      'link.xacro',
      `<robot name="included_links">
  <link name="base_link" />
</robot>`,
      'demo_pkg/xacro/parts/link.xacro',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  const rootEntry = result.preResolvedImports.find(
    (entry) => entry.fileName === 'demo_pkg/xacro/robot.xacro',
  );
  assert.ok(rootEntry, 'Expected root xacro import to be pre-resolved');
  assert.equal(result.preResolvedImports.filter((entry) => entry.format === 'xacro').length, 1);
  assert.equal(rootEntry?.format, 'xacro');
  assert.equal(rootEntry?.result.status, 'ready');
  if (!rootEntry || rootEntry.result.status !== 'ready') {
    assert.fail('Expected pre-resolved xacro import result to be ready');
  }
  assert.equal(rootEntry.result.robotData.name, 'demo_xacro');
  assert.equal(rootEntry.result.robotData.rootLinkId, 'base_link');
  assert.equal(rootEntry.result.resolvedUrdfSourceFilePath, 'demo_pkg/xacro/robot.xacro');
});

test('prepareImportPayload pre-resolves preferred usd imports as hydration-ready placeholders', async () => {
  const usdText = `#usda 1.0
def Xform "robot"
{
}`;
  const files = [createLooseFile('scene.usd', usdText, 'scene/scene.usd')];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'scene/scene.usd');
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'scene/scene.usd');
  assert.equal(result.preResolvedImports[0]?.format, 'usd');
  assert.equal(result.preResolvedImports[0]?.result.status, 'needs_hydration');
});

test('prepareImportPayload classifies sdf bundles as robot definition files', async () => {
  const files = [
    createLooseFile(
      'model.sdf',
      `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="bus_stop">
    <link name="base_link">
      <visual name="body">
        <geometry>
          <mesh>
            <uri>model://bus_stop/meshes/base_link.dae</uri>
          </mesh>
        </geometry>
      </visual>
    </link>
  </model>
</sdf>`,
      'bus_stop/model.sdf',
    ),
    createLooseFile('base_link.dae', '<dae />', 'bus_stop/meshes/base_link.dae'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'bus_stop/meshes/base_link.dae', format: 'mesh' },
      { name: 'bus_stop/model.sdf', format: 'sdf' },
    ],
  );
});

test('prepareImportPayload keeps gazebo material scripts as auxiliary text files', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/model.sdf',
    `<?xml version="1.0"?>
<sdf version="1.7">
  <model name="demo">
    <link name="base_link" />
  </model>
</sdf>`,
  );
  zip.file(
    'demo/materials/scripts/demo.material',
    `material Demo/Diffuse
{
  technique
  {
    pass
    {
      texture_unit
      {
        texture demo.png
      }
    }
  }
}`,
  );
  zip.file('demo/materials/textures/demo.png', new Uint8Array([137, 80, 78, 71]));

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['demo/materials/scripts/demo.material'],
  );
  assert.deepEqual(result.assetFiles.map((file) => file.name).sort(), [
    'demo/materials/textures/demo.png',
  ]);
});

test('prepareImportPayload keeps xacro gazebo sidecars as auxiliary text files', async () => {
  const zip = new JSZip();
  zip.file(
    'demo_pkg/xacro/robot.xacro',
    `<robot xmlns:xacro="http://www.ros.org/wiki/xacro" name="demo_pkg">
  <xacro:include filename="$(find demo_pkg)/urdf/demo.gazebo" />
  <link name="base_link" />
</robot>`,
  );
  zip.file(
    'demo_pkg/urdf/demo.gazebo',
    `<gazebo reference="base_link">
  <material>Gazebo/Orange</material>
</gazebo>`,
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo_pkg/xacro/robot.xacro');
  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['demo_pkg/urdf/demo.gazebo'],
  );
});

test('prepareImportPayload keeps SRDF sidecars for URDF zip bundles', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/robot.urdf',
    `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
  );
  zip.file(
    'demo/config/robot.srdf',
    `<robot name="demo">
  <group name="arm" />
</robot>`,
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/robot.urdf');
  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['demo/config/robot.srdf'],
  );
});

test('prepareImportPayload keeps SRDF sidecars for loose URDF folder imports', async () => {
  const files = [
    createLooseFile(
      'robot.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'demo/robot.urdf',
    ),
    createLooseFile(
      'robot.srdf',
      `<robot name="demo">
  <group name="arm" />
</robot>`,
      'demo/config/robot.srdf',
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.equal(result.preferredFileName, 'demo/robot.urdf');
  assert.deepEqual(
    result.textFiles.map((file) => file.path),
    ['demo/config/robot.srdf'],
  );
});

test('prepareImportPayload keeps gazebo material sidecars for usd-only bundles in the asset library', async () => {
  const zip = new JSZip();
  zip.file(
    'demo/scene.usda',
    `#usda 1.0
(
    defaultPrim = "demo"
)

def Xform "demo"
{
}`,
  );
  zip.file(
    'demo/materials/scripts/demo.material',
    `material Demo/Diffuse
{
}`,
  );

  const zipBytes = await zip.generateAsync({ type: 'uint8array' });
  const zipFile = new File([zipBytes], 'bundle.zip', { type: 'application/zip' });

  const result = await prepareImportPayload({
    files: [zipFile],
    existingPaths: [],
  });

  assert.deepEqual(result.textFiles, [
    {
      path: 'demo/materials/scripts/demo.material',
      content: `material Demo/Diffuse
{
}`,
    },
  ]);
  assert.equal(result.preferredFileName, 'demo/scene.usda');
});

test('prepareImportPayload drops unsupported loose files from the visible asset library', async () => {
  const files = [
    createLooseFile(
      'demo.urdf',
      `<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link" />
</robot>`,
      'robot/demo.urdf',
    ),
    createLooseFile('README.md', '# Demo robot', 'robot/README.md'),
    createLooseFile('LICENSE', 'Apache-2.0', 'robot/LICENSE'),
    createLooseFile('payload.dat', new Uint8Array([1, 2, 3, 4]), 'robot/raw/payload.dat'),
    createLooseFile('preview.png', new Uint8Array([137, 80, 78, 71]), 'robot/docs/preview.png'),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
  });

  assert.deepEqual(
    result.robotFiles
      .map((file) => ({ name: file.name, format: file.format }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [
      { name: 'robot/demo.urdf', format: 'urdf' },
      { name: 'robot/docs/preview.png', format: 'mesh' },
    ],
  );
  assert.deepEqual(
    result.assetFiles.map((file) => file.name),
    ['robot/docs/preview.png'],
  );
  assert.deepEqual(result.textFiles, []);
  assert.equal(result.preResolvedImports.length, 1);
  assert.equal(result.preResolvedImports[0]?.fileName, 'robot/demo.urdf');
});

test('prepareImportPayload accepts broad loose folder imports without a file-count cap', async () => {
  const files = [
    createLooseFile(
      'scene.xml',
      `<mujoco model="demo">
  <worldbody>
    <body name="base" />
  </worldbody>
</mujoco>`,
      'mujoco_menagerie-main/demo/scene.xml',
    ),
    ...Array.from({ length: 2142 }, (_, index) =>
      createLooseFile(
        `mesh-${index}.stl`,
        '',
        `mujoco_menagerie-main/demo/assets/mesh-${index}.stl`,
      ),
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'mujoco_menagerie-main/demo/scene.xml');
  assert.equal(result.assetFiles.length, 2142);
  assert.equal(
    result.robotFiles.some((file) => file.name === 'mujoco_menagerie-main/demo/scene.xml'),
    true,
  );
});

test('prepareImportPayload accepts broad loose folder imports with unreferenced large OBJ assets', async () => {
  const reportedObjBytes = 8 * 1024 * 1024;
  const files = [
    createLooseFile(
      'scene.xml',
      `<mujoco model="demo">
  <worldbody>
    <body name="base" />
  </worldbody>
</mujoco>`,
      'mujoco_menagerie-main/demo/scene.xml',
    ),
    ...Array.from({ length: 70 }, (_, index) =>
      withReportedFileSize(
        createLooseFile(
          `mesh-${index}.obj`,
          '',
          `mujoco_menagerie-main/other_robot/assets/mesh-${index}.obj`,
        ),
        reportedObjBytes,
      ),
    ),
  ];

  const result = await prepareImportPayload({
    files,
    existingPaths: [],
    preResolvePreferredImport: false,
  });

  assert.equal(result.preferredFileName, 'mujoco_menagerie-main/demo/scene.xml');
  assert.equal(result.assetFiles.length, 70);
  assert.equal(result.textFiles.length, 0);
});
