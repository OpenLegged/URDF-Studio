import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const webSyncDriverPath = fileURLToPath(
  new URL(
    '../../../../third_party/OpenUSD/pxr/usdImaging/hdEmscripten/webSyncDriver.h',
    import.meta.url,
  ),
);

test('HdWebSyncDriver sensor-skipping stage open reuses the LoadNone stage when no sensor payload is skipped', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');

  assert.doesNotMatch(
    source,
    /if\s*\(\s*!skippedSensorPayload\s*\)\s*{\s*return\s+UsdStage::Open\(usdFilePath\);\s*}/,
  );
  assert.match(
    source,
    /if\s*\(\s*!loadSet\.empty\(\)\s*\)\s*{\s*stage->LoadAndUnload\(loadSet,\s*SdfPathSet\(\),\s*UsdLoadWithDescendants\);/,
  );
});

test('HdWebSyncDriver exposes a versioned full-load payload for one-shot TS hydration', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');

  assert.match(source, /emscripten::val\s+GetFullLoadPayload\s*\(/);
  assert.match(source, /payload\.set\("format",\s*std::string\("usd-full-load-payload-v1"\)\);/);
  assert.match(source, /GetRobotSceneSnapshotBlob\(runtimeLinkPaths,\s*stageSourcePath\)/);
});

test('HdWebSyncDriver projects common OmniPBR texture aliases into snapshot materials', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');

  assert.match(
    source,
    /setTexture\("mapPath",\s*\{[\s\S]*?"inputs:diffuse_texture"[\s\S]*?\}\);/,
  );
  assert.match(
    source,
    /setTexture\("roughnessMapPath",\s*\{[\s\S]*?"inputs:reflectionroughness_texture"[\s\S]*?\}\);/,
  );
  assert.match(
    source,
    /_PrimHasAuthoredTexturePath[\s\S]*?"inputs:diffuse_texture"[\s\S]*?"inputs:reflectionroughness_texture"/,
  );
});
