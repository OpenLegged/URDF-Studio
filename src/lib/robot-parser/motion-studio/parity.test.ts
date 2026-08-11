import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { parseURDF, toRobotData, extractDofMetadata } from '@/lib/robot-parser';

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
}

/**
 * Independent expected-value projection used to verify the package metadata
 * rules against raw URDF input.
 */
function expectedDofMetadata(urdfText: string): {
  jointNames: string[];
  dofNames: string[];
  jointLimits: Record<string, { lower: number; upper: number }>;
  linkNames: string[];
} {
  const document = new DOMParser().parseFromString(urdfText, 'application/xml');
  const dofNames: string[] = [];
  const jointNames: string[] = [];
  const linkNames = Array.from(document.querySelectorAll('link'))
    .map((link) => link.getAttribute('name')?.trim() ?? '')
    .filter(Boolean);
  const jointLimits: Record<string, { lower: number; upper: number }> = {};

  Array.from(document.querySelectorAll('joint'))
    .filter((joint) => joint.getAttribute('type') !== 'fixed')
    .forEach((joint) => {
      const name = joint.getAttribute('name')?.trim() ?? '';
      if (!name) return;
      jointNames.push(name);
      dofNames.push(name);
      const limit = joint.querySelector('limit');
      const lower = Number(limit?.getAttribute('lower'));
      const upper = Number(limit?.getAttribute('upper'));
      if (Number.isFinite(lower) && Number.isFinite(upper) && lower < upper) {
        jointLimits[name] = { lower, upper };
      }
    });

  return { jointNames, dofNames, jointLimits, linkNames };
}

test('extractDofMetadata matches Motion Studio reference on real G1 URDF', () => {
  installDomGlobals();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const urdfPath = path.resolve(
    here,
    '../../../../test/unitree_ros/robots/g1_description/g1_29dof_mode_14.urdf',
  );
  const urdfText = fs.readFileSync(urdfPath, 'utf8');

  const robot = parseURDF(urdfText);
  assert.ok(robot, 'G1 URDF should parse into a RobotState');

  const actual = extractDofMetadata(toRobotData(robot!));
  const expected = expectedDofMetadata(urdfText);

  // Migration parity: the package's adapter must reproduce Motion Studio's
  // canonical metadata projection exactly for the same URDF.
  assert.deepEqual(actual, expected);
  assert.ok(actual.dofNames.length > 0, 'G1 should have non-fixed joints');
  assert.ok(Object.keys(actual.jointLimits).length > 0, 'G1 should have joints with finite limits');
});
