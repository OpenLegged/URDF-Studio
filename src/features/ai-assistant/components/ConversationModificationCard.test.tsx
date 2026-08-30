import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import type { AIConversationModificationCard } from '../types';
import { ConversationModificationCard } from './ConversationModificationCard';

test('replacement diff keeps additions visible beside removals and uses success tokens', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
  });
  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  const card: AIConversationModificationCard = {
    kind: 'modification-card',
    role: 'assistant',
    explanation: 'Replace every generated line.',
    currentUrdf: Array.from({ length: 25 }, (_, index) => `<old-${index} />`).join('\n'),
    proposedUrdf: Array.from({ length: 25 }, (_, index) => `<new-${index} />`).join('\n'),
    componentId: 'robot',
    status: 'pending',
  };

  try {
    await act(async () => {
      root.render(
        <ConversationModificationCard
          card={card}
          t={translations.en}
          onApply={() => true}
          onDismiss={() => {}}
        />,
      );
    });

    const added = Array.from(container.querySelectorAll('[data-diff-line="added"]'));
    const removed = Array.from(container.querySelectorAll('[data-diff-line="removed"]'));
    assert.equal(added.length, 25);
    assert.equal(removed.length, 25);
    assert.match(container.textContent ?? '', /\+25\s+-25/);
    assert.equal(added[0]?.classList.contains('text-success'), true);
    assert.equal(added[0]?.classList.contains('bg-success/10'), true);
    assert.equal(container.innerHTML.includes('system-green'), false);

    const firstFourTypes = Array.from(container.querySelectorAll('[data-diff-line]'))
      .slice(0, 4)
      .map(element => element.getAttribute('data-diff-line'));
    assert.deepEqual(firstFourTypes, ['removed', 'added', 'removed', 'added']);

    await act(async () => {
      root.render(
        <ConversationModificationCard
          card={{ ...card, status: 'applied', verificationStatus: 'failed' }}
          t={translations.en}
          onApply={() => true}
          onDismiss={() => {}}
        />,
      );
    });
    assert.equal(
      container.textContent?.includes('AI is working on it'),
      true,
    );
    assert.equal(container.textContent?.includes('Generate repair'), false);
    assert.equal(container.textContent?.includes('Press Undo'), false);

    await act(async () => {
      root.render(
        <ConversationModificationCard
          card={{ ...card, status: 'applied', verificationStatus: 'unverified' }}
          t={translations.en}
          onApply={() => true}
          onDismiss={() => {}}
        />,
      );
    });
    assert.equal(container.textContent?.includes('AI could not confirm'), false);
    assert.equal(container.textContent?.includes('Applied'), true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
