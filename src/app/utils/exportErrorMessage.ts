import type { TranslationKeys } from '@/shared/i18n/types';

const URDF_UNSUPPORTED_JOINT_PATTERN =
  /\[URDF export\] Joint "([^"]+)" uses unsupported ([^\s]+) type\./i;

export function resolveExportErrorMessage(
  error: unknown,
  t: Pick<TranslationKeys, 'exportFailedParse' | 'exportUrdfJointUnsupported'>,
): string {
  const message = error instanceof Error && error.message ? error.message : '';
  const unsupportedJointMatch = message.match(URDF_UNSUPPORTED_JOINT_PATTERN);

  if (unsupportedJointMatch) {
    return t.exportUrdfJointUnsupported
      .replace('{name}', unsupportedJointMatch[1])
      .replace('{type}', unsupportedJointMatch[2]);
  }

  return message || t.exportFailedParse;
}
