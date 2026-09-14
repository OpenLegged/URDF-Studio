import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsdWorkerStageSession, type UsdWorkerStageBindings } from './offscreen/usdWorkerStageSession.ts';

function harness() {
  const disposed: string[] = [];
  const bindings: UsdWorkerStageBindings<{ name: string; dispose: () => void }> = {};
  const session = createUsdWorkerStageSession(bindings, (driver) => disposed.push(String(driver)));
  const install = (name: string) => {
    const render = { name, dispose: () => disposed.push(`${name}:render`) };
    Object.assign(bindings, { driver: name, renderInterface: render, usdStage: `${name}:stage` });
    return render;
  };
  return { session, bindings, disposed, install };
}

for (const completion of ['adopt', 'reject'] as const) {
  test(`stale ${completion} preserves a newer delegate created before its stage commits`, () => {
    const { session, bindings, disposed, install } = harness();
    const old = session.beginLoad();
    install('old');
    old.captureResources?.();
    const next = session.beginLoad();
    const nextRender = install('next');
    next.captureResources?.();
    if (completion === 'adopt') old.adopt('old');
    else old.discardIfStale();
    assert.equal(bindings.renderInterface, nextRender);
    assert.equal(bindings.driver, 'next');
    assert.equal(bindings.usdStage, 'next:stage');
    assert.deepEqual(disposed, ['old', 'old:render']);
    assert.equal(next.adopt('next'), true);
    assert.equal(bindings.renderInterface, nextRender);
  });
}

test('stale rejection before acquiring handles cannot release a new uncommitted delegate', () => {
  const { session, bindings, disposed, install } = harness();
  const old = session.beginLoad();
  const next = session.beginLoad();
  const nextRender = install('next');
  next.captureResources?.();
  assert.equal(old.discardIfStale(), true);
  assert.equal(bindings.renderInterface, nextRender);
  assert.deepEqual(disposed, []);
});

test('stale returned driver cannot claim a new delegate when none was captured', () => {
  const { session, bindings, disposed, install } = harness();
  const old = session.beginLoad();
  const next = session.beginLoad();
  const nextRender = install('next');
  next.captureResources?.();
  assert.equal(old.adopt('old'), false);
  assert.equal(bindings.renderInterface, nextRender);
  assert.deepEqual(disposed, ['old']);
});

test('cancelled delegate disposal remains idempotent when its driver completes later', () => {
  const { session, disposed, install } = harness();
  const old = session.beginLoad();
  install('old');
  old.captureResources?.();
  session.invalidate();
  session.releaseStage();
  const next = session.beginLoad();
  install('next');
  next.captureResources?.();
  old.adopt('old');
  assert.deepEqual(disposed, ['old:render', 'old']);
});
