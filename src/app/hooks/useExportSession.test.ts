import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';

import type { ExportProgressState } from '@/features/file-io';
import { DEFAULT_CONFIG } from '@/features/file-io/components/ExportDialog/config';
import { translations } from '@/shared/i18n';
import type { RobotFile } from '@/types';
import { renderHook } from '../../../scripts/test/helpers/react-hook-harness';
import type { ExportExecutionResult, ExportTarget } from './file-export/types';
import { useExportSession, type ExportSessionSurface } from './useExportSession';

type SessionOptions = Parameters<typeof useExportSession>[0];

const SUCCESS: ExportExecutionResult = { partial: false, warnings: [], issues: [] };
const PROGRESS: ExportProgressState = {
  stepLabel: 'Packaging', detail: 'Assets', progress: 0.5, currentStep: 2, totalSteps: 4,
};
const FILE: RobotFile = { name: 'library/arm.urdf', format: 'urdf', content: '<robot />' };

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Promise not initialized'); };
  let reject: (error: unknown) => void = () => { throw new Error('Promise not initialized'); };
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderSession(
  context: Parameters<typeof renderHook>[0],
  overrides: Partial<SessionOptions['operations']> = {},
) {
  const preloads: ExportSessionSurface[] = [];
  const errors: string[] = [];
  const options: SessionOptions = {
    operations: {
      handleExportProject: async () => SUCCESS,
      handleExportWithConfig: async () => SUCCESS,
      handleExportDisconnectedWorkspaceUrdfBundle: async () => SUCCESS,
      ...overrides,
    },
    preload: (surface) => { preloads.push(surface); },
    showToast: (message) => { errors.push(message); },
    labels: {
      ...translations.en,
      exportFailedParse: 'Export failed', exportUrdfJointUnsupported: 'Unsupported joint {name}: {type}',
      exportProgressPreparing: 'Preparing', exportProgressPreparingDetail: 'Preparing assets',
    },
  };
  const rendered = renderHook(context, () => useExportSession(options));
  return {
    ...rendered,
    get current() { return rendered.current; },
    preloads, errors, options,
  };
}

test('export opening resets handoff format and target together', (context) => {
  const session = renderSession(context);
  act(() => { session.current.open({ type: 'current' }, 'usd'); });
  assert.equal(session.current.defaultFormat, 'usd');
  act(() => { session.current.open({ type: 'library-file', file: FILE }); });
  assert.equal(session.current.defaultFormat, undefined);
  assert.deepEqual(session.current.target, { type: 'library-file', file: FILE });
  act(() => { session.current.close(); session.current.open(); });
  assert.deepEqual(session.current.target, { type: 'current' });
  assert.equal(session.current.step, 'configure');
});

test('all export entry points share a synchronous busy guard and scoped progress', async (context) => {
  const completion = deferred<ExportExecutionResult>();
  const targets: ExportTarget[] = [];
  const observedProgress: ExportProgressState[] = [];
  let emitProgress = (_progress: ExportProgressState) => {};
  let projectCalls = 0;
  const session = renderSession(context, {
    handleExportWithConfig: async (_config, target, options) => {
      targets.push(target);
      emitProgress = (progress) => options?.onProgress?.(progress);
      return completion.promise;
    },
    handleExportProject: async () => { projectCalls += 1; return SUCCESS; },
  });
  let pending = Promise.resolve();
  await act(async () => {
    session.current.open({ type: 'library-file', file: FILE });
    pending = session.current.submit(DEFAULT_CONFIG, {
      onProgress: (progress) => { observedProgress.push(progress); },
    });
    await session.current.submit(DEFAULT_CONFIG);
    await session.current.exportProject();
    session.current.close();
    assert.equal(session.current.open(), false);
  });
  assert.equal(session.current.busy, true);
  assert.equal(session.current.step, 'configure');
  assert.deepEqual(targets, [{ type: 'library-file', file: FILE }]);
  assert.equal(projectCalls, 0);
  act(() => { emitProgress(PROGRESS); });
  assert.equal(session.current.progress, PROGRESS);
  assert.deepEqual(observedProgress, [PROGRESS]);
  await act(async () => { completion.resolve(SUCCESS); await pending; });
  assert.equal(session.current.busy, false);
  assert.equal(session.current.step, 'closed');
  assert.equal(session.current.progress, null);
  act(() => { emitProgress({ ...PROGRESS, progress: 1 }); });
  assert.deepEqual(observedProgress, [PROGRESS]);
});

test('failed configured exports preserve the editable session for retry', async (context) => {
  let attempts = 0;
  const session = renderSession(context, {
    handleExportWithConfig: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Missing mesh');
      return SUCCESS;
    },
  });
  await act(async () => {
    session.current.open({ type: 'library-file', file: FILE }, 'urdf');
    await session.current.submit(DEFAULT_CONFIG);
  });
  assert.equal(session.current.step, 'configure');
  assert.equal(session.current.busy, false);
  assert.equal(session.current.defaultFormat, 'urdf');
  assert.deepEqual(session.errors, [translations.en.exportFailed]);
  await act(async () => { await session.current.submit(DEFAULT_CONFIG); });
  assert.equal(session.current.step, 'closed');
  assert.equal(attempts, 2);
});

