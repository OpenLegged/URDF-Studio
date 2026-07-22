import {
  getMjcfLinkDisplayName,
  getMjcfRawDisplayName,
} from '@/shared/utils/robot/mjcfDisplayNames';
import type {
  RobotImportRecoveryReport,
  RobotSourceDiagnostic,
  RobotState,
  RobotUrdfInspectionContext,
} from '@/types';
import { buildInspectionEvidence, formatInspectionEvidenceForPrompt } from './inspectionEvidence';
import type { SelectedInspectionProfileMap } from './inspectionProfileSelection';

const MAX_SUMMARY_ITEMS = 3;
const SOURCE_FORMATS_WITH_PARTIAL_EVIDENCE = new Set(['xacro', 'sdf', 'usd']);

const buildSelectedItemSet = (selectedItems?: SelectedInspectionProfileMap) => {
  return new Set(Object.values(selectedItems ?? {}).flat());
};

const joinNonEmpty = (parts: Array<string | undefined>) => {
  return parts.filter(Boolean).join(', ');
};

const escapeRegExp = (value: string) => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

const isGeneratedSiteNameForBody = (siteName: string, bodyId: string) => {
  const normalizedSiteName = siteName.trim();
  const normalizedBodyId = bodyId.trim();
  if (!normalizedSiteName || !normalizedBodyId) {
    return false;
  }

  const generatedSitePattern = new RegExp(
    `^${escapeRegExp(normalizedBodyId)}(?:::site(?:_\\d+|\\[\\d+\\])|_site_\\d+)$`,
    'i',
  );
  return generatedSitePattern.test(normalizedSiteName);
};

const buildSourceFormatEvidenceNotes = (robot: RobotState, lang: 'en' | 'zh') => {
  const sourceFormat = robot.inspectionContext?.sourceFormat;
  if (!sourceFormat || !SOURCE_FORMATS_WITH_PARTIAL_EVIDENCE.has(sourceFormat)) {
    return '';
  }

  if (lang === 'zh') {
    if (sourceFormat === 'xacro') {
      return [
        '**源格式附加说明:**',
        '- 该机器人来自 Xacro。当前上下文主要是展开/归一化后的模型；macro、arg、include 与展开前文件结构属于 insufficient_evidence，不能默认通过或默认失败。',
      ].join('\n');
    }
    if (sourceFormat === 'sdf') {
      return [
        '**源格式附加说明:**',
        '- 该机器人来自 SDF。当前上下文缺少完整 `<sdf>`、model/world、frame、plugin 与源 joint 证据；这些源格式项属于 insufficient_evidence，不要套用 URDF-only 结论。',
      ].join('\n');
    }
    return [
      '**源格式附加说明:**',
      '- 该机器人来自 USD。当前上下文缺少完整 stage、prim、USD Physics、articulation、asset/material binding 证据；这些源格式项属于 insufficient_evidence，不要套用 URDF-only 结论。',
    ].join('\n');
  }

  if (sourceFormat === 'xacro') {
    return [
      '**Source-Format Notes:**',
      '- This robot comes from Xacro. The current context is mainly the expanded/normalized model; macro, arg, include, and pre-expansion file structure evidence are insufficient_evidence and must not be marked pass or fail by default.',
    ].join('\n');
  }
  if (sourceFormat === 'sdf') {
    return [
      '**Source-Format Notes:**',
      '- This robot comes from SDF. The current context lacks full `<sdf>`, model/world, frame, plugin, and source joint evidence; these source-format checks are insufficient_evidence and must not use URDF-only conclusions.',
    ].join('\n');
  }
  return [
    '**Source-Format Notes:**',
    '- This robot comes from USD. The current context lacks full stage, prim, USD Physics, articulation, asset, and material binding evidence; these source-format checks are insufficient_evidence and must not use URDF-only conclusions.',
  ].join('\n');
};

const formatBodiesWithSites = (
  robot: RobotState,
  bodiesWithSites: NonNullable<
    NonNullable<RobotState['inspectionContext']>['mjcf']
  >['bodiesWithSites'],
) => {
  const sourceFormat = robot.inspectionContext?.sourceFormat;
  const linkDisplayNames = Object.fromEntries(
    Object.values(robot.links).map((link) => [
      link.id,
      sourceFormat === 'mjcf' ? getMjcfLinkDisplayName(link) : link.name,
    ]),
  );

  return bodiesWithSites
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((body) => {
      const bodyDisplayName = linkDisplayNames[body.bodyId] || getMjcfRawDisplayName(body.bodyId);
      const siteDisplayNames = body.siteNames
        .slice(0, MAX_SUMMARY_ITEMS)
        .map((siteName) =>
          getMjcfRawDisplayName(
            siteName,
            isGeneratedSiteNameForBody(siteName, body.bodyId) ? bodyDisplayName : undefined,
          ),
        )
        .join(', ');

      return `${bodyDisplayName} (${body.siteCount}: ${siteDisplayNames})`;
    })
    .join('; ');
};

