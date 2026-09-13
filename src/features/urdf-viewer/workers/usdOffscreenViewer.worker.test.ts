import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createUsdWorkerStageSession,
  type UsdWorkerStageBindings,
} from './offscreen/usdWorkerStageSession.ts';

function createHarness() {
  const released: string[] = [];
  const bindings: UsdWorkerStageBindings<{ dispose: () => void }> = {};
  const owner = createUsdWorkerStageSession(bindings, (driver) => released.push(String(driver)));
  const install = (name: string) => {
    bindings.driver = name;
    bindings.renderInterface = { dispose: () => released.push(`${name}:render`) };
    bindings.usdStage = `${name}:stage`;
  };
  return { bindings, owner, install, released };
}

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

test('a slower stage completion releases its handles and restores the newer committed stage', async () => {
  const { bindings, owner, install, released } = createHarness();
  const first = owner.beginLoad();
  const gate = deferred();
  const firstCompletion = gate.promise.then(() => {
    install('first');
    first.captureResources?.();
    return first.adopt('first');
  });
  const second = owner.beginLoad();
  install('second');
  second.captureResources?.();
  assert.equal(second.adopt('second'), true);
  const secondRender = bindings.renderInterface;

  gate.resolve();
  assert.equal(await firstCompletion, false);
  assert.equal(bindings.driver, 'second');
  assert.equal(bindings.renderInterface, secondRender);
  assert.equal(bindings.usdStage, 'second:stage');
  assert.deepEqual(released, ['first', 'first:render']);
  owner.releaseStage();
  assert.deepEqual(released, ['first', 'first:render', 'second', 'second:render']);
});

test('a rejected stale load clears transient globals without disposing the newer stage', async () => {
  const { bindings, owner, install, released } = createHarness();
  const first = owner.beginLoad();
  const gate = deferred();
  const failure = gate.promise.then(() => {
    install('failed');
    first.captureResources?.();
    throw new Error('stage open failed');
  }).catch(() => first.discardIfStale());
  const second = owner.beginLoad();
  install('second');
  second.captureResources?.();
  second.adopt('second');
  gate.resolve();

  assert.equal(await failure, true);
  assert.equal(bindings.driver, 'second');
  assert.deepEqual(released, ['failed', 'failed:render']);
});

test('stale rejection before acquiring resources leaves shared committed handles alive', () => {
  const { bindings, owner, install, released } = createHarness();
  const first = owner.beginLoad();
  const second = owner.beginLoad();
  install('second');
  second.captureResources?.();
  second.adopt('second');
  assert.equal(first.discardIfStale(), true);
  assert.equal(bindings.driver, 'second');
  assert.deepEqual(released, []);
});

test('stage replacement invalidates in-flight work while release remains idempotent', async () => {
  const { bindings, owner, install, released } = createHarness();
  const load = owner.beginLoad();
  install('committed');
  load.captureResources?.();
  load.adopt('committed');
  owner.invalidate();
  owner.releaseStage();
  owner.releaseStage();
  assert.equal(load.isActive(), false);
  assert.deepEqual(released, ['committed', 'committed:render']);
  assert.equal(bindings.driver, undefined);
  assert.equal(bindings.renderInterface, undefined);
});

test('worker disposal rejects later asynchronous completion and frees its handles', async () => {
  const { bindings, owner, install, released } = createHarness();
  const load = owner.beginLoad();
  const gate = deferred();
  const completion = gate.promise.then(() => {
    install('late');
    load.captureResources?.();
    return load.adopt('late');
  });
  owner.dispose();
  gate.resolve();
  assert.equal(await completion, false);
  assert.equal(owner.disposed, true);
  assert.equal(bindings.driver, undefined);
  assert.deepEqual(released, ['late', 'late:render']);
});

test('current stage failure is reported to the caller before normal stage cleanup', () => {
  const { owner, install, released } = createHarness();
  const load = owner.beginLoad();
  install('current');
  load.captureResources?.();
  load.adopt('current');
  assert.equal(load.discardIfStale(), false);
  assert.deepEqual(released, []);
  owner.releaseStage();
  assert.deepEqual(released, ['current', 'current:render']);
});
