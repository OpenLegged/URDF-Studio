import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createUsdWorkerStageCache } from './offscreen/usdWorkerStageCache.ts';
import { createUsdWorkerStageSession } from './offscreen/usdWorkerStageSession.ts';
import type { UsdOffscreenViewerInitRequest } from '../utils/usdOffscreenViewerProtocol.ts';

type StageRequest = Pick<
  UsdOffscreenViewerInitRequest,
  'sourceFile' | 'stageOpenContext' | 'stageOpenContextKey' | 'sessionId'
>;

function deferredRuntime() {
  let resolve = () => {};
  const promise = new Promise<{ USD: object }>((complete) => {
    resolve = () => complete({ USD: {} });
  });
  return { promise, resolve };
}

/** Execute the production load coordinator with WASM/GL boundaries replaced. */
function createLoadHarness() {
  const source = ts.createSourceFile(
    'worker.ts',
    readFileSync(new URL('./usdOffscreenViewer.worker.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements.find((statement) =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'loadUsdStageIntoWorker',
  );
  assert.ok(declaration);
  const coordinator = ts.transpileModule(declaration.getText(source), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const bindings = {};
  const session = createUsdWorkerStageSession(bindings, () => {});
  const preparedFiles: string[] = [];
  const failures: string[] = [];
  const runtimeReady = deferredRuntime();
  const cache = createUsdWorkerStageCache({
    loadPrepared: async (sourceFile) => {
      preparedFiles.push(sourceFile.name);
      // Stop after preparation; these tests exercise reception and cancellation,
      // without opening a WASM stage or creating an offscreen WebGL context.
      throw new Error('fixture preparation failure');
    },
    clearPrepared: () => {},
  });
  const load = runInNewContext(`${coordinator}\nloadUsdStageIntoWorker`, {
    Error,
    stageSession: session,
    stageCache: cache,
    runtime: null,
    runtimeWindow: bindings,
    currentSourceFileName: '',
    viewerActive: false,
    showVisual: false,
    showCollision: false,
    showCollisionAlwaysOnTop: false,
    showOrigins: false,
    showOriginsOverlay: false,
    originSize: 0,
    groundPlaneOffset: 0,
    resolveWorkerCompletionMode: () => 'complete',
    emitDocumentLoadEvent: () => {},
    emitWorkerLoadingStep: () => {},
    emitLoadDebugEntry: () => {},
    installRuntimeWindowAlias: () => {},
    disposeStageResources: () => session.releaseStage(),
    isLoadGenerationActive: session.isActive,
    ensureUsdWasmRuntime: () => runtimeReady.promise,
    trackWorkerLoadDebugStep: ({ run }: { run: () => Promise<unknown> }) => run(),
    postWorkerMessage: (message: { type: string; error?: string }) => {
      if (message.type === 'fatal-error') failures.push(message.error ?? '');
    },
  }) as (request: StageRequest) => Promise<void>;
  return { load, session, cache, preparedFiles, failures, runtimeReady };
}

const sourceFile = { name: 'robot.usda', content: '#usda 1.0', format: 'usd' as const };
const fullRequest: StageRequest = {
  sessionId: 1,
  sourceFile,
  stageOpenContextKey: 'robot-context',
  stageOpenContext: { availableFiles: [], assets: {} },
};
const cachedRequest: StageRequest = {
  sessionId: 2,
  sourceFile,
  stageOpenContextKey: 'robot-context',
};

test('a key-only replacement can use context received while runtime initialization is pending', async () => {
  const harness = createLoadHarness();
  const first = harness.load(fullRequest);
  // A new viewer session cancels the first load before runtime initialization.
  harness.session.invalidate();
  harness.session.releaseStage();
  const second = harness.load(cachedRequest);
  assert.deepEqual(harness.preparedFiles, []);
  harness.runtimeReady.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(harness.preparedFiles, [sourceFile.name]);
  assert.deepEqual(harness.failures, ['fixture preparation failure']);
});

test('failed or cancelled stages retain received context until worker disposal', async () => {
  const harness = createLoadHarness();
  const first = harness.load(fullRequest);
  harness.session.invalidate();
  harness.session.releaseStage();
  harness.runtimeReady.resolve();
  await first;
  assert.deepEqual(harness.preparedFiles, []);
  assert.deepEqual(harness.failures, []);

  await harness.load(cachedRequest);
  await harness.load({ ...cachedRequest, sessionId: 3 });
  assert.deepEqual(harness.preparedFiles, [sourceFile.name, sourceFile.name]);
  assert.deepEqual(harness.failures, [
    'fixture preparation failure',
    'fixture preparation failure',
  ]);
  harness.cache.dispose();
  assert.throws(() => harness.cache.prepare(cachedRequest), /missing cached/);
});
