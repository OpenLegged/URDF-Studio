import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContextMenuPosition } from './ContextMenu.tsx';

test('context menu position stays inside the viewport gutter', () => {
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: 390, y: 590 },
      { width: 170, height: 220 },
      { width: 807, height: 618 },
    ),
    { x: 390, y: 390 },
  );
});

test('context menu position clamps both near and far viewport edges', () => {
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: -20, y: -10 },
      { width: 170, height: 220 },
      { width: 807, height: 618 },
    ),
    { x: 8, y: 8 },
  );
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: 790, y: 610 },
      { width: 170, height: 220 },
      { width: 807, height: 618 },
    ),
    { x: 629, y: 390 },
  );
});

test('context menu position uses visual viewport offsets', () => {
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: 10, y: 20 },
      { width: 170, height: 220 },
      { left: 300, top: 200, width: 500, height: 400 },
    ),
    { x: 308, y: 208 },
  );
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: 1000, y: 900 },
      { width: 170, height: 220 },
      { left: 300, top: 200, width: 500, height: 400 },
    ),
    { x: 622, y: 372 },
  );
});

test('oversized context menu anchors at the viewport gutter after size limiting', () => {
  assert.deepEqual(
    resolveContextMenuPosition(
      { x: 500, y: 500 },
      { width: 400, height: 300 },
      { left: 50, top: 70, width: 120, height: 80 },
    ),
    { x: 58, y: 78 },
  );
});
