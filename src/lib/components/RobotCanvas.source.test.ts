import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const robotCanvasSourceUrl = new URL('./RobotCanvas.tsx', import.meta.url);
const robotCanvasViewportSourceUrl = new URL('./RobotCanvasViewport.tsx', import.meta.url);
const robotCanvasTypesUrl = new URL('../types.ts', import.meta.url);

test('RobotCanvas keeps raw URDF XML fallback enabled for public source content by default', async () => {
  const [componentSource, typesSource] = await Promise.all([
    readFile(robotCanvasSourceUrl, 'utf8'),
    readFile(robotCanvasTypesUrl, 'utf8'),
  ]);

  assert.match(typesSource, /allowUrdfXmlFallback\?: boolean;/);
  assert.match(componentSource, /allowUrdfXmlFallback\s*=\s*true/);
  assert.match(componentSource, /<RobotModel[\s\S]*allowUrdfXmlFallback=\{allowUrdfXmlFallback\}/);
});

test('RobotCanvas viewport does not depend on the app workspace store', async () => {
  const [componentSource, viewportSource] = await Promise.all([
    readFile(robotCanvasSourceUrl, 'utf8'),
    readFile(robotCanvasViewportSourceUrl, 'utf8'),
  ]);

  assert.doesNotMatch(componentSource, /features\/urdf-viewer\/components\/ViewerCanvas/);
  assert.match(componentSource, /\.\/RobotCanvasViewport/);
  assert.doesNotMatch(viewportSource, /@\/store|robotGroundPlaneInvalidation/);
});
