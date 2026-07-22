import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType, type RobotState } from '@/types';
import { buildInspectionPromptNotes } from './buildInspectionPromptNotes.ts';

test('buildInspectionPromptNotes emits MJCF-specific frame and tendon guidance when inspection metadata is available', () => {
  const robot: RobotState = {
    name: 'inspection-fixture',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    joints: {
      hip_joint: {
        id: 'hip_joint',
        name: 'hip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'world',
        childLinkId: 'base_link',
        origin: { xyz: { x: 0, y: 0.2, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 1, z: 0 },
        limit: { lower: -1, upper: 1, effort: 12, velocity: 8 },
        dynamics: { damping: 0.1, friction: 0.2 },
        hardware: { armature: 0.03, motorType: 'servo', motorId: 'M1', motorDirection: 1 },
      },
    },
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 2,
        tendonCount: 1,
        tendonActuatorCount: 1,
        bodiesWithSites: [
          { bodyId: 'base_link', siteCount: 2, siteNames: ['tip_site', 'frame_site'] },
        ],
        tendons: [
          {
            name: 'finger_tendon',
            type: 'spatial',
            limited: true,
            range: [0, 1],
            attachmentRefs: ['tip_site', 'frame_site'],
            attachments: [
              { type: 'site', ref: 'tip_site' },
              { type: 'site', ref: 'frame_site' },
            ],
            actuatorNames: ['finger_motor'],
          },
        ],
      },
    },
    selection: { type: 'link', id: 'base_link' },
  };

  const notes = buildInspectionPromptNotes(
    robot,
    {
      'format.mjcf': ['mjcf_site_frame_usage', 'mjcf_tendon_actuator'],
      'workflow.hardware_config': ['effort_velocity_limits', 'armature_equivalent_inertia'],
    },
    'en',
  );

  assert.match(notes, /Source-Format Notes/);
  assert.match(notes, /MJCF/);
  assert.match(notes, /mjcf_site_frame_usage/);
  assert.match(notes, /base_link/);
  assert.match(notes, /tip_site/);
  assert.match(notes, /finger_tendon/);
  assert.match(notes, /finger_motor/);
});

test('buildInspectionPromptNotes rewrites generated MJCF body and site names into friendly labels', () => {
  const robot: RobotState = {
    name: 'inspection-fixture',
    rootLinkId: 'world_body_0',
    links: {
      world_body_0: {
        id: 'world_body_0',
        name: 'world_body_0',
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          mjcfMesh: { name: 'bin' },
        },
        collision: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          mjcfMesh: { name: 'bin' },
        },
      },
    },
    joints: {},
    inspectionContext: {
      sourceFormat: 'mjcf',
      mjcf: {
        siteCount: 2,
        tendonCount: 0,
        tendonActuatorCount: 0,
        bodiesWithSites: [
          {
            bodyId: 'world_body_0',
            siteCount: 2,
            siteNames: ['world_body_0_site_0', 'world_body_0_site_1'],
          },
        ],
        tendons: [],
      },
    },
    selection: { type: 'link', id: 'world_body_0' },
  };

  const notes = buildInspectionPromptNotes(
    robot,
    { 'format.mjcf': ['mjcf_site_frame_usage'] },
    'en',
  );

  assert.match(notes, /Bin/);
  assert.match(notes, /Bin Site 1/);
  assert.doesNotMatch(notes, /world_body_0/);
  assert.doesNotMatch(notes, /site_0/);
});

test('buildInspectionPromptNotes includes deterministic local evidence for selected items', () => {
  const robot: RobotState = {
    name: 'evidence-fixture',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: -1,
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    selection: { type: 'link', id: 'base_link' },
  };

  const notes = buildInspectionPromptNotes(
    robot,
    { 'base.physical_plausibility': ['mass_positive'] },
    'en',
  );

  assert.match(notes, /Local Deterministic Evidence/);
  assert.match(notes, /mass_positive/);
  assert.match(notes, /base_link/);
});

test('buildInspectionPromptNotes explains insufficient source evidence for USD source profiles', () => {
  const robot: RobotState = {
    name: 'usd-fixture',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    joints: {},
    inspectionContext: {
      sourceFormat: 'usd',
      recovery: {
        diagnostics: [
          {
            code: 'nonfinite_usd_joint_limit_omitted',
            severity: 'warning',
            category: 'simulation',
            message: 'Omitted one invalid source limit.',
            action: 'omitted',
          },
        ],
        diagnosticCounts: { error: 0, warning: 1, info: 0 },
        recoveredItemCount: 1,
      },
    },
    selection: { type: 'link', id: 'base_link' },
  };

  const notes = buildInspectionPromptNotes(robot, { 'format.usd': ['usd_stage_root'] }, 'en');

  assert.match(notes, /Source-Format Notes/);
  assert.match(notes, /USD/);
  assert.match(notes, /insufficient_evidence/);
  assert.match(notes, /stage/);
  assert.match(notes, /Import Recovery Notes/);
  assert.match(notes, /nonfinite_usd_joint_limit_omitted/);
});
