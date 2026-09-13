import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const files = [
  new URL('../components/RobotModel.tsx', import.meta.url),
  new URL('../components/ViewerScene.tsx', import.meta.url),
  new URL('../../../shared/components/3d/robot/hooks/useMouseInteraction.ts', import.meta.url),
  new URL('../hooks/useRobotLoader.ts', import.meta.url),
  new URL('../hooks/useViewerController.ts', import.meta.url),
  new URL('../../../shared/components/3d/robot/utils/activeJointSelection.ts', import.meta.url),
  new URL('../../../shared/components/3d/robot/utils/robotLoaderGeometryPatch.ts', import.meta.url),
  new URL('../../../lib/components/RobotCanvas.tsx', import.meta.url),
];

test('viewer and package entrypoints import shared/core helper implementations directly', async () => {
  for (const fileUrl of files) {
    const source = await readFile(fileUrl, 'utf8');

    assert.doesNotMatch(
      source,
      /['"](?:\.\/(?:jointTypes|robotLoaderSourceMetadata|robotPositioning|sourceFormat)|(?:\.\.?\/)+utils\/(?:jointTypes|robotLoaderSourceMetadata|robotPositioning|sourceFormat)|@\/features\/urdf-viewer\/utils\/(?:jointTypes|robotLoaderSourceMetadata|robotPositioning|sourceFormat))['"]/,
    );
    assert.doesNotMatch(source, /createViewerMeshLoader/);
  }
});

test('viewer runtime does not import the MJCF-specific Three.js loader', async () => {
  const runtimeFiles = [
    new URL('../hooks/useRobotLoader.ts', import.meta.url),
    new URL('../../../shared/components/3d/robot/renderers/ThreeJsBackend.ts', import.meta.url),
  ];

  for (const fileUrl of runtimeFiles) {
    const source = await readFile(fileUrl, 'utf8');

    assert.doesNotMatch(source, /loadMJCFToThreeJS/);
    assert.doesNotMatch(source, /['"]@\/core\/parsers\/mjcf['"]/);
  }
});
