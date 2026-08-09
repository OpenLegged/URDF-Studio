import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentScriptApi, executeAgentScript } from './scriptSandbox';

const api = buildAgentScriptApi();

test('executeAgentScript edits the draft and returns it', () => {
  const draft = { links: { base_link: { visual: { dimensions: { x: 0.05, y: 0.5 } } } } };
  const result = executeAgentScript(
    "draft.links['base_link'].visual.dimensions.x = 0.3; return draft;",
    draft,
    api,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && (result.result as { links: { base_link: { visual: { dimensions: { x: number } } } } }).links.base_link.visual.dimensions.x, 0.3);
});

test('executeAgentScript accepts api helpers (loop over fields)', () => {
  const draft = {
    links: {
      a: { limit: { upper: 1 } },
      b: { limit: { upper: 2 } },
    },
  };
  const result = executeAgentScript(
    "api.keys(draft.links).forEach(function(k){ draft.links[k].limit.upper = 5; }); return draft;",
    draft,
    api,
  );
  assert.equal(result.ok, true);
  const edited = (result as { ok: true; result: { links: Record<string, { limit: { upper: number } }> } }).result;
  assert.equal(edited.links.a.limit.upper, 5);
  assert.equal(edited.links.b.limit.upper, 5);
});

test('executeAgentScript rejects a non-object return', () => {
  const result = executeAgentScript('return 42;', {}, api);
  assert.equal(result.ok, false);
  assert.equal(result.ok || typeof (result as { error: string }).error === 'string', true);
});

test('executeAgentScript surfaces a syntax error', () => {
  const result = executeAgentScript('this is not valid js', {}, api);
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /syntax error/i);
});

test('executeAgentScript surfaces a runtime throw', () => {
  const result = executeAgentScript('throw new Error("boom");', {}, api);
  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /boom/);
});