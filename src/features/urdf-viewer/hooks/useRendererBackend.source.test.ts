import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const robotModelSourceUrl = new URL('../../../shared/components/3d/robot/components/RobotModelKernel.tsx', import.meta.url);
const useRendererBackendSourceUrl = new URL('../../../shared/components/3d/robot/hooks/useRendererBackend.ts', import.meta.url);

test('renderer backend path forwards URDF XML fallback policy to backend.load', async () => {
  const [robotModelSource, hookSource] = await Promise.all([
    readFile(robotModelSourceUrl, 'utf8'),
    readFile(useRendererBackendSourceUrl, 'utf8'),
  ]);

  assert.match(robotModelSource, /allowUrdfXmlFallback\s*=\s*false/);
  assert.match(robotModelSource, /useRendererBackend\(\{[\s\S]*allowUrdfXmlFallback,/);
  assert.match(hookSource, /allowUrdfXmlFallback\s*=\s*false/);
  assert.match(
    hookSource,
    /createMemoizedRendererBackendLoadScopeKey\([\s\S]*\{[\s\S]*allowUrdfXmlFallback,/,
  );
  assert.match(hookSource, /latestScenePropsRef\.current\s*=\s*\{[\s\S]*allowUrdfXmlFallback,/);
});
