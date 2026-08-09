import { strict as assert } from 'node:assert';
import test from 'node:test';
import type { CollisionOptimizationSource, CollisionTargetRef } from '../collisionOptimization';
import {
  buildLinkRelationByDirection,
  canCreateManualPair,
  createManualMergePairKey,
  createRelationKey,
} from './manualMergeRelations';

test('createRelationKey namespaces by component and direction', () => {
  assert.equal(createRelationKey(undefined, 'parent', 'child'), 'robot::parent::child');
  assert.equal(createRelationKey('c1', 'parent', 'child'), 'c1::parent::child');
  assert.notEqual(
    createRelationKey('c1', 'parent', 'child'),
    createRelationKey('c1', 'child', 'parent'),
  );
});

test('createManualMergePairKey is order-sensitive', () => {
  assert.equal(createManualMergePairKey('a', 'b'), 'a::b');
  assert.notEqual(createManualMergePairKey('a', 'b'), createManualMergePairKey('b', 'a'));
});

test('buildLinkRelationByDirection maps revolute/fixed/continuous joints both directions', () => {
  const source = {
    kind: 'robot',
    robot: {
      joints: {
        j1: { parentLinkId: 'base', childLinkId: 'link1', type: 'revolute' },
        j2: { parentLinkId: 'link1', childLinkId: 'link2', type: 'fixed' },
        j3: { parentLinkId: 'link2', childLinkId: 'link3', type: 'prismatic' },
      },
    },
  } as unknown as CollisionOptimizationSource;

  const relations = buildLinkRelationByDirection(source);
  // j1 + j2 contribute (revolute/fixed), j3 skipped (prismatic); each contributes both directions
  assert.ok(relations.has(createRelationKey(undefined, 'base', 'link1')));
  assert.ok(relations.has(createRelationKey(undefined, 'link1', 'base')));
  assert.ok(relations.has(createRelationKey(undefined, 'link1', 'link2')));
  assert.ok(relations.has(createRelationKey(undefined, 'link2', 'link1')));
  assert.ok(!relations.has(createRelationKey(undefined, 'link2', 'link3')));
});

test('canCreateManualPair validates component match and existing relation', () => {
  const source = {
    kind: 'robot',
    robot: {
      joints: {
        j1: { parentLinkId: 'base', childLinkId: 'link1', type: 'revolute' },
      },
    },
  } as unknown as CollisionOptimizationSource;
  const relations = buildLinkRelationByDirection(source);

  const targetById = new Map<string, CollisionTargetRef>([
    ['t-base', { id: 't-base', componentId: undefined, linkId: 'base' } as CollisionTargetRef],
    ['t-link1', { id: 't-link1', componentId: undefined, linkId: 'link1' } as CollisionTargetRef],
    ['t-other', { id: 't-other', componentId: 'c2', linkId: 'link1' } as CollisionTargetRef],
  ]);

  assert.equal(canCreateManualPair('t-base', 't-base', targetById, relations), false);
  assert.equal(canCreateManualPair('t-base', 't-other', targetById, relations), false);
  assert.equal(canCreateManualPair('t-base', 't-link1', targetById, relations), true);
  assert.equal(canCreateManualPair('t-base', 'missing', targetById, relations), false);
});
