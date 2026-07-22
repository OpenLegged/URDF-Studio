import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SourceCodeEditorErrorBoundary } from './SourceCodeEditorErrorBoundary.tsx';

function renderFailure(lang: 'en' | 'zh', error: unknown): string {
  const boundary = new SourceCodeEditorErrorBoundary({
    children: React.createElement('div', null, 'workspace'),
    lang,
    onClose: () => {},
  });
  boundary.state = { error, hasError: true };
  return renderToStaticMarkup(boundary.render());
}

test('source editor boundary renders a contained English recovery dialog', () => {
  const markup = renderFailure('en', new Error('Failed to fetch dynamically imported module'));

  assert.match(markup, /Source editor failed to load/);
  assert.match(markup, /Failed to fetch dynamically imported module/);
  assert.match(markup, /data-testid="source-code-editor-error-close"/);
  assert.match(markup, /data-testid="source-code-editor-error-reload"/);
  assert.doesNotMatch(markup, /Something went wrong/);
});

test('source editor boundary renders localized Chinese recovery copy', () => {
  const markup = renderFailure('zh', null);

  assert.match(markup, /源代码编辑器加载失败/);
  assert.match(markup, />重新加载</);
  assert.match(markup, />关闭</);
  assert.match(markup, />null</);
  assert.doesNotMatch(markup, /Source editor failed to load/);
});
