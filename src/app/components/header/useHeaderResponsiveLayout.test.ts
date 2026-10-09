import assert from 'node:assert/strict';
import test from 'node:test';

import { getHeaderResponsiveLayout } from './useHeaderResponsiveLayout.ts';

test('keeps the original compact desktop behavior when optional header actions are present', () => {
  const layout = getHeaderResponsiveLayout(1024, {
    hasQuickAction: true,
    hasSecondaryAction: true,
  });

  assert.equal(layout.showMenuLabels, false);
  assert.equal(layout.showSourceInline, false);
  assert.equal(layout.showUndoRedoInline, false);
  assert.equal(layout.showDesktopOverflow, true);
});

test('keeps settings and the host secondary action visible while compact layouts collapse other controls', () => {
  for (const width of [320, 640, 1024]) {
    const layout = getHeaderResponsiveLayout(width, {
      hasQuickAction: true,
      hasSecondaryAction: true,
    });

    assert.equal(layout.showSettingsInline, true);
    assert.equal(layout.showSecondaryActionInline, true);
    assert.equal(layout.showSecondaryActionLabel, false);
    assert.equal(layout.showSnapshotInline, false);
    assert.equal(layout.isDesktop, width >= 640);
  }
  assert.equal(getHeaderResponsiveLayout(1280, {
    hasQuickAction: true,
    hasSecondaryAction: true,
  }).showSecondaryActionLabel, true);
});

test('reclaims unused header action space so desktop controls stay inline longer', () => {
  const layout = getHeaderResponsiveLayout(1024, {
    hasQuickAction: false,
    hasSecondaryAction: false,
  });

  assert.equal(layout.showMenuLabels, false);
  assert.equal(layout.showSourceInline, false);
  assert.equal(layout.showSourceText, false);
  assert.equal(layout.showUndoRedoInline, false);
  assert.equal(layout.showDesktopOverflow, true);
});

test('still restores the full desktop inline control set on roomy widths', () => {
  const layout = getHeaderResponsiveLayout(1536, {
    hasQuickAction: false,
    hasSecondaryAction: false,
  });

  assert.equal(layout.showMenuLabels, true);
  assert.equal(layout.showSourceInline, true);
  assert.equal(layout.showSourceText, true);
  assert.equal(layout.showUndoRedoInline, true);
  assert.equal(layout.showDesktopOverflow, false);
});

test('collapses source text and undo earlier on medium widths because the permanent toolbar occupies the header center', () => {
  const layout = getHeaderResponsiveLayout(1240, {
    hasQuickAction: false,
    hasSecondaryAction: false,
  });

  assert.equal(layout.showMenuLabels, true);
  assert.equal(layout.showSourceInline, true);
  assert.equal(layout.showSourceText, false);
  assert.equal(layout.showUndoRedoInline, false);
  assert.equal(layout.showDesktopOverflow, true);
});
