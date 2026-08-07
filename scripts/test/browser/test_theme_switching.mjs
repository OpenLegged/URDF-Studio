#!/usr/bin/env node

/**
 * Theme Switching browser regression test.
 *
 * Covers: detecting current theme, toggling theme, verifying DOM changes, and
 * preventing document-wide animation fan-out during a switch.
 */

import { setTimeout as delay } from 'node:timers/promises';
import {
  createSession, createTestSuite, assert,
  importModel, waitForReady, writeReport, printSummary,
} from './helpers/mjcf-helpers.mjs';

async function main() {
  const suite = createTestSuite('Theme Switching');
  const session = await createSession();
  const { page } = session;
  let themeSwitchMetrics = null;

  try {
    await importModel(page, 'unitree_go2', 'go2.xml');
    await waitForReady(page);

    // ── 1. Detect current theme ──
    const currentTheme = await page.evaluate(() => {
      const el = document.documentElement;
      const classList = [...el.classList];
      const isDark = classList.some((c) => /dark/i.test(c));
      const isLight = classList.some((c) => /light/i.test(c));
      const dataTheme = el.getAttribute('data-theme');
      const colorScheme = getComputedStyle(el).colorScheme;
      const storeTheme = window.__URDF_STUDIO_DEBUG__?.__uiStore__?.getState?.()?.theme;
      return { classList, isDark, isLight, dataTheme, colorScheme, storeTheme };
    });
    assert(suite, ['light', 'dark', 'system'].includes(currentTheme.storeTheme),
      'theme detectable from ui store');

    // ── 2. Find and click theme toggle button ──
    const themeToggleProbe = await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        /theme|dark|light|moon|sun/i.test(b.textContent ?? '') ||
        /theme|dark|light/i.test(b.getAttribute('aria-label') ?? '') ||
        b.dataset?.action === 'toggle-theme');

      if (!btn) {
        return { found: false, metrics: null };
      }

      const domElementCount = document.querySelectorAll('*').length;
      const start = performance.now();
      btn.click();
      const clickTaskMs = performance.now() - start;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const firstFrameMs = performance.now() - start;
      const animations = document.getAnimations();
      const animatedTargetCount = new Set(
        animations
          .map((animation) => animation.effect?.target ?? null)
          .filter((target) => target !== null),
      ).size;

      return {
        found: true,
        metrics: {
          activeAnimationCount: animations.length,
          animatedTargetCount,
          clickTaskMs,
          domElementCount,
          firstFrameMs,
          rootSwitching: document.documentElement.classList.contains('theme-switching'),
        },
      };
    });

    themeSwitchMetrics = themeToggleProbe.metrics;
    if (themeToggleProbe.found) {
      if (themeSwitchMetrics === null) {
        throw new Error('missing theme switch performance metrics');
      }
      assert(
        suite,
        !themeSwitchMetrics.rootSwitching,
        'theme switch avoids a document-wide transition marker',
      );
      assert(
        suite,
        themeSwitchMetrics.activeAnimationCount < themeSwitchMetrics.domElementCount,
        'theme switch does not fan out multiple animations across the DOM '
          + `(${themeSwitchMetrics.activeAnimationCount}/${themeSwitchMetrics.domElementCount})`,
      );

      await delay(300);

      // ── 3. Verify theme changed ──
      const newTheme = await page.evaluate(() => {
        const el = document.documentElement;
        return {
          classList: [...el.classList],
          isDark: [...el.classList].some((c) => /dark/i.test(c)),
          isLight: [...el.classList].some((c) => /light/i.test(c)),
          dataTheme: el.getAttribute('data-theme'),
          storeTheme: window.__URDF_STUDIO_DEBUG__?.__uiStore__?.getState?.()?.theme,
        };
      });
      assert(suite, newTheme.isDark !== currentTheme.isDark || newTheme.storeTheme !== currentTheme.storeTheme,
        'theme changed after toggle');

      // ── 4. Verify canvas still renders ──
      const canvas = await page.evaluate(() => {
        const c = document.querySelector('canvas');
        return c instanceof HTMLCanvasElement && c.width > 0 && c.height > 0;
      });
      assert(suite, canvas, 'canvas renders after theme switch');

      // Toggle back
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          /theme|dark|light|moon|sun/i.test(b.textContent ?? '') ||
          /theme|dark|light/i.test(b.getAttribute('aria-label') ?? '') ||
          b.dataset?.action === 'toggle-theme');
        btn?.click();
      });
    } else {
      // Try via store
      const storeToggle = await page.evaluate(() => {
        const store = window.__URDF_STUDIO_DEBUG__?.__uiStore__?.getState?.();
        if (store?.setTheme) {
          store.setTheme(store.theme === 'dark' ? 'light' : 'dark');
          return true;
        }
        return false;
      });
      assert(suite, storeToggle, 'theme toggled through ui store');
    }

    const errs = session.errors();
    assert(suite, errs.page.length === 0, 'no page errors');
  } finally {
    await session.cleanup();
  }

  await writeReport('theme_switching', { themeSwitchMetrics });
  process.exitCode = printSummary(suite) ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
