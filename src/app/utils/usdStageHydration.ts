import type { InteractionSelection, RobotInspectionContext } from '@/types';
import { normalizeLibraryPathKey } from '@/core/utils/pathKeys';

function normalizeUsdStagePath(path: string | null | undefined): string {
  return normalizeLibraryPathKey(path);
}

export interface UsdStageHydrationDecision {
  pendingFileName?: string | null;
  selectedFileName?: string | null;
  stageSourcePath?: string | null;
}

export interface UsdStageHydrationSelectionCleanupDecision {
  documentLoadFileName?: string | null;
  documentLoadFormat?: string | null;
  documentLoadStatus?: string | null;
  selectedFileFormat?: string | null;
  selectedFileName?: string | null;
}

export function shouldApplyUsdStageHydration({
  pendingFileName,
  selectedFileName,
  stageSourcePath,
}: UsdStageHydrationDecision): boolean {
  const normalizedPendingFileName = normalizeUsdStagePath(pendingFileName);
  const normalizedSelectedFileName = normalizeUsdStagePath(selectedFileName);
  const normalizedStageSourcePath = normalizeUsdStagePath(stageSourcePath);

  if (!normalizedPendingFileName || !normalizedSelectedFileName) {
    return false;
  }

  if (normalizedPendingFileName !== normalizedSelectedFileName) {
    return false;
  }

  if (normalizedStageSourcePath && normalizedStageSourcePath !== normalizedSelectedFileName) {
    return false;
  }

  return true;
}

export function shouldDeferUsdStageHydrationSelectionCleanup({
  documentLoadFileName,
  documentLoadFormat,
  documentLoadStatus,
  selectedFileFormat,
  selectedFileName,
}: UsdStageHydrationSelectionCleanupDecision): boolean {
  const activeFileName = normalizeUsdStagePath(selectedFileName || documentLoadFileName);
  const normalizedDocumentFileName = normalizeUsdStagePath(documentLoadFileName);
  const activeFormat = selectedFileFormat || documentLoadFormat;

  return (
    activeFormat === 'usd' &&
    (documentLoadStatus === 'loading' || documentLoadStatus === 'hydrating') &&
    Boolean(activeFileName) &&
    activeFileName === normalizedDocumentFileName
  );
}

function hasHydratedSelectionEntry(
  entries: Record<string, { name?: string }>,
  identity: string,
): boolean {
  if (identity in entries) {
    return true;
  }

  return Object.values(entries).some((entry) => entry.name === identity);
}

interface UsdHydrationSelectionRobotData {
  links: Record<string, { name?: string }>;
  joints: Record<string, { name?: string }>;
  inspectionContext?: RobotInspectionContext;
}

function isHydratedSelectionValid(
  selection: InteractionSelection,
  robotData: UsdHydrationSelectionRobotData,
): boolean {
  if (!selection.type || !selection.id) {
    return true;
  }

  if (selection.type === 'link') {
    return hasHydratedSelectionEntry(robotData.links || {}, selection.id);
  }

  if (selection.type === 'joint') {
    return hasHydratedSelectionEntry(robotData.joints || {}, selection.id);
  }

  return Boolean(
    robotData.inspectionContext?.mjcf?.tendons?.some((tendon) => tendon.name === selection.id),
  );
}

export function resolveUsdStageHydrationSelection({
  currentSelection,
  robotData,
}: {
  currentSelection: InteractionSelection;
  robotData: UsdHydrationSelectionRobotData;
}): InteractionSelection {
  return isHydratedSelectionValid(currentSelection, robotData)
    ? currentSelection
    : { type: null, id: null };
}
