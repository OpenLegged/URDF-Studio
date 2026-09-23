import assert from 'node:assert/strict';
import test from 'node:test';
import { translations } from '@/shared/i18n';
import { reportRobotLoadError } from './robotLoadError';

for (const language of ['zh', 'en'] as const) {
  test(`USD capability errors provide an actionable ${language} explanation`, (context) => {
    const log = context.mock.method(console, 'error', () => {});
    const error = new Error('OffscreenCanvas is unavailable for USD RobotState hydration.');
    const result = reportRobotLoadError(error, { name: 'robot.usd', format: 'usd' }, translations[language]);
    assert.equal(result, translations[language].usdBrowserUnsupported);
    assert.equal(log.mock.calls[0].arguments[1], error);
  });

  test(`unknown worker failures keep literal filenames and full diagnostics in ${language}`, (context) => {
    const log = context.mock.method(console, 'error', () => {});
    const error = new Error('Unrecognized internal worker failure');
    const file = { name: '$&-robot.usd', format: 'usd' as const };
    const result = reportRobotLoadError(error, file, translations[language]);
    assert.ok(result.includes(file.name));
    assert.ok(!result.includes(error.message));
    assert.equal(log.mock.calls[0].arguments[1], error);
  });
}
