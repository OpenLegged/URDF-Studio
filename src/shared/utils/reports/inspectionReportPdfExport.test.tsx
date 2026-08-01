import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { act } from 'react';

import {
  __setPdfCanvasFactoryForTests,
  __setPdfGenerationDepsLoaderForTests,
} from '../pdf/printElementAsPdf.ts';
import { exportInspectionReportPdf } from './inspectionReportPdfExport.tsx';

function waitForTimers(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function installDomEnvironment() {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalNavigator = globalThis.navigator;
  const originalHTMLElement = globalThis.HTMLElement;
  const originalSVGElement = globalThis.SVGElement;
  const originalNode = globalThis.Node;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalDOMParser = globalThis.DOMParser;
  const originalActEnvironment = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;

  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: dom.window,
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    writable: true,
    value: dom.window.document,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: dom.window.navigator,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    configurable: true,
    writable: true,
    value: dom.window.HTMLElement,
  });
  Object.defineProperty(globalThis, 'SVGElement', {
    configurable: true,
    writable: true,
    value: dom.window.SVGElement,
  });
  Object.defineProperty(globalThis, 'Node', {
    configurable: true,
    writable: true,
    value: dom.window.Node,
  });
  Object.defineProperty(globalThis, 'MutationObserver', {
    configurable: true,
    writable: true,
    value: dom.window.MutationObserver,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    writable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    writable: true,
    value: (handle: number) => clearTimeout(handle),
  });
  Object.defineProperty(globalThis, 'DOMParser', {
    configurable: true,
    writable: true,
    value: dom.window.DOMParser,
  });
  Object.defineProperty(dom.window.document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    writable: true,
    value: true,
  });

  return {
    restore() {
      dom.window.close();
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
      Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
      Object.defineProperty(globalThis, 'HTMLElement', {
        configurable: true,
        value: originalHTMLElement,
      });
      Object.defineProperty(globalThis, 'SVGElement', {
        configurable: true,
        value: originalSVGElement,
      });
      Object.defineProperty(globalThis, 'Node', { configurable: true, value: originalNode });
      Object.defineProperty(globalThis, 'MutationObserver', {
        configurable: true,
        value: originalMutationObserver,
      });
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        configurable: true,
        value: originalRequestAnimationFrame,
      });
      Object.defineProperty(globalThis, 'cancelAnimationFrame', {
        configurable: true,
        value: originalCancelAnimationFrame,
      });
      Object.defineProperty(globalThis, 'DOMParser', {
        configurable: true,
        value: originalDOMParser,
      });
      Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
        configurable: true,
        value: originalActEnvironment,
      });
    },
  };
}

