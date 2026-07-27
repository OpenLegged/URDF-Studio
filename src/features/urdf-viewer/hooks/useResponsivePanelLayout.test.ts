import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveResponsivePanelLayout } from './useResponsivePanelLayout.ts';

test('resolveResponsivePanelLayout offsets default viewer panels by workspace overlay safe area', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 960,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: true,
    showJointPanel: true,
    preferEdgeDockedOptionsPanel: true,
  });

  assert.deepEqual(layout.optionsDefaultPosition, {
    top: '16px',
    right: 'calc(var(--workspace-overlay-right-inset,0px) + 16px)',
  });
  assert.deepEqual(layout.jointsDefaultPosition, {
    top: '50%',
    left: 'calc(var(--workspace-overlay-left-inset,0px) + 16px)',
    transform: 'translateY(-50%)',
  });
});

test('resolveResponsivePanelLayout edge-docks the options panel in narrow unified viewer layouts', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 620,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: true,
    showJointPanel: false,
    preferEdgeDockedOptionsPanel: true,
  });

  assert.deepEqual(layout.optionsDefaultPosition, {
    top: '16px',
    right: '-152px',
    left: 'auto',
    transform: 'none',
  });
});

test('resolveResponsivePanelLayout keeps options visible in phone-width viewers', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 375,
      containerHeight: 720,
      optionsWidth: 152,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: true,
    showJointPanel: false,
  });

  assert.deepEqual(layout.optionsDefaultPosition, {
    top: '16px',
    left: '16px',
    right: 'auto',
    transform: 'none',
  });
});

test('resolveResponsivePanelLayout edge-docks the joint panel in narrow unified viewer layouts', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 266,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: false,
    showJointPanel: true,
    preferEdgeDockedJointPanel: true,
  });

  assert.deepEqual(layout.jointsDefaultPosition, {
    top: '16px',
    left: '-152px',
    right: 'auto',
    transform: 'none',
  });
  assert.equal(layout.jointsPanelMaxHeight, 420);
});

test('resolveResponsivePanelLayout keeps edge-docked panels clear of expanded workspace sidebars', () => {
  const optionsLayout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 620,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
      rightInset: 248,
    },
    showOptionsPanel: true,
    showJointPanel: false,
    preferEdgeDockedOptionsPanel: true,
  });

  assert.deepEqual(optionsLayout.optionsDefaultPosition, {
    top: '16px',
    right: 'calc(var(--workspace-overlay-right-inset,0px) + 16px)',
    left: 'auto',
    transform: 'none',
  });

  const jointsLayout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 266,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
      leftInset: 264,
    },
    showOptionsPanel: false,
    showJointPanel: true,
    preferEdgeDockedJointPanel: true,
  });

  assert.deepEqual(jointsLayout.jointsDefaultPosition, {
    top: '16px',
    left: 'calc(var(--workspace-overlay-left-inset,0px) + 16px)',
    right: 'auto',
    transform: 'none',
  });
});

test('resolveResponsivePanelLayout keeps a softer max height for the centered-left joint panel', () => {
  const layout = resolveResponsivePanelLayout({
    metrics: {
      containerWidth: 266,
      containerHeight: 520,
      optionsWidth: 208,
      optionsHeight: 208,
      jointsWidth: 208,
    },
    showOptionsPanel: false,
    showJointPanel: true,
    preferEdgeDockedJointPanel: false,
  });

  assert.deepEqual(layout.jointsDefaultPosition, {
    top: '50%',
    left: 'calc(var(--workspace-overlay-left-inset,0px) + 16px)',
    transform: 'translateY(-50%)',
  });
  assert.equal(layout.jointsPanelMaxHeight, 420);
});
