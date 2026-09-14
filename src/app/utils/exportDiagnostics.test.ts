import assert from 'node:assert/strict';
import test from 'node:test';

import { reportExportDiagnostics } from './exportDiagnostics';

test('successful exports log issue-only details and deduplicate messages without a partial flag', context => {
  const warning = context.mock.method(console, 'warn', () => {});
  const issues = [{ code: 'compatibility-fallback', message: 'Material fallback', context: { link: 'base' } }];
  reportExportDiagnostics({ warnings: [], issues });
  assert.equal(warning.mock.callCount(), 1);
  assert.match(warning.mock.calls[0].arguments[0], /Material fallback/);
  assert.deepEqual(warning.mock.calls[0].arguments[1], issues);

  reportExportDiagnostics({ warnings: [' Material fallback ', 'Material fallback', ''], issues });
  assert.equal(warning.mock.calls[1].arguments[0].match(/Material fallback/g)?.length, 1);
});

test('successful exports with no diagnostic details stay quiet', context => {
  const warning = context.mock.method(console, 'warn', () => {});
  reportExportDiagnostics({ warnings: [], issues: [] });
  reportExportDiagnostics({ warnings: [' ', ''], issues: [] });
  assert.equal(warning.mock.callCount(), 0);
});
