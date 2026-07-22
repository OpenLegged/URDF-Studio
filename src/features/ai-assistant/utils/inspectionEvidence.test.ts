import test from 'node:test'
import assert from 'node:assert/strict'

import { GeometryType, JointType, type InspectionReport, type RobotState } from '@/types'
import {
  buildInspectionEvidence,
  mergeInspectionEvidenceIntoReport,
} from './inspectionEvidence.ts'

const createRobot = (): RobotState =>
  ({
    name: 'evidence_fixture',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
        inertial: {
          mass: -1,
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 3 },
        },
      },
      orphan_link: {
        id: 'orphan_link',
        name: 'orphan_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
      },
    },
    joints: {
      broken_joint: {
        id: 'broken_joint',
        name: 'broken_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'missing_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: 1, upper: -1, effort: 10, velocity: 5 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0.01, motorType: 'servo', motorId: 'M1', motorDirection: 1 },
      },
    },
    selection: null,
  }) as unknown as RobotState

test('buildInspectionEvidence reports deterministic structural, inertia, and limit failures', () => {
  const evidence = buildInspectionEvidence(createRobot())
  const failedEvidenceIds = evidence
    .filter((entry) => entry.status === 'fail')
    .map((entry) => entry.id)

  assert.ok(failedEvidenceIds.includes('link_reference_integrity'))
  assert.ok(failedEvidenceIds.includes('tree_root_count'))
  assert.ok(failedEvidenceIds.includes('mass_positive'))
  assert.ok(failedEvidenceIds.includes('inertia_triangle_inequality'))
  assert.ok(failedEvidenceIds.includes('joint_limit_order'))
})

test('buildInspectionEvidence does not treat missing optional bounds as reversed', () => {
  const robot = createRobot()
  robot.joints.broken_joint.limit = { effort: 10, velocity: 5 }

  const limitEvidence = buildInspectionEvidence(robot).find(
    (entry) => entry.id === 'joint_limit_order',
  )

  assert.equal(limitEvidence?.status, 'pass')
})

test('mergeInspectionEvidenceIntoReport promotes local evidence into report issues and removes conflicting pass items', () => {
  const baseReport: InspectionReport = {
    summary: 'AI report',
    issues: [
      {
        type: 'pass',
        title: 'Joint Limits Reasonableness - Passed',
        description: 'AI did not report joint limit issues.',
        profileId: 'base.simulation_readiness',
        itemId: 'joint_limits_valid',
        score: 10,
      },
    ],
    overallScore: 10,
    profileScores: { 'base.simulation_readiness': 10 },
    maxScore: 10,
  }

  const merged = mergeInspectionEvidenceIntoReport(
    baseReport,
    buildInspectionEvidence(createRobot()),
    'en',
  )

  assert.equal(
    merged.issues.some(
      (issue) =>
        issue.type === 'pass' &&
        issue.profileId === 'base.simulation_readiness' &&
        issue.itemId === 'joint_limits_valid',
    ),
    false,
  )
  assert.ok(
    merged.issues.some(
      (issue) =>
        issue.evidenceLevel === 'L1' &&
        issue.profileId === 'base.simulation_readiness' &&
        issue.itemId === 'joint_limits_valid' &&
        issue.type === 'error',
    ),
  )
})

test('mergeInspectionEvidenceIntoReport only promotes local evidence for selected inspection items', () => {
  const baseReport: InspectionReport = {
    summary: 'AI report',
    issues: [
      {
        type: 'pass',
        title: 'Selected item passed',
        description: 'The selected item stayed clean.',
        profileId: 'base.maintainability',
        itemId: 'naming_unique',
        score: 10,
      },
    ],
    overallScore: 10,
    profileScores: { 'base.maintainability': 10 },
    maxScore: 10,
  }

  const merged = mergeInspectionEvidenceIntoReport(
    baseReport,
    buildInspectionEvidence(createRobot()),
    'en',
    {
      'base.maintainability': ['naming_unique'],
    },
  )

  assert.deepEqual(
    merged.issues.map((issue) => `${issue.profileId}:${issue.itemId}`),
    ['base.maintainability:naming_unique'],
  )
  assert.equal(merged.overallScore, 10)
  assert.equal(merged.maxScore, 10)
})
