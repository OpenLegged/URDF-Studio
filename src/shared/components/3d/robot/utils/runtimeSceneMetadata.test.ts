import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createRuntimeSceneLinkMetadataState,
  resolveRuntimeSceneLinkMetadataState,
} from './runtimeSceneMetadata';

test('resolveRuntimeSceneLinkMetadataState updates immediately within the same load scope', () => {
  const robot = new THREE.Group();
  const initialLinks = {
    base_link: { visible: true, visual: { visible: true } },
  } as any;
  const nextLinks = {
    base_link: { visible: false, visual: { visible: false } },
  } as any;

  const initialState = createRuntimeSceneLinkMetadataState({
    scopeKey: 'robot-a:0',
    robot,
    robotVersion: 1,
    robotLinks: initialLinks,
  });

  const resolvedState = resolveRuntimeSceneLinkMetadataState(initialState, {
    scopeKey: 'robot-a:0',
    robot,
    robotVersion: 1,
    robotLinks: nextLinks,
  });

  assert.equal(resolvedState.robotLinks, nextLinks);
});

test('resolveRuntimeSceneLinkMetadataState freezes link metadata across load scopes until the runtime scene changes', () => {
  const currentRobot = new THREE.Group();
  const initialLinks = {
    base_link: { visible: true, visual: { visible: true } },
  } as any;
  const nextLinks = {
    arm_link: { visible: true, visual: { visible: true } },
  } as any;

  const initialState = createRuntimeSceneLinkMetadataState({
    scopeKey: 'robot-a:0',
    robot: currentRobot,
    robotVersion: 3,
    robotLinks: initialLinks,
  });

  const frozenState = resolveRuntimeSceneLinkMetadataState(initialState, {
    scopeKey: 'robot-b:1',
    robot: currentRobot,
    robotVersion: 3,
    robotLinks: nextLinks,
  });

  assert.equal(frozenState, initialState);

  const replacementRobot = new THREE.Group();
  const resolvedState = resolveRuntimeSceneLinkMetadataState(frozenState, {
    scopeKey: 'robot-b:1',
    robot: replacementRobot,
    robotVersion: 4,
    robotLinks: nextLinks,
  });

  assert.equal(resolvedState.robotLinks, nextLinks);
  assert.equal(resolvedState.scopeKey, 'robot-b:1');
});

test('resolveRuntimeSceneLinkMetadataState adopts the new scope immediately when no runtime scene is mounted yet', () => {
  const initialLinks = {
    base_link: { visible: true, visual: { visible: true } },
  } as any;
  const nextLinks = {
    arm_link: { visible: true, visual: { visible: true } },
  } as any;

  const initialState = createRuntimeSceneLinkMetadataState({
    scopeKey: 'empty:0',
    robot: null,
    robotVersion: 0,
    robotLinks: initialLinks,
  });

  const resolvedState = resolveRuntimeSceneLinkMetadataState(initialState, {
    scopeKey: 'robot-b:1',
    robot: null,
    robotVersion: 0,
    robotLinks: nextLinks,
  });

  assert.equal(resolvedState.robotLinks, nextLinks);
  assert.equal(resolvedState.scopeKey, 'robot-b:1');
});
