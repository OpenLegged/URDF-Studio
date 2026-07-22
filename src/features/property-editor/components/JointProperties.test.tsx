import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { AppMode, MotorSpec } from '@/types';
import { JointType } from '@/types';
import { translations } from '@/shared/i18n';
import {
  getJointEffortUnitLabel,
  getJointValueUnitLabel,
  getJointVelocityUnitLabel,
} from '@/shared/utils/jointUnits';
import { useUIStore } from '@/store/uiStore';
import { JointProperties } from './JointProperties.tsx';

function escapeForRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createInlineFieldPattern(label: string, widthClassName: string) {
  return new RegExp(
    `<div class="[^"]*flex[^"]*gap-2[^"]*items-center[^"]*"><label class="[^"]*${escapeForRegExp(widthClassName)}[^"]*"[^>]*>${escapeForRegExp(label)}</label><div class="min-w-0 flex-1">`,
  );
}

function createJointData() {
  return {
    id: 'hip_joint',
    name: 'hip_joint',
    type: JointType.REVOLUTE,
    axis: { x: 0, y: 0, z: 1 },
    origin: {
      xyz: { x: 0.1, y: 0.2, z: 0.3 },
      rpy: { r: 0.4, p: 0.5, y: 0.6 },
    },
    limit: { lower: -1, upper: 1, velocity: 2, effort: 3 },
    dynamics: { friction: 0.1, damping: 0.2 },
    hardware: {
      armature: 0,
      motorType: '',
      motorId: '',
      motorDirection: 1 as const,
    },
  };
}

function renderJointProperties(
  mode: AppMode,
  motorLibrary: Record<string, MotorSpec[]> = {},
  jointTypeLocked = false,
) {
  useUIStore.setState({ rotationDisplayMode: 'euler_deg' });

  return renderToStaticMarkup(
    React.createElement(JointProperties, {
      data: createJointData(),
      mode,
      selection: { type: 'joint', id: 'hip_joint' },
      onUpdate: () => {},
      motorLibrary,
      t: translations.en,
      lang: 'en',
      jointTypeLocked,
    }),
  );
}

test('joint properties render collision-style transform controls with 90 degree quick steps', () => {
  const markup = renderJointProperties('editor');

  assert.match(markup, new RegExp(escapeForRegExp(translations.en.originRelativeParent)));
  assert.match(markup, new RegExp(escapeForRegExp(translations.en.position)));
  assert.match(markup, new RegExp(escapeForRegExp(translations.en.rotation)));
  assert.match(markup, /-90/);
  assert.match(markup, /\+90/);
});

test('joint properties render hardware, limit, and dynamics fields with inline labels', () => {
  const markup = renderJointProperties('editor');
  const limitUnit = getJointValueUnitLabel(JointType.REVOLUTE, 'rad');
  const velocityUnit = getJointVelocityUnitLabel(JointType.REVOLUTE);
  const effortUnit = getJointEffortUnitLabel(JointType.REVOLUTE);

  assert.match(markup, createInlineFieldPattern(translations.en.motorSource, 'w-24'));
  assert.match(markup, createInlineFieldPattern(`${translations.en.lower} (${limitUnit})`, 'w-24'));
  assert.match(markup, createInlineFieldPattern(`${translations.en.upper} (${limitUnit})`, 'w-24'));
  assert.match(
    markup,
    createInlineFieldPattern(`${translations.en.velocity} (${velocityUnit})`, 'w-24'),
  );
  assert.match(
    markup,
    createInlineFieldPattern(`${translations.en.effort} (${effortUnit})`, 'w-24'),
  );
  assert.match(markup, /grid grid-cols-1 gap-2 @\[300px\]:grid-cols-2/);
  assert.match(markup, /w-24 min-w-24 max-w-24 shrink-0 whitespace-nowrap/);
  assert.match(markup, createInlineFieldPattern(translations.en.friction, 'w-16'));
  assert.match(markup, createInlineFieldPattern(translations.en.damping, 'w-16'));
  assert.ok(
    markup.indexOf(`>${translations.en.limits}<`)
      < markup.indexOf(`>${translations.en.hardwareConfig}<`),
    'limits should render before hardware configuration',
  );
  assert.ok(
    markup.indexOf(`>${translations.en.effort} (${effortUnit})<`)
      < markup.indexOf(`>${translations.en.velocity} (${velocityUnit})<`),
    'effort should render before velocity to match the joints panel',
  );
  assert.doesNotMatch(markup, new RegExp(`>${escapeForRegExp(limitUnit)}<`));
  assert.doesNotMatch(markup, new RegExp(`>${escapeForRegExp(velocityUnit)}<`));
  assert.doesNotMatch(markup, new RegExp(`>${escapeForRegExp(effortUnit)}<`));
});

test('joint properties can lock the type selector for closed-loop bridge editing', () => {
  const markup = renderJointProperties('editor', {}, true);

  assert.match(markup, /<select[^>]*disabled=""/);
});

test('joint properties expose custom combobox triggers for select-based fields', () => {
  const markup = renderJointProperties('editor');

  assert.match(markup, /role="combobox"/);
});
