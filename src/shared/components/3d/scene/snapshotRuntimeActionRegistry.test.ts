import assert from 'node:assert/strict';
import test from 'node:test';
import { createSnapshotCaptureAbortError } from './snapshotConfig.ts';
import { createSnapshotRuntimeActionRegistry } from './snapshotRuntimeActionRegistry.ts';

type TestAction = (value: string) => Promise<string>;

test('waits for the first lazy runtime action and forwards the same function', async () => {
  const registry = createSnapshotRuntimeActionRegistry<TestAction>();
  let currentAction: TestAction | null = null;
  const pendingAction = registry.waitForAction({
    getCurrentAction: () => currentAction,
    isActive: () => true,
  });
  const runtimeAction: TestAction = async (value) => `captured:${value}`;

  currentAction = runtimeAction;
  registry.resolve(runtimeAction);

  const resolvedAction = await pendingAction;
  assert.equal(resolvedAction, runtimeAction);
  assert.equal(await resolvedAction('first-click'), 'captured:first-click');
});

test('rejects a pending runtime action when its capture request is aborted', async () => {
  const registry = createSnapshotRuntimeActionRegistry<TestAction>();
  const controller = new AbortController();
  const pendingAction = registry.waitForAction({
    getCurrentAction: () => null,
    signal: controller.signal,
    isActive: () => true,
  });

  controller.abort();

  await assert.rejects(pendingAction, (error: unknown) => {
    return error instanceof Error && error.name === 'AbortError';
  });
});

test('rejects pending runtime actions when the snapshot manager unmounts', async () => {
  const registry = createSnapshotRuntimeActionRegistry<TestAction>();
  const pendingAction = registry.waitForAction({
    getCurrentAction: () => null,
    isActive: () => true,
  });

  registry.rejectAll(createSnapshotCaptureAbortError());

  await assert.rejects(pendingAction, (error: unknown) => {
    return error instanceof Error && error.name === 'AbortError';
  });
});
