import type { InspectionReport, RobotState } from '@/types'
import { hasFiniteJointLimitBounds } from '@/core/robot'
import {
  createProfileScoreMetrics,
  type SelectedInspectionProfileMap,
} from './inspectionProfileSelection'

export type InspectionEvidenceStatus = 'pass' | 'fail'
export type InspectionEvidenceLevel = 'L1' | 'L2' | 'L3' | 'L4'

export interface InspectionEvidenceProfileItem {
  profileId: string
  itemId: string
}

export interface InspectionEvidence {
  id: string
  level: InspectionEvidenceLevel
  source: 'local_rule'
  status: InspectionEvidenceStatus
  profileItems: InspectionEvidenceProfileItem[]
  relatedIds: string[]
  summary: string
  summaryZh: string
}

const evidence = (
  id: string,
  status: InspectionEvidenceStatus,
  profileItems: InspectionEvidenceProfileItem[],
  relatedIds: string[],
  summary: string,
  summaryZh: string,
): InspectionEvidence => ({
  id,
  level: 'L1',
  source: 'local_rule',
  status,
  profileItems,
  relatedIds,
  summary,
  summaryZh,
})

const firstProfileItem = (entry: InspectionEvidence) => entry.profileItems[0]

const selectedItemSet = (selectedProfiles?: SelectedInspectionProfileMap) => {
  return new Set(
    Object.entries(selectedProfiles ?? {}).flatMap(([profileId, itemIds]) =>
      itemIds.map((itemId) => `${profileId}:${itemId}`),
    ),
  )
}

const evidenceMatchesSelection = (
  entry: InspectionEvidence,
  selectedProfiles?: SelectedInspectionProfileMap,
) => {
  if (!selectedProfiles) {
    return true
  }

  const selected = selectedItemSet(selectedProfiles)
  return entry.profileItems.some((profileItem) =>
    selected.has(`${profileItem.profileId}:${profileItem.itemId}`),
  )
}

export function buildInspectionEvidence(robot: RobotState): InspectionEvidence[] {
  const entries: InspectionEvidence[] = []
  const links = robot.links
  const joints = robot.joints
  const linkIds = new Set(Object.keys(links))

  const brokenReferenceIds = Object.values(joints)
    .filter((joint) => !linkIds.has(joint.parentLinkId) || !linkIds.has(joint.childLinkId))
    .map((joint) => joint.id)

  entries.push(
    evidence(
      'link_reference_integrity',
      brokenReferenceIds.length > 0 ? 'fail' : 'pass',
      [{ profileId: 'base.robot_model', itemId: 'reference_integrity' }],
      brokenReferenceIds,
      brokenReferenceIds.length > 0
        ? `Broken joint link references: ${brokenReferenceIds.join(', ')}.`
        : 'All joint parent/child references point to existing links.',
      brokenReferenceIds.length > 0
        ? `存在断裂的 joint link 引用：${brokenReferenceIds.join(', ')}。`
        : '所有 joint parent/child 引用都指向现有 link。',
    ),
  )

  const childLinkIds = new Set(
    Object.values(joints)
      .map((joint) => joint.childLinkId)
      .filter((childLinkId) => linkIds.has(childLinkId)),
  )
  const logicalRoots = Object.keys(links).filter((linkId) => !childLinkIds.has(linkId))
  const hasSingleKnownRoot = logicalRoots.length === 1 && linkIds.has(robot.rootLinkId)

  entries.push(
    evidence(
      'tree_root_count',
      hasSingleKnownRoot ? 'pass' : 'fail',
      [{ profileId: 'base.robot_model', itemId: 'tree_connectivity' }],
      logicalRoots,
      hasSingleKnownRoot
        ? `Single logical root detected: ${logicalRoots[0]}.`
        : `Expected one logical root, found ${logicalRoots.length}: ${logicalRoots.join(', ') || 'none'}.`,
      hasSingleKnownRoot
        ? `检测到单一逻辑根节点：${logicalRoots[0]}。`
        : `应只有一个逻辑根节点，当前为 ${logicalRoots.length} 个：${logicalRoots.join(', ') || '无'}。`,
    ),
  )

  const nonPositiveMassLinks = Object.values(links)
    .filter((link) => link.inertial && link.inertial.mass <= 0)
    .map((link) => link.id)

  entries.push(
    evidence(
      'mass_positive',
      nonPositiveMassLinks.length > 0 ? 'fail' : 'pass',
      [{ profileId: 'base.physical_plausibility', itemId: 'mass_positive' }],
      nonPositiveMassLinks,
      nonPositiveMassLinks.length > 0
        ? `Links with non-positive mass: ${nonPositiveMassLinks.join(', ')}.`
        : 'All explicit inertial masses are positive.',
      nonPositiveMassLinks.length > 0
        ? `质量非正的 link：${nonPositiveMassLinks.join(', ')}。`
        : '所有显式惯性质量均为正数。',
    ),
  )

  const nonPositiveDiagonalLinks = Object.values(links)
    .filter((link) => {
      const inertia = link.inertial?.inertia
      return inertia && (inertia.ixx <= 0 || inertia.iyy <= 0 || inertia.izz <= 0)
    })
    .map((link) => link.id)

  entries.push(
    evidence(
      'inertia_diagonal_positive',
      nonPositiveDiagonalLinks.length > 0 ? 'fail' : 'pass',
      [{ profileId: 'base.physical_plausibility', itemId: 'inertia_positive' }],
      nonPositiveDiagonalLinks,
      nonPositiveDiagonalLinks.length > 0
        ? `Links with non-positive inertia diagonal values: ${nonPositiveDiagonalLinks.join(', ')}.`
        : 'All explicit inertia diagonal values are positive.',
      nonPositiveDiagonalLinks.length > 0
        ? `惯性对角项非正的 link：${nonPositiveDiagonalLinks.join(', ')}。`
        : '所有显式惯性对角项均为正数。',
    ),
  )

  const triangleViolationLinks = Object.values(links)
    .filter((link) => {
      const inertia = link.inertial?.inertia
      if (!inertia) {
        return false
      }
      return !(
        inertia.ixx + inertia.iyy > inertia.izz &&
        inertia.ixx + inertia.izz > inertia.iyy &&
        inertia.iyy + inertia.izz > inertia.ixx
      )
    })
    .map((link) => link.id)

  entries.push(
    evidence(
      'inertia_triangle_inequality',
      triangleViolationLinks.length > 0 ? 'fail' : 'pass',
      [{ profileId: 'base.physical_plausibility', itemId: 'inertia_positive' }],
      triangleViolationLinks,
      triangleViolationLinks.length > 0
        ? `Links violating inertia triangle inequality: ${triangleViolationLinks.join(', ')}.`
        : 'All explicit inertia tensors satisfy diagonal triangle inequality.',
      triangleViolationLinks.length > 0
        ? `不满足惯性三角不等式的 link：${triangleViolationLinks.join(', ')}。`
        : '所有显式惯性张量均满足对角项三角不等式。',
    ),
  )

  const reversedLimitJoints = Object.values(joints)
    .filter(
      (joint) =>
        hasFiniteJointLimitBounds(joint.limit) && joint.limit.lower >= joint.limit.upper,
    )
    .map((joint) => joint.id)

  entries.push(
    evidence(
      'joint_limit_order',
      reversedLimitJoints.length > 0 ? 'fail' : 'pass',
      [
        { profileId: 'base.simulation_readiness', itemId: 'joint_limits_valid' },
        { profileId: 'morph.manipulator', itemId: 'joint_limit_order' },
      ],
      reversedLimitJoints,
      reversedLimitJoints.length > 0
        ? `Joints with lower >= upper limits: ${reversedLimitJoints.join(', ')}.`
        : 'All explicit joint limits have lower < upper.',
      reversedLimitJoints.length > 0
        ? `下限大于或等于上限的 joint：${reversedLimitJoints.join(', ')}。`
        : '所有显式关节限位均满足 lower < upper。',
    ),
  )

  return entries
}