test('disconnected export confirmation owns close protection and retry state', async (context) => {
  const confirmation = deferred<ExportExecutionResult>();
  const config = { ...DEFAULT_CONFIG, format: 'urdf' as const };
  let attempts = 0;
  const session = renderSession(context, {
    handleExportWithConfig: async () => ({
      ...SUCCESS,
      actionRequired: {
        type: 'disconnected-workspace-urdf', componentCount: 2, connectedGroupCount: 2, exportName: 'Robot',
      },
    }),
    handleExportDisconnectedWorkspaceUrdfBundle: async (receivedConfig) => {
      assert.equal(receivedConfig, config);
      attempts += 1;
      return attempts === 1 ? confirmation.promise : SUCCESS;
    },
  });
  await act(async () => { session.current.open(); await session.current.submit(config); });
  assert.equal(session.current.step, 'disconnected');
  assert.equal(session.current.busy, false);
  assert.ok(session.preloads.includes('disconnected'));
  let pending = Promise.resolve();
  await act(async () => {
    pending = session.current.confirmDisconnected();
    await session.current.confirmDisconnected();
    session.current.close();
  });
  assert.equal(session.current.busy, true);
  assert.equal(session.current.step, 'disconnected');
  assert.equal(attempts, 1);
  await act(async () => { confirmation.reject(new Error('Archive failed')); await pending; });
  assert.equal(session.current.step, 'disconnected');
  assert.equal(session.current.busy, false);
  assert.deepEqual(session.errors, [translations.en.exportFailed]);
  await act(async () => { await session.current.confirmDisconnected(); });
  assert.equal(session.current.step, 'closed');
  assert.equal(session.current.disconnectedDialog, null);
});

test('project export displays progress and releases the session after failure', async (context) => {
  const completion = deferred<ExportExecutionResult>();
  const session = renderSession(context, { handleExportProject: async () => completion.promise });
  let pending = Promise.resolve();
  await act(async () => { pending = session.current.exportProject(); });
  assert.equal(session.current.busy, true);
  assert.equal(session.current.step, 'closed');
  assert.equal(session.current.progress?.stepLabel, 'Preparing');
  assert.ok(session.preloads.includes('progress'));
  await act(async () => { completion.reject(new Error('Disk unavailable')); await pending; });
  assert.equal(session.current.busy, false);
  assert.equal(session.current.progress, null);
  assert.deepEqual(session.errors, [translations.en.exportFailed]);
});

test('captured blob export commands read the latest operations after a render', async (context) => {
  const session = renderSession(context);
  const exportBlob = session.current.exportProjectBlob;
  const blob = new Blob(['project']);
  session.options.operations = {
    ...session.options.operations,
    handleExportProject: async (options) => {
      assert.equal(options?.skipDownload, true);
      return { ...SUCCESS, blob };
    },
  };
  session.rerender();
  await act(async () => { assert.equal(await exportBlob(), blob); });
  assert.equal(session.current.busy, false);
  assert.equal(session.current.progress, null);
});

test('unmount invalidates export progress and late errors without canceling the underlying operation', async (context) => {
  const completion = deferred<ExportExecutionResult>();
  const observedProgress: ExportProgressState[] = [];
  let emitProgress = (_progress: ExportProgressState) => {};
  const session = renderSession(context, {
    handleExportWithConfig: async (_config, _target, options) => {
      emitProgress = (progress) => options?.onProgress?.(progress);
      return completion.promise;
    },
  });
  let pending = Promise.resolve();
  await act(async () => {
    session.current.open();
    pending = session.current.submit(DEFAULT_CONFIG, {
      onProgress: (progress) => { observedProgress.push(progress); },
    });
  });
  session.unmount();
  emitProgress(PROGRESS);
  completion.reject(new Error('Completed after unmount'));
  await pending;
  assert.deepEqual(observedProgress, []);
  assert.deepEqual(session.errors, []);
});

for (const language of ['zh', 'en'] as const) {
  test(`${language} export toasts use localized errors and preserve original diagnostics`, async (context) => {
    const failure = new Error('Internal worker broke');
    const logged = context.mock.method(console, 'error', () => {});
    const session = renderSession(context, { handleExportProject: async () => { throw failure; } });
    session.options.labels = translations[language];
    session.rerender();
    await act(async () => { await session.current.exportProject(); });
    assert.deepEqual(session.errors, [translations[language].exportFailed]);
    assert.ok(logged.mock.calls.some(call => call.arguments[1] === failure));
  });

  test(`${language} export success localizes and deduplicates warnings while logging raw details`, async (context) => {
    const warning = '[MJCF export] Joint "joint_1" uses unsupported planar type, degrading to freejoint.';
    const logged = context.mock.method(console, 'warn', () => {});
    const session = renderSession(context, {
      handleExportWithConfig: async () => ({ ...SUCCESS, partial: true, warnings: [warning, warning, 'Raw note'] }),
    });
    session.options.labels = translations[language];
    session.rerender();
    await act(async () => { session.current.open(); await session.current.submit(DEFAULT_CONFIG); });
    assert.deepEqual(session.errors, [[
      translations[language].exportMjcfPlanarJointWarning.replace('{name}', 'joint_1'),
      translations[language].exportCompatibilityWarning,
    ].join('\n')]);
    assert.ok(logged.mock.calls.some(call => String(call.arguments[0]).includes(warning)));
    assert.ok(logged.mock.calls.some(call => String(call.arguments[0]).includes('Raw note')));
    assert.equal(session.current.step, 'closed');
  });
}
