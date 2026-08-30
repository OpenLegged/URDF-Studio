import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendCompletionRuntimeAudit,
  buildAppliedRobotVerificationMessages,
  buildCompletionRepairPrompt,
  buildCompletionVerificationMessages,
  buildMissingCompletionEvidencePrompt,
  parseCompletionVerificationVerdict,
  selectCompletionEvidence,
} from './completionVerification'
import { createJoint, createLink } from '@/core/robot'
import { JointType, type RobotData } from '@/types'

function buildFourWheelRobot(): RobotData {
  const body = createLink({ id: 'body', name: 'body' })
  const links: RobotData['links'] = { body }
  const joints: RobotData['joints'] = {}
  const positions = [
    [0.6, 0.45, -0.2],
    [0.6, -0.45, -0.2],
    [-0.6, 0.45, -0.2],
    [-0.6, -0.45, -0.2],
  ] as const
  positions.forEach((position, index) => {
    const wheelId = `wheel_${index + 1}`
    links[wheelId] = createLink({ id: wheelId, name: wheelId })
    const jointId = `joint_${wheelId}`
    joints[jointId] = createJoint({
      id: jointId,
      name: jointId,
      type: JointType.CONTINUOUS,
      parentLinkId: 'body',
      childLinkId: wheelId,
      origin: {
        xyz: { x: position[0], y: position[1], z: position[2] },
        rpy: { r: 0, p: 0, y: 0 },
      },
      axis: { x: 0, y: 1, z: 0 },
    })
  })
  return { name: 'four-wheel-car', rootLinkId: 'body', links, joints }
}

test('completion verifier gets a complete harness audit for negative UI constraints', () => {
  const evidence = appendCompletionRuntimeAudit([], 0)

  assert.deepEqual(evidence, [{
    kind: 'audit',
    scope: 'app',
    summary: 'complete harness runtime action audit',
    message: '{"complete":true,"appUiToolCalls":0}',
  }])
})

test('completion verifier receives bounded evidence without model tool schemas', () => {
  const messages = buildCompletionVerificationMessages({
    userRequest: 'Set base_link to red and show collision.',
    candidateExplanation: 'Done.',
    plan: [{ step: 'Apply and verify both changes', status: 'completed' }],
    evidence: [{
      kind: 'observation',
      scope: 'draft',
      summary: 'read path: links.base_link.visual.color',
      message: '#ff0000',
    }],
    tokenEstimator: text => text.length,
  })

  assert.equal(messages.length, 2)
  assert.match(messages[0]?.content ?? '', /independent completion verifier/i)
  assert.match(messages[0]?.content ?? '', /one check per requirement/i)
  assert.match(messages[1]?.content ?? '', /base_link/)
  assert.match(messages[1]?.content ?? '', /"id":1/)
  assert.doesNotMatch(messages[1]?.content ?? '', /tools/i)
})

test('post-apply verifier receives the actual robot topology and placement evidence', () => {
  const messages = buildAppliedRobotVerificationMessages({
    userRequest: '生成一个带 4 个轮子的小汽车',
    liveRobot: buildFourWheelRobot(),
    structuralValidation: 'Robot valid: 5 links, 4 joints, root=body.',
    lang: 'zh',
    tokenEstimator: text => text.length,
  })

  assert.match(messages[0]?.content ?? '', /post-apply verifier/i)
  assert.match(messages[0]?.content ?? '', /structurally valid URDF is not enough/i)
  const packet = JSON.parse(messages[1]?.content ?? '{}') as {
    evidence?: Array<{ message?: string }>
  }
  const snapshot = JSON.parse(packet.evidence?.[0]?.message ?? '{}') as RobotData
  assert.ok(snapshot.links.wheel_1)
  assert.ok(snapshot.links.wheel_4)
  assert.equal(snapshot.joints.joint_wheel_4?.parentLinkId, 'body')
  assert.equal(snapshot.joints.joint_wheel_4?.origin.xyz.y, -0.45)
  assert.doesNotMatch(JSON.stringify(packet), /write_path|run_script|tools/)
})

test('completion evidence selection keeps observations from being crowded out by actions', () => {
  const selected = selectCompletionEvidence([
    ...Array.from({ length: 20 }, (_, index) => ({
      kind: 'action' as const,
      scope: 'draft' as const,
      summary: `write ${index}`,
      message: 'ok',
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      kind: 'observation' as const,
      scope: 'draft' as const,
      summary: `read ${index}`,
      message: 'observed',
    })),
  ])

  assert.equal(selected.length, 12)
  assert.equal(selected.filter(item => item.kind === 'observation').length, 4)
})

test('completion verifier parses an evidence-linked checklist from a fenced response', () => {
  assert.deepEqual(
    parseCompletionVerificationVerdict(
      '```json\n{"ok":false,"checks":[{"requirement":"Collision is visible","status":"fail","evidence":[1]}],"message":"Collision is still hidden."}\n```',
      1,
    ),
    {
      ok: false,
      checks: [{
        requirement: 'Collision is visible',
        status: 'fail',
        evidence: [1],
      }],
      message: 'Collision is still hidden.',
    },
  )
  assert.equal(parseCompletionVerificationVerdict('looks good'), null)
})

test('completion verifier rejects unsupported pass claims and invalid evidence citations', () => {
  assert.equal(
    parseCompletionVerificationVerdict(
      '{"ok":true,"checks":[{"requirement":"Name changed","status":"unknown","evidence":[]}],"message":"Done"}',
      1,
    ),
    null,
  )
  assert.equal(
    parseCompletionVerificationVerdict(
      '{"ok":true,"checks":[{"requirement":"Name changed","status":"pass","evidence":[]}],"message":"Done"}',
      1,
    ),
    null,
  )
  assert.equal(
    parseCompletionVerificationVerdict(
      '{"ok":true,"checks":[{"requirement":"Name changed","status":"pass","evidence":[2]}],"message":"Done"}',
      1,
    ),
    null,
  )
  assert.equal(
    parseCompletionVerificationVerdict('{"ok":true,"message":"Legacy self-report"}', 1),
    null,
  )
  assert.equal(
    parseCompletionVerificationVerdict(
      '{"ok":true,"checks":[{"requirement":"Name changed","status":"pass","evidence":[1]}],"message":"Done"}',
      1,
      new Set(),
    ),
    null,
    'an action record alone cannot prove final state',
  )
  assert.deepEqual(
    parseCompletionVerificationVerdict(
      '{"ok":true,"checks":[{"requirement":"Name changed","status":"pass","evidence":[1]}],"message":"Done"}',
      1,
      new Set([1]),
    )?.ok,
    true,
  )
})

test('completion repair prompt names each unresolved requirement without repeating passes', () => {
  const prompt = buildCompletionRepairPrompt({
    ok: false,
    message: 'One requirement is unknown.',
    checks: [
      { requirement: 'Name changed', status: 'pass', evidence: [1] },
      { requirement: 'Collision is visible', status: 'unknown', evidence: [] },
    ],
  })

  assert.match(prompt, /Collision is visible/)
  assert.doesNotMatch(prompt, /- \[pass\] Name changed/)
})

test('missing evidence prompt names only the required state surfaces', () => {
  const prompt = buildMissingCompletionEvidencePrompt(['app'])
  assert.match(prompt, /studio inspect/)
  assert.doesNotMatch(prompt, /read_path/)
})
