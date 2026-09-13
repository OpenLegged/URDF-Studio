import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, 'usd-loader.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const parsed = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const executable = parsed.statements.filter((statement) => !ts.isImportDeclaration(statement)).map((statement) => statement.getText(parsed).replace(/^export /, '')).join('\n');

async function load({ native, failedCount = 0, candidateCount = 29, unsupportedInstanceCount = 0 } = {}) {
  const calls = { rootExport: 0, legacyRepair: 0, fallbackRepair: 0, writes: 0, openedPaths: [] };
  let active = true;
  const fakeLayer = { ExportToString() { calls.rootExport++; return '#usda 1.0\ndef Mesh "m" { rel material:binding = </mat> }'; }, delete() {} };
  class Delegate {
    constructor(options) { Object.assign(this, options); }
    repairMaterialBindingApiSchemasInLayerText(text) { calls.legacyRepair++; return { changed: true, count: 1, text: `${text}\n# repaired` }; }
    tryRepairMaterialBindingApiSchemas() {
      if (!this._materialBindingSchemaRepairAttempted) calls.fallbackRepair++;
      active = false; // Stop immediately after material readiness; no fake geometry pass.
    }
  }
  class Driver {
    constructor(_delegate, openedPath) { calls.openedPaths.push(openedPath); }
    GetStage() { return {}; }
  }
  if (native) Driver.prototype.GetMaterialBindingRepairProfile = () => ({ attempted: true, candidateCount, repairedCount: candidateCount - failedCount, failedCount, unsupportedInstanceCount });
  const USD = {
    HdWebSyncDriver: Driver,
    SdfLayer: { FindOrOpen() { return fakeLayer; } },
    FS_createPath() {}, FS_createDataFile() { calls.writes++; }, FS_unlink() {},
  };
  const window = { usdRoot: {}, USD };
  const context = vm.createContext({
    window, navigator: { hardwareConcurrency: 4 }, URLSearchParams, TextEncoder, Uint8Array, ArrayBuffer, console, performance, setTimeout, clearTimeout,
    ThreeRenderDelegateInterface: Delegate,
    parseBooleanFlag: (value, fallback) => value === null ? fallback : value === '1',
    normalizeUsdPath: (value) => value,
    inferDependencyStemForUsdPath: () => null,
    isLikelyNonRenderableUsdConfig: () => false,
    getDirectoryFromVirtualPath: (value) => path.dirname(value),
    applyStageMetersPerUnitToRoot() {},
  });
  vm.runInContext(executable, context);
  const state = await context.loadUsdStage({
    USD, usdFsHelper: { hasVirtualFilePath: () => true, getAllLoadedFiles: () => [], trackVirtualFilePath() {}, untrackVirtualFilePath() {} },
    pathToLoad: '/asset.usdc', displayName: 'asset.usdc', showLoadUi: false,
    params: new URLSearchParams({ yieldDuringLoad: '0', autoLoadDependencies: '0', dependenciesPreloadedToVirtualFs: '1' }),
    isLoadActive: () => active, onResolvedFilename() {}, onProgress() {}, applyMeshFilters() {}, rebuildLinkAxes() {}, renderFrame() {},
  });
  return { calls, state, delegate: window.renderInterface };
}

test('native schema repair opens the original binary without exporting or rewriting its layer', async () => {
  const { calls, state, delegate } = await load({ native: true });
  assert.equal(calls.rootExport, 0);
  assert.equal(calls.legacyRepair, 0);
  assert.equal(calls.fallbackRepair, 0);
  assert.equal(calls.writes, 0);
  assert.deepEqual(calls.openedPaths, ['/asset.usdc']);
  assert.equal(delegate._materialBindingSchemaRepairCount, 29);
  assert.equal(state.materialBindingRecovery.repairedCount, 29);
});

test('native success with no candidates avoids the unnecessary fallback scan', async () => {
  const { calls, state } = await load({ native: true, candidateCount: 0 });
  assert.equal(calls.rootExport, 0);
  assert.equal(calls.fallbackRepair, 0);
  assert.equal(state.materialBindingRecovery.repairedCount, 0);
});

test('older bindings preserve the existing repaired layer path', async () => {
  const { calls } = await load({ native: false });
  assert.equal(calls.rootExport, 1);
  assert.equal(calls.legacyRepair, 1);
  assert.equal(calls.writes, 1);
  assert.match(calls.openedPaths[0], /material_binding_repaired\.usda$/);
});

test('native repair failures keep the existing post-open fallback available', async () => {
  const { calls } = await load({ native: true, failedCount: 1 });
  assert.equal(calls.rootExport, 0);
  assert.equal(calls.fallbackRepair, 1);
});


test('instance subtrees not visited by native repair retain the legacy fallback', async () => {
  const { calls } = await load({ native: true, candidateCount: 0, unsupportedInstanceCount: 1 });
  assert.equal(calls.rootExport, 0);
  assert.equal(calls.fallbackRepair, 1);
});