test('exportInspectionReportPdf renders and cleans up the shared report container', async () => {
  const dom = installDomEnvironment();
  const savedFiles: string[] = [];
  const pageSlices: Array<{ startY: number; height: number }> = [];
  let capturedText = '';
  let capturedLogoSrc = '';
  let capturedLogoTransform = '';
  let capsuleCount = -1;
  let issueMetaStyle: CSSStyleDeclaration | null = null;

  __setPdfGenerationDepsLoaderForTests(async () => ({
    html2canvas: (async (element: HTMLElement) => {
      capturedText = element.textContent || '';
      const logo = element.querySelector<HTMLImageElement>('img[alt="URDF Studio"]');
      capturedLogoSrc = logo?.src ?? '';
      capturedLogoTransform = logo?.style.transform ?? '';
      capsuleCount = element.querySelectorAll('[style*="border-radius: 999px"]').length;
      Object.defineProperties(element, {
        scrollWidth: { configurable: true, value: 800 },
        scrollHeight: { configurable: true, value: 1800 },
      });
      element.getBoundingClientRect = () =>
        ({ top: 0, bottom: 1800, width: 800, height: 1800 }) as DOMRect;
      const issueCard = element.querySelector<HTMLElement>('[data-pdf-keep-together]');
      assert.ok(issueCard);
      issueCard.getBoundingClientRect = () =>
        ({ top: 850, bottom: 1150, width: 700, height: 300 }) as DOMRect;
      issueMetaStyle =
        Array.from(element.querySelectorAll<HTMLElement>('div')).find(
          (node) => node.textContent === 'profile_a.item_a',
        )?.style ?? null;
      return {
        width: 800,
        height: 1800,
        getContext: () => ({
          fillStyle: '#ffffff',
          fillRect: () => {},
          drawImage: () => {},
        }),
        toDataURL: () => 'data:image/png;base64,source',
      } as any;
    }) as any,
    jsPDF: class {
      internal = {
        pageSize: {
          getWidth: () => 210,
          getHeight: () => 297,
        },
      };

      addImage() {}
      addPage() {}
      setProperties() {}
      save(fileName: string) {
        savedFiles.push(fileName);
      }
    } as any,
  }));
  __setPdfCanvasFactoryForTests((width, height) => ({
    width,
    height,
    getContext: () => ({
      fillStyle: '#ffffff',
      fillRect: () => {},
      drawImage: (
        _source: CanvasImageSource,
        _sourceX: number,
        sourceY: number,
        _sourceWidth: number,
        sourceHeight: number,
      ) => {
        pageSlices.push({ startY: sourceY, height: sourceHeight });
      },
    }),
    toDataURL: () => 'data:image/png;base64,slice',
  }));

  try {
    await act(async () => {
      await exportInspectionReportPdf({
        inspectionReport: {
          summary: 'shared pdf export summary',
          issues: [
            {
              type: 'warning',
              title: 'Plain text metadata',
              description: 'Report metadata should not render as a capsule.',
              profileId: 'profile_a',
              itemId: 'item_a',
            },
          ],
          overallScore: 95,
          maxScore: 100,
        },
        robotName: 'robot_a',
        lang: 'en',
        inspectionContext: { sourceFormat: 'urdf' },
      });
    });

    assert.match(capturedText, /shared pdf export summary/);
    assert.match(capturedLogoSrc, /\/logos\/logo\.png$/);
    assert.equal(capturedLogoTransform, 'translateY(4px)');
    assert.equal(capsuleCount, 0);
    assert.equal(issueMetaStyle?.borderRadius, '');
    assert.equal(issueMetaStyle?.backgroundColor, '');
    assert.deepEqual(pageSlices, [
      { startY: 0, height: 850 },
      { startY: 850, height: 950 },
    ]);
    assert.equal(savedFiles.length, 1);
    assert.match(savedFiles[0], /^robot_a_inspection_report_.*\.pdf$/);
    assert.equal(document.getElementById('inspection-report-pdf-export-container'), null);
  } finally {
    __setPdfGenerationDepsLoaderForTests(null);
    __setPdfCanvasFactoryForTests(null);
    await waitForTimers();
    await waitForTimers();
    dom.restore();
  }
});

test('exportInspectionReportPdf warns and continues when font readiness rejects', async () => {
  const dom = installDomEnvironment();
  const savedFiles: string[] = [];
  const warnings: unknown[][] = [];
  const originalConsoleWarn = console.warn;
  const fontError = new Error('font readiness failed');
  const rejectedFontReady = Promise.reject(fontError);
  rejectedFontReady.catch(() => {});

  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: rejectedFontReady },
  });
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };

  __setPdfGenerationDepsLoaderForTests(async () => ({
    html2canvas: (async () =>
      ({
        width: 800,
        height: 600,
        getContext: () => ({
          fillStyle: '#ffffff',
          fillRect: () => {},
          drawImage: () => {},
        }),
        toDataURL: () => 'data:image/png;base64,source',
      }) as any) as any,
    jsPDF: class {
      internal = {
        pageSize: {
          getWidth: () => 210,
          getHeight: () => 297,
        },
      };

      addImage() {}
      addPage() {}
      setProperties() {}
      save(fileName: string) {
        savedFiles.push(fileName);
      }
    } as any,
  }));
  __setPdfCanvasFactoryForTests((width, height) => ({
    width,
    height,
    getContext: () => ({
      fillStyle: '#ffffff',
      fillRect: () => {},
      drawImage: () => {},
    }),
    toDataURL: () => 'data:image/png;base64,slice',
  }));

  try {
    await act(async () => {
      await exportInspectionReportPdf({
        inspectionReport: {
          summary: 'font fallback pdf export summary',
          issues: [],
          overallScore: 90,
          maxScore: 100,
        },
        robotName: 'robot_b',
        lang: 'en',
      });
    });

    assert.equal(savedFiles.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0]), /PDFExport/);
    assert.match(String(warnings[0]?.[1]), /font readiness failed/);
  } finally {
    console.warn = originalConsoleWarn;
    __setPdfGenerationDepsLoaderForTests(null);
    __setPdfCanvasFactoryForTests(null);
    await waitForTimers();
    await waitForTimers();
    dom.restore();
  }
});
