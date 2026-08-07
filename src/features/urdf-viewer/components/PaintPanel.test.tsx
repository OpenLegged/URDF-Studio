import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { OverlayHoverBlockProvider } from '@/shared/hooks/useOverlayHoverBlock';
import { PaintPanel } from './PaintPanel';

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

test('PaintPanel hides routine success feedback and keeps errors visible', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);
  const baseProps: React.ComponentProps<typeof PaintPanel> = {
    lang: 'zh',
    toolMode: 'paint',
    paintColor: '#c8865b82',
    onPaintColorChange: () => {},
    paintSelectionScope: 'island',
    onPaintSelectionScopeChange: () => {},
    paintOperation: 'paint',
    onPaintOperationChange: () => {},
    paintStatus: { tone: 'success', message: '已对选中的可视化表面应用涂色。' },
    supported: true,
    onClose: () => {},
  };
  const render = async (props: React.ComponentProps<typeof PaintPanel>) => {
    await act(async () => {
      root.render(
        <OverlayHoverBlockProvider
          value={{ beginHoverBlock: () => {}, endHoverBlock: () => {}, clearHover: () => {} }}
        >
          <PaintPanel {...props} />
        </OverlayHoverBlockProvider>,
      );
    });
  };

  await render(baseProps);
  assert.doesNotMatch(container.textContent ?? '', /已对选中的可视化表面应用涂色/);

  await render({
    ...baseProps,
    paintStatus: { tone: 'error', message: '无法解析当前点击的可视化面。' },
  });
  assert.match(container.textContent ?? '', /无法解析当前点击的可视化面/);

  await render({
    ...baseProps,
    paintStatus: { tone: 'info', message: '这个表面没有可恢复的涂色。' },
  });
  assert.match(container.textContent ?? '', /这个表面没有可恢复的涂色/);

  await act(async () => root.unmount());
  dom.window.close();
});

test('PaintPanel explains restore-original mode and disables irrelevant color controls', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <OverlayHoverBlockProvider
        value={{ beginHoverBlock: () => {}, endHoverBlock: () => {}, clearHover: () => {} }}
      >
        <PaintPanel
          lang="zh"
          toolMode="paint"
          paintColor="#c8865b82"
          onPaintColorChange={() => {}}
          paintSelectionScope="island"
          onPaintSelectionScopeChange={() => {}}
          paintOperation="erase"
          onPaintOperationChange={() => {}}
          paintStatus={null}
          supported={true}
          onClose={() => {}}
        />
      </OverlayHoverBlockProvider>,
    );
  });

  assert.match(container.textContent ?? '', /已开启 · 请点模型/);
  assert.match(container.textContent ?? '', /单个三角面/);
  assert.match(container.textContent ?? '', /相连表面/);
  assert.equal(
    container.querySelector<HTMLButtonElement>('button[title*="点击模型上已涂色的表面"]')
      ?.title,
    '恢复工具已开启。点击模型上已涂色的表面，将按当前选择范围恢复原始材质。',
  );
  const colorInput = container.querySelector<HTMLInputElement>('input[type="color"]');
  const opacityInput = container.querySelector<HTMLInputElement>('input[type="range"]');
  assert.equal(colorInput?.disabled, true);
  assert.equal(opacityInput?.disabled, true);

  await act(async () => root.unmount());
  dom.window.close();
});
