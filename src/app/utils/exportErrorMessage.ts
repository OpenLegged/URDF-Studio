import { translations, type TranslationKeys } from '@/shared/i18n';

const EXPORT_ERROR_LABELS = [
  'exportFailedParse', 'exportUrdfJointUnsupported', 'exportLibraryParseFailed',
  'exportLibraryUnsupportedFormat', 'onlyUrdfMjcfExport', 'usdExportRequiresLoadedStage',
  'usdExportUnavailable', 'usdExportWorkerUnsupportedMeshes', 'usdLoadInProgress',
] as const;
const EXPORT_WARNING_LABELS = [
  'exportClosedLoopUrdfStripped', 'exportSdfBoxFaceTextureFallbackWarning',
  'exportUrdfBoxFaceTextureFallbackWarning', 'exportXacroBoxFaceTextureFallbackWarning',
  'exportPartialWithAssetFailures', 'exportedWithMissingMeshes',
] as const;

/** Recognize only known workflow copy; arbitrary runtime text is a diagnostic. */
function translateWorkflowMessage(
  message: string,
  keys: readonly (keyof TranslationKeys)[],
  labels: TranslationKeys,
): string | null {
  for (const key of keys) {
    for (const source of [labels, translations.en, translations.zh]) {
      const names: string[] = [];
      const pattern = source[key].split(/(\{\w+\})/).map((part) => {
        if (/^\{\w+\}$/.test(part)) {
          names.push(part.slice(1, -1));
          return '([\\s\\S]*?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }).join('');
      const match = message.match(new RegExp(`^${pattern}$`));
      if (!match) continue;
      return labels[key].replace(/\{(\w+)\}/g, (placeholder, name: string) => {
        const index = names.indexOf(name);
        return index < 0 ? placeholder : match[index + 1];
      });
    }
  }
  return null;
}

export function resolveExportErrorMessage(error: unknown, labels: TranslationKeys): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const unsupportedJoint = message.match(/^\[URDF export\] Joint "([^"]+)" uses unsupported ([^\s]+) type\.$/i);
  if (unsupportedJoint) {
    return labels.exportUrdfJointUnsupported
      .replace('{name}', () => unsupportedJoint[1])
      .replace('{type}', () => unsupportedJoint[2]);
  }
  const closedLoopJoint = message.match(
    /^\[MJCF export\] Closed-loop joint "([^"]+)" uses unsupported ([^\s]+) semantics\. Export SDF or USD to preserve its axis, limits, and degrees of freedom\.$/,
  );
  if (closedLoopJoint) {
    return labels.exportMjcfClosedLoopJointUnsupported
      .replace('{name}', () => closedLoopJoint[1]).replace('{type}', () => closedLoopJoint[2]);
  }
  const missingCollisionGeometry = message.match(
    /^\[MJCF export\] ([\s\S]+): missing collision geometry for mass\/inertia estimation\. Add collision shapes in the model editor\.$/,
  );
  if (missingCollisionGeometry) {
    return labels.exportMjcfMissingCollisionGeometry.replace('{name}', () => missingCollisionGeometry[1]);
  }
  const missingMesh = message.match(/^Missing component mesh asset "([^"]+)" for (.+)$/);
  if (missingMesh) {
    return labels.exportMissingMeshAsset
      .replace('{file}', () => missingMesh[1]).replace('{name}', () => missingMesh[2]);
  }
  const assetFailure = message.match(/^Failed to pack asset "([^"]+)":/);
  if (assetFailure) return labels.exportAssetPackagingFailed.replace('{file}', () => assetFailure[1]);
  if (message === 'Cannot export a project while an exclusive workspace operation is active.'
    || message === 'Cannot capture a project while a workspace edit is still pending.') {
    return labels.exportWorkspaceBusy;
  }
  if (message === 'Failed to commit the pending workspace edit before project export.') {
    return labels.exportPendingEditFailed;
  }
  return translateWorkflowMessage(message, EXPORT_ERROR_LABELS, labels) ?? labels.exportFailed;
}

export function resolveExportWarningMessage(message: string, labels: TranslationKeys): string {
  const planarJoint = message.match(/^\[MJCF export\] Joint "([^"]+)" uses unsupported planar type, degrading to freejoint\.$/);
  if (planarJoint) return labels.exportMjcfPlanarJointWarning.replace('{name}', () => planarJoint[1]);
  const cyclicLink = message.match(/^\[MJCF export\] Skipping cyclic link reference at "([^"]+)"\.$/);
  if (cyclicLink) return labels.exportMjcfCyclicLinkWarning.replace('{name}', () => cyclicLink[1]);
  const floatingJoint = message.match(/^\[SDF export\] Joint "([^"]+)" uses unsupported floating type; skipping \(link will be fixed to parent\)\.$/);
  if (floatingJoint) return labels.exportSdfFloatingJointWarning.replace('{name}', () => floatingJoint[1]);
  return translateWorkflowMessage(message, EXPORT_WARNING_LABELS, labels) ?? labels.exportCompatibilityWarning;
}