const formatTendons = (
  tendons: NonNullable<NonNullable<RobotState['inspectionContext']>['mjcf']>['tendons'],
) => {
  return tendons
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((tendon) => {
      const attachments = tendon.attachmentRefs.slice(0, MAX_SUMMARY_ITEMS).join(', ');
      const actuators = tendon.actuatorNames.slice(0, MAX_SUMMARY_ITEMS).join(', ');
      return `${tendon.name} [${tendon.type}] (${joinNonEmpty([
        attachments ? `attachments: ${attachments}` : undefined,
        actuators ? `actuators: ${actuators}` : undefined,
      ])})`;
    })
    .join('; ');
};

const formatUrdfDiagnostics = (diagnostics: RobotSourceDiagnostic[]) => {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity !== 'info')
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((diagnostic) => {
      const related = diagnostic.relatedIds?.slice(0, MAX_SUMMARY_ITEMS).join(', ');
      return `${diagnostic.code} [${diagnostic.severity}]${related ? ` (${related})` : ''}: ${diagnostic.message}`;
    })
    .join('; ');
};

const formatImportRecoveryPromptNotes = (
  recovery: RobotImportRecoveryReport,
  lang: 'en' | 'zh',
) => {
  const summary = recovery.diagnostics
    .slice(0, MAX_SUMMARY_ITEMS)
    .map((diagnostic) => `${diagnostic.code} [${diagnostic.action}]: ${diagnostic.message}`)
    .join('; ');
  if (lang === 'zh') {
    return [
      '**导入恢复说明:**',
      `- 导入时安全忽略或降级了 ${recovery.recoveredItemCount} 项源数据问题。`,
      ...(summary ? [`- 恢复详情：${summary}`] : []),
    ].join('\n');
  }
  return [
    '**Import Recovery Notes:**',
    `- ${recovery.recoveredItemCount} source item(s) were safely omitted or downgraded during import.`,
    ...(summary ? [`- Recovery details: ${summary}`] : []),
  ].join('\n');
};

const formatUrdfInspectionPromptNotes = (
  urdfContext: RobotUrdfInspectionContext,
  sourceFormat: string | undefined,
  lang: 'en' | 'zh',
) => {
  const diagnosticSummary = formatUrdfDiagnostics(urdfContext.diagnostics);
  const counts = urdfContext.diagnosticCounts;
  const facts = urdfContext.facts;
  const sourceLabel = sourceFormat?.toUpperCase() ?? 'URDF';

  if (lang === 'zh') {
    const lines = [
      '**源格式附加说明:**',
      `- 该机器人来自 ${sourceLabel}，已包含本地 URDF 静态诊断供审阅参考。`,
      `- URDF 摘要：${facts.linkCount} 个 link，${facts.jointCount} 个 joint，${facts.visualCount} 个 visual，${facts.collisionCount} 个 collision，${facts.inertialCount} 个 inertial。`,
      `- 诊断计数：${counts.error} 个 error，${counts.warning} 个 warning，${counts.info} 个 info。`,
    ];

    if (diagnosticSummary) {
      lines.push(`- 优先参考这些诊断，但仍需结合机器人 JSON 独立判断：${diagnosticSummary}`);
    }

    return lines.join('\n');
  }

  const lines = [
    '**Source-Format Notes:**',
    `- This robot comes from ${sourceLabel} and includes local URDF static diagnostics as review evidence.`,
    `- URDF summary: ${facts.linkCount} links, ${facts.jointCount} joints, ${facts.visualCount} visuals, ${facts.collisionCount} collisions, ${facts.inertialCount} inertials.`,
    `- Diagnostic counts: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} info items.`,
  ];

  if (diagnosticSummary) {
    lines.push(
      `- Use these diagnostics as priority evidence, but still verify against the robot JSON: ${diagnosticSummary}`,
    );
  }

  return lines.join('\n');
};

