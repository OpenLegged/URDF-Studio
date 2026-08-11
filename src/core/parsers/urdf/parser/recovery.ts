import type { RobotImportRecoveryDiagnostic } from '@/types';

export type UrdfRecoveryDiagnostics = RobotImportRecoveryDiagnostic[];

interface UrdfRecoveryOptions {
  code: string;
  category: RobotImportRecoveryDiagnostic['category'];
  message: string;
  action: RobotImportRecoveryDiagnostic['action'];
  tag: string;
  name?: string;
  attribute?: string;
  relatedIds?: string[];
}

export function addUrdfRecoveryDiagnostic(
  diagnostics: UrdfRecoveryDiagnostics | undefined,
  options: UrdfRecoveryOptions,
): void {
  if (!diagnostics) return;

  diagnostics.push({
    code: options.code,
    severity: 'warning',
    category: options.category,
    message: options.message,
    action: options.action,
    ...(options.relatedIds ? { relatedIds: options.relatedIds } : {}),
    source: {
      tag: options.tag,
      ...(options.name ? { name: options.name } : {}),
      ...(options.attribute ? { attribute: options.attribute } : {}),
    },
  });
}
