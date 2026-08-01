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

test('HdWebSyncDriver direct snapshot traverses ordinary USD scene geometry', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');

  assert.match(source, /UsdPrimRange::Stage\(_stage,\s*predicate\)/);
  assert.match(source, /imageable\.ComputeVisibility\(timeCode\)/);
  assert.match(source, /_PrimHasEnabledCollision\(prim,\s*timeCode\)/);
  assert.match(
    source,
    /useCollisionSection\s*\?\s*"collisions"\s*:\s*"visuals"/,
  );
  assert.match(
    source,
    /promoteCollisionFallbackToVisual[\s\S]*?collisionSemantic\s*&&\s*!promoteCollisionFallbackToVisual/,
  );
  assert.match(source, /syntheticContainerPath[\s\S]*?\.proto_/);
  assert.match(source, /setTexture\("mapPath",\s*{\s*"inputs:diffuse_texture"/);
});

test('HdWebSyncDriver covers Isaac Sim texture inputs and packed ORM channels', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');
  const requiredTextureInputs = [
    'inputs:reflectionroughness_texture',
    'inputs:emissive_mask_texture',
    'inputs:detail_normalmap_texture',
    'inputs:ORM_texture',
  ];

  for (const textureInput of requiredTextureInputs) {
    const occurrences = source.match(new RegExp(textureInput, 'g'))?.length ?? 0;
    assert.ok(occurrences >= 2, `${textureInput} must be in setTexture and authored-path candidates`);
  }
  assert.match(source, /inputs:enable_ORM_texture/);
  assert.match(
    source,
    /setTexture\("roughnessMapPath",\s*\{[\s\S]*?"inputs:ORM_texture"/,
  );
  assert.match(
    source,
    /setTexture\("metalnessMapPath",\s*\{[\s\S]*?"inputs:ORM_texture"/,
  );
  assert.match(
    source,
    /setTexture\("aoMapPath",\s*\{[\s\S]*?"inputs:ORM_texture"/,
  );
});

test('HdWebSyncDriver promotes collision fallback geometry into both scene channels', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');

  assert.match(
    source,
    /if\s*\(promoteCollisionFallbackToVisual\s*&&\s*collisionSemantic\)[\s\S]*?appendGenericDescriptor\(\s*linkPath,\s*"visuals"[\s\S]*?appendGenericDescriptor\(\s*linkPath,\s*"collisions"/,
  );
  assert.match(
    source,
    /auto appendGenericDescriptor[\s\S]*?genericIndexKey[\s\S]*?directStageMeshIds\.insert\(meshId\)/,
  );
  assert.match(
    source,
    /else\s*\{\s*const std::string sectionName\s*=\s*useCollisionSection\s*\?\s*"collisions"\s*:\s*"visuals"[\s\S]*?appendGenericDescriptor\(/,
  );
});

test('HdWebSyncDriver persists non-empty Points and tessellated BasisCurves in scene snapshots', () => {
  const source = readFileSync(webSyncDriverPath, 'utf8');

  assert.match(source, /UsdGeomPoints\(prim\)\) return "points"/);
  assert.match(source, /UsdGeomBasisCurves\(prim\)\) return "basiscurves"/);
  assert.match(source, /_BuildPointBasedPayloadRecordFromPrim\s*\(/);
  assert.match(source, /kCurveSubdivisions\s*=\s*12/);
  assert.match(source, /primType == "points" \|\| primType == "basiscurves"/);
});
