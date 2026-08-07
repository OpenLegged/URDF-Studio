import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  clamp,
  estimateTextWidth,
  getEdgePath,
  getFittedViewTransform,
  getSteppedZoomScale,
  GRAPH_MAX_SCALE,
  GRAPH_MIN_SCALE,
  layoutGraph,
  resolveNodeSize,
  shouldPanGraphWheel,
  type GraphEdge,
  type PositionedGraphNode,
  type StructureGraphNode,
} from './treeGraphLayout';

test('estimateTextWidth returns 0 for empty strings and scales with font size', () => {
  assert.equal(estimateTextWidth('', 12, 600), 0);
  assert.ok(estimateTextWidth('robot', 12, 600) < estimateTextWidth('robot', 16, 600));
  // bold weight (>=600) applies a 1.06 factor
  assert.ok(estimateTextWidth('robot', 12, 700) >= estimateTextWidth('robot', 12, 400));
});

test('clamp keeps values within bounds', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('resolveNodeSize uses base size and grows with label width', () => {
  const shortNode: StructureGraphNode = {
    uid: 'l1',
    kind: 'link',
    label: 'a',
    children: [],
  };
  const base = resolveNodeSize(shortNode);
  assert.ok(base.width >= 136); // link base width
  assert.equal(base.height, 40);

  const longNode: StructureGraphNode = {
    uid: 'l2',
    kind: 'link',
    label: 'a-very-long-link-label-name',
    children: [],
  };
  assert.ok(resolveNodeSize(longNode).width > base.width);
});

test('layoutGraph handles empty, single-root, and parent-child trees', () => {
  // empty input still yields a padded bounding box
  const empty = layoutGraph([]);
  assert.equal(empty.nodes.length, 0);
  assert.equal(empty.edges.length, 0);
  assert.ok(empty.width > 0 && empty.height > 0);

  // single root with one child
  const root: StructureGraphNode = {
    uid: 'r',
    kind: 'robot',
    label: 'robot',
    children: [{ uid: 'l', kind: 'link', label: 'link', children: [] }],
  };
  const single = layoutGraph(root);
  assert.equal(single.nodes.length, 2);
  assert.equal(single.edges.length, 1);
  // child sits below the root (greater y)
  const rootNode = single.nodes.find((n) => n.node.uid === 'r');
  const childNode = single.nodes.find((n) => n.node.uid === 'l');
  assert.ok(rootNode && childNode && childNode.y > rootNode.y);
});

test('getFittedViewTransform scales down for small viewports and stays at 1 for large ones', () => {
  const small = getFittedViewTransform({ width: 1000, height: 1000 }, 200, 200);
  assert.ok(small.scale < 1);
  assert.ok(small.scale >= GRAPH_MIN_SCALE);

  const large = getFittedViewTransform({ width: 100, height: 100 }, 2000, 2000);
  assert.equal(large.scale, 1);
});

test('getSteppedZoomScale steps through discrete levels and clamps at the ends', () => {
  assert.ok(getSteppedZoomScale(0.5, 'in') > 0.5);
  assert.ok(getSteppedZoomScale(0.5, 'out') < 0.5);
  assert.equal(getSteppedZoomScale(GRAPH_MAX_SCALE, 'in'), GRAPH_MAX_SCALE);
  assert.equal(getSteppedZoomScale(GRAPH_MIN_SCALE, 'out'), GRAPH_MIN_SCALE);
});

test('getEdgePath produces a cubic bezier path', () => {
  const from: PositionedGraphNode = {
    node: { uid: 'a', kind: 'link', label: 'a', children: [] },
    x: 0,
    y: 0,
    width: 40,
    height: 40,
  };
  const to: PositionedGraphNode = {
    node: { uid: 'b', kind: 'link', label: 'b', children: [] },
    x: 0,
    y: 80,
    width: 40,
    height: 40,
  };
  const path = getEdgePath({ from, to } as GraphEdge);
  assert.ok(path.startsWith('M '));
  assert.ok(path.includes('C '));
});

test('shouldPanGraphWheel distinguishes trackpad pan from pinch and integer-delta zoom', () => {
  const zoomEvent = {
    ctrlKey: false,
    metaKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 100,
  } as WheelEvent;
  assert.equal(shouldPanGraphWheel(zoomEvent), false);

  const pinchEvent = {
    ctrlKey: true,
    metaKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 10,
  } as WheelEvent;
  assert.equal(shouldPanGraphWheel(pinchEvent), false);

  const panEvent = {
    ctrlKey: false,
    metaKey: false,
    deltaMode: 0,
    deltaX: 10,
    deltaY: 0,
  } as WheelEvent;
  assert.equal(shouldPanGraphWheel(panEvent), true);
});
