import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { ExportTarget } from '@/app/hooks/file-export/types';
import { resolveCurrentUsdExportMode } from '@/app/utils/currentUsdExportMode';
import {
  ExportDialog,
  type ExportDialogConfig,
  type ExportProgressState,
} from '@/features/file-io';
import { useAssetsStore } from '@/store';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';
import type { Language } from '@/shared/i18n';
import { isLibraryRobotExportableFormat } from '@/shared/utils';

interface ExportDialogConnectorProps {
  target: ExportTarget;
  lang: Language;
  isExporting: boolean;
  /** Optional initial format to preselect in the dialog (e.g. from a BOT-World
   *  `convertTo` handoff). Defaults to `'mjcf'` when unset. */
  defaultFormat?: ExportDialogConfig['format'];
  onClose: () => void;
  onExport: (
    config: ExportDialogConfig,
    options?: { onProgress?: (progress: ExportProgressState) => void },
  ) => Promise<void>;
}

export function ExportDialogConnector({
  target,
  lang,
  isExporting,
  defaultFormat,
  onClose,
  onExport,
}: ExportDialogConnectorProps) {
  const { selectedFile, documentLoadState, getUsdSceneSnapshot, getUsdPreparedExportCache } =
    useAssetsStore(
      useShallow((state) => ({
        selectedFile: state.selectedFile,
        documentLoadState: state.documentLoadState,
        getUsdSceneSnapshot: state.getUsdSceneSnapshot,
        getUsdPreparedExportCache: state.getUsdPreparedExportCache,
      })),
    );
  const documentLoadLifecycleState = useMemo(
    () => toDocumentLoadLifecycleState(documentLoadState),
    [documentLoadState],
  );

  const isSelectedUsdHydrating =
    selectedFile?.format === 'usd' &&
    documentLoadLifecycleState.status === 'hydrating' &&
    documentLoadLifecycleState.fileName === selectedFile.name;

  const currentUsdExportMode =
    selectedFile?.format === 'usd'
      ? resolveCurrentUsdExportMode({
          isHydrating: isSelectedUsdHydrating,
          hasPreparedExportCache: Boolean(getUsdPreparedExportCache(selectedFile.name)),
          hasSceneSnapshot: Boolean(getUsdSceneSnapshot(selectedFile.name)),
        })
      : 'unavailable';

  const canExportUsd =
    target.type === 'current'
      ? selectedFile?.format === 'usd'
        ? currentUsdExportMode !== 'unavailable'
        : !isSelectedUsdHydrating
      : isLibraryRobotExportableFormat(target.file.format);

  return (
    <ExportDialog
      onClose={onClose}
      onExport={onExport}
      lang={lang}
      isExporting={isExporting}
      canExportUsd={canExportUsd}
      defaultFormat={defaultFormat ?? 'mjcf'}
    />
  );
}