const formatMjcfInspectionPromptNotes = (
  robot: RobotState,
  selectedItems: SelectedInspectionProfileMap | undefined,
  lang: 'en' | 'zh',
) => {
  const mjcfContext =
    robot.inspectionContext?.sourceFormat === 'mjcf' ? robot.inspectionContext.mjcf : undefined;
  const localEvidenceNotes = formatInspectionEvidenceForPrompt(
    buildInspectionEvidence(robot),
    selectedItems,
    lang,
  );
  const sourceFormatNotes = buildSourceFormatEvidenceNotes(robot, lang);
  const noteSections: string[] = [];

  if (sourceFormatNotes) {
    noteSections.push(sourceFormatNotes);
  }

  if (localEvidenceNotes) {
    noteSections.push(localEvidenceNotes);
  }

  if (!mjcfContext) {
    return noteSections.join('\n\n');
  }

  const selectedItemIds = buildSelectedItemSet(selectedItems);
  const bodySiteSummary = formatBodiesWithSites(robot, mjcfContext.bodiesWithSites);
  const tendonSummary = formatTendons(mjcfContext.tendons);

  if (lang === 'zh') {
    const lines = [
      '**源格式附加说明:**',
      '- 该机器人来自 MJCF。源 MJCF 中的 `<frame>` 会在编译后消失，不要仅因为规范化树里没有独立 frame/link 就判定结构缺失。',
      `- MJCF 摘要：${mjcfContext.siteCount} 个 site，${mjcfContext.tendonCount} 条 tendon，${mjcfContext.tendonActuatorCount} 个 tendon actuator。`,
    ];

    if (selectedItemIds.has('mjcf_site_frame_usage')) {
      lines.push(
        `- 在检查 mjcf_site_frame_usage 时，必须结合 joint 的 origin/axis 与 body-site 摘要判断坐标系和 site 用法：${bodySiteSummary || '当前没有额外 site 摘要。'}`,
      );
    }

    if (
      selectedItemIds.has('mjcf_tendon_actuator') ||
      selectedItemIds.has('effort_velocity_limits') ||
      selectedItemIds.has('armature_equivalent_inertia')
    ) {
      lines.push(
        `- 在检查 mjcf_tendon_actuator、effort_velocity_limits 或 armature_equivalent_inertia 时，必须结合 tendon 摘要、actuator 关联和限幅信息判断：${tendonSummary || '当前没有额外 tendon 摘要。'}`,
      );
    }

    noteSections.unshift(lines.join('\n'));
    return noteSections.join('\n\n');
  }

  const lines = [
    '**Source-Format Notes:**',
    '- This robot comes from MJCF. Source `<frame>` nodes compile away, so do not report missing structure only because the normalized tree has no standalone frame/link node.',
    `- MJCF summary: ${mjcfContext.siteCount} sites, ${mjcfContext.tendonCount} tendons, ${mjcfContext.tendonActuatorCount} tendon actuators.`,
  ];

  if (selectedItemIds.has('mjcf_site_frame_usage')) {
    lines.push(
      `- When evaluating mjcf_site_frame_usage, you MUST combine joint origin/axis data with body-site evidence: ${bodySiteSummary || 'no additional site summary is available.'}`,
    );
  }

  if (
    selectedItemIds.has('mjcf_tendon_actuator') ||
    selectedItemIds.has('effort_velocity_limits') ||
    selectedItemIds.has('armature_equivalent_inertia')
  ) {
    lines.push(
      `- When evaluating mjcf_tendon_actuator, effort_velocity_limits, or armature_equivalent_inertia, you MUST use tendon summaries, actuator associations, and limit data together: ${tendonSummary || 'no additional tendon summary is available.'}`,
    );
  }

  noteSections.unshift(lines.join('\n'));
  return noteSections.join('\n\n');
};

export const buildInspectionPromptNotes = (
  robot: RobotState,
  selectedItems: SelectedInspectionProfileMap | undefined,
  lang: 'en' | 'zh',
) => {
  const localEvidenceNotes = formatInspectionEvidenceForPrompt(
    buildInspectionEvidence(robot),
    selectedItems,
    lang,
  );
  const sourceFormatNotes = buildSourceFormatEvidenceNotes(robot, lang);
  const noteSections = [sourceFormatNotes, localEvidenceNotes].filter(Boolean);
  const inspectionContext = robot.inspectionContext;
  if (!inspectionContext) {
    return noteSections.join('\n\n');
  }
  const recoveryNotes = inspectionContext.recovery
    ? formatImportRecoveryPromptNotes(inspectionContext.recovery, lang)
    : '';
  if (recoveryNotes) {
    noteSections.unshift(recoveryNotes);
  }

  const urdfContext = inspectionContext.urdf;
  if (urdfContext) {
    noteSections.unshift(
      formatUrdfInspectionPromptNotes(urdfContext, inspectionContext.sourceFormat, lang),
    );
    return noteSections.join('\n\n');
  }

  const mjcfContext = inspectionContext.sourceFormat === 'mjcf' ? inspectionContext.mjcf : undefined;
  if (!mjcfContext) {
    return noteSections.join('\n\n');
  }

  const mjcfNotes = formatMjcfInspectionPromptNotes(robot, selectedItems, lang);
  return [recoveryNotes, mjcfNotes].filter(Boolean).join('\n\n');
};
