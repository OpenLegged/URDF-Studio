import { validateCanonicalRobotData } from '@/core/robot/canonicalWorkspace';
import { recoverImportedRobotData } from '@/core/robot/importedRobotRecovery';
import type {
  RobotData,
  RobotFile,
  RobotImportRecoveryDiagnostic,
} from '@/types';

type RobotInspectionSourceFormat = NonNullable<
  RobotData['inspectionContext']
>['sourceFormat'];

export type FinalizeImportedRobotDataResult =
  | { status: 'ready'; robotData: RobotData }
  | {
      status: 'error';
      reason: 'parse_failed' | 'unsupported_format';
      detail: string;
    };

function isRobotInspectionSourceFormat(
  format: RobotFile['format'],
): format is RobotInspectionSourceFormat {
  return (
    format === 'urdf'
    || format === 'mjcf'
    || format === 'usd'
    || format === 'xacro'
    || format === 'sdf'
    || format === 'mesh'
  );
}

function stampRobotDataSourceFormat(
  robotData: RobotData,
  format: RobotInspectionSourceFormat,
): RobotData {
  return {
    ...robotData,
    inspectionContext: {
      ...robotData.inspectionContext,
      sourceFormat: format,
    },
  };
}

export function finalizeImportedRobotData(
  robotData: RobotData,
  format: RobotFile['format'],
  recoveryDiagnostics: RobotImportRecoveryDiagnostic[] = [],
): FinalizeImportedRobotDataResult {
  if (!isRobotInspectionSourceFormat(format)) {
    return {
      status: 'error',
      reason: 'unsupported_format',
      detail: 'Unsupported robot source format.',
    };
  }

  const stampedRobotData = stampRobotDataSourceFormat(robotData, format);
  const ambiguousIdentity = stampedRobotData.inspectionContext?.urdf?.diagnostics.find(
    (diagnostic) =>
      diagnostic.code === 'duplicate_link_name'
      || diagnostic.code === 'duplicate_joint_name',
  );
  if (ambiguousIdentity) {
    return {
      status: 'error',
      reason: 'parse_failed',
      detail: `Imported robot has ambiguous source identities. ${ambiguousIdentity.message}`,
    };
  }

  const recoveredRobotData = recoverImportedRobotData(
    stampedRobotData,
    format,
    recoveryDiagnostics,
  );
  const canonicalResult = validateCanonicalRobotData(recoveredRobotData, 'robot');
  if (!canonicalResult.valid) {
    const reportedIssues = canonicalResult.issues.slice(0, 12);
    const detail = reportedIssues
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join('; ');
    const omittedIssueCount = canonicalResult.issues.length - reportedIssues.length;
    const suffix = omittedIssueCount > 0
      ? `; and ${omittedIssueCount} more issue(s)`
      : '';
    return {
      status: 'error',
      reason: 'parse_failed',
      detail: `Imported robot could not be recovered safely. ${detail}${suffix}`,
    };
  }

  return { status: 'ready', robotData: recoveredRobotData };
}
