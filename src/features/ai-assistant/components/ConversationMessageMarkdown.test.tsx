import assert from 'node:assert/strict'
import test from 'node:test'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import { ConversationMessageMarkdown } from './ConversationMessageMarkdown.tsx'

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })

  ;(globalThis as { window?: Window }).window = dom.window as unknown as Window
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  })
  ;(globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement
  ;(globalThis as { HTMLAnchorElement?: typeof HTMLAnchorElement }).HTMLAnchorElement = dom.window.HTMLAnchorElement
  ;(globalThis as { HTMLTableElement?: typeof HTMLTableElement }).HTMLTableElement = dom.window.HTMLTableElement
  ;(globalThis as { Node?: typeof Node }).Node = dom.window.Node
  ;(globalThis as { Event?: typeof Event }).Event = dom.window.Event
  ;(globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle = dom.window.getComputedStyle.bind(dom.window)
  ;(globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
  ;(globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  return dom
}

test('ConversationMessageMarkdown renders common markdown structures safely', async () => {
  const dom = installDom()
  const container = dom.window.document.getElementById('root')
  assert.ok(container, 'root container should exist')

  const root = createRoot(container)

  try {
    await act(async () => {
      root.render(
        React.createElement(ConversationMessageMarkdown, {
          tone: 'assistant',
          content: [
            '## Findings',
            '',
            '- first item',
            '- second item',
            '',
            '`inline-code`',
            '',
            '```ts',
            'const torque = 12',
            '```',
            '',
            '| joint | status |',
            '| --- | --- |',
            '| hip | warning |',
            '',
            '[Docs](https://example.com)',
          ].join('\n'),
        }),
      )
    })

    assert.equal(container.querySelector('h2')?.textContent, 'Findings')
    assert.equal(container.querySelectorAll('li').length, 2)
    assert.ok(container.querySelector('pre code'))
    assert.equal(container.querySelectorAll('code').length >= 2, true)
    assert.ok(container.querySelector('table'))
    assert.equal(
      container.firstElementChild?.className.includes('text-[13px]'),
      true,
      'conversation body copy should use the readable 13px text scale',
    )

    const link = container.querySelector('a')
    assert.ok(link, 'expected markdown link to render')
    assert.equal(link.getAttribute('href'), 'https://example.com')
    assert.equal(link.getAttribute('target'), '_blank')
    assert.equal(link.getAttribute('rel'), 'noreferrer noopener')
  } finally {
    await act(async () => {
      root.unmount()
    })
    dom.window.close()
  }
})
