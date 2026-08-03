import { salvageCanonicalRobotData } from '@/core/robot/canonicalRobotSalvage';
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

const CANONICAL_PATH = 'robot';
const MAX_REPORTED_ISSUES = 12;

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
  const allRecoveryDiagnostics = [
    ...recoveryDiagnostics,
    ...collectAmbiguousIdentityDiagnostics(stampedRobotData),
  ];

  const recoveredRobotData = recoverImportedRobotData(
    stampedRobotData,
    format,
    allRecoveryDiagnostics,
  );
  const canonicalResult = validateCanonicalRobotData(recoveredRobotData, CANONICAL_PATH);
  if (canonicalResult.valid) {
    return { status: 'ready', robotData: recoveredRobotData };
  }

  // Showing the healthy part of a broken file beats refusing the whole import,
  // so drop the entities validation rejected and re-run recovery over the rest.
  const salvage = salvageCanonicalRobotData(
    recoveredRobotData,
    canonicalResult.issues,
    CANONICAL_PATH,
  );
  if (salvage) {
    // The second recovery pass rebuilds the report from scratch, so it has to be
    // seeded with what the first pass already found; otherwise repairs that only
    // pass one could see would vanish from what the user is told.
    const salvagedRobotData = recoverImportedRobotData(salvage.robotData, format, [
      ...(recoveredRobotData.inspectionContext?.recovery?.diagnostics ?? allRecoveryDiagnostics),
      ...salvage.diagnostics,
    ]);
    if (validateCanonicalRobotData(salvagedRobotData, CANONICAL_PATH).valid) {
      return { status: 'ready', robotData: salvagedRobotData };
    }
  }

  return {
    status: 'error',
    reason: 'parse_failed',
    detail: `Imported robot could not be recovered safely. ${describeIssues(canonicalResult.issues)}`,
  };
}

/**
 * Source names that collapsed onto one entity during parsing.
 *
 * The parser keeps the last definition of a duplicated name, so the earlier one
 * is already lost by the time we get here. That is reported rather than treated
 * as fatal: an otherwise valid robot stays importable and the user can see
 * which identity was dropped.
 */
function collectAmbiguousIdentityDiagnostics(
  robotData: RobotData,
): RobotImportRecoveryDiagnostic[] {
  const diagnostics = robotData.inspectionContext?.urdf?.diagnostics ?? [];
  return diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code === 'duplicate_link_name'
        || diagnostic.code === 'duplicate_joint_name',
    )
    .map((diagnostic) => ({
      ...diagnostic,
      severity: 'warning',
      message: `${diagnostic.message} Only the last definition was kept.`,
      action: 'omitted',
    }));
}

function describeIssues(issues: readonly { path: string; message: string }[]): string {
  const reportedIssues = issues.slice(0, MAX_REPORTED_ISSUES);
  const detail = reportedIssues.map((issue) => `${issue.path}: ${issue.message}`).join('; ');
  const omittedIssueCount = issues.length - reportedIssues.length;
  return omittedIssueCount > 0 ? `${detail}; and ${omittedIssueCount} more issue(s)` : detail;
}