export function formatInspectionEvidenceForPrompt(
  evidenceEntries: InspectionEvidence[],
  selectedProfiles: SelectedInspectionProfileMap | undefined,
  lang: 'en' | 'zh',
) {
  const failedEntries = evidenceEntries.filter(
    (entry) => entry.status === 'fail' && evidenceMatchesSelection(entry, selectedProfiles),
  )

  if (failedEntries.length === 0) {
    return ''
  }

  if (lang === 'zh') {
    return [
      '**本地确定性证据:**',
      ...failedEntries.map(
        (entry) =>
          `- ${entry.id} (${entry.level}): ${entry.summaryZh} 相关对象：${entry.relatedIds.join(', ') || '无'}。`,
      ),
    ].join('\n')
  }

  return [
    '**Local Deterministic Evidence:**',
    ...failedEntries.map(
      (entry) =>
        `- ${entry.id} (${entry.level}): ${entry.summary} Related IDs: ${entry.relatedIds.join(', ') || 'none'}.`,
    ),
  ].join('\n')
}

export function mergeInspectionEvidenceIntoReport(
  report: InspectionReport,
  evidenceEntries: InspectionEvidence[],
  lang: 'en' | 'zh',
  selectedProfiles?: SelectedInspectionProfileMap,
): InspectionReport {
  const failedEntries = evidenceEntries.filter(
    (entry) => entry.status === 'fail' && evidenceMatchesSelection(entry, selectedProfiles),
  )
  if (failedEntries.length === 0) {
    return report
  }

  const localIssueKeys = new Set(
    failedEntries.flatMap((entry) =>
      entry.profileItems.map((profileItem) => `${profileItem.profileId}:${profileItem.itemId}`),
    ),
  )
  const retainedIssues = report.issues.filter((issue) => {
    if (issue.type !== 'pass') {
      return true
    }
    return !localIssueKeys.has(`${issue.profileId}:${issue.itemId}`)
  })

  const localIssues = failedEntries.flatMap((entry) => {
    const primaryProfileItem = firstProfileItem(entry)
    if (!primaryProfileItem) {
      return []
    }

    return [
      {
        type: 'error' as const,
        title:
          lang === 'zh'
            ? `本地证据：${entry.id}`
            : `Local evidence: ${entry.id}`,
        description: lang === 'zh' ? entry.summaryZh : entry.summary,
        profileId: primaryProfileItem.profileId,
        itemId: primaryProfileItem.itemId,
        evidenceLevel: entry.level,
        evidenceSource: entry.source,
        relatedIds: entry.relatedIds,
        score: 0,
      },
    ]
  })

  const mergedIssues = [...localIssues, ...retainedIssues]

  return {
    ...report,
    issues: mergedIssues,
    ...createProfileScoreMetrics(mergedIssues),
  }
}
