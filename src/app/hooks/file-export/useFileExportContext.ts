import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useAssetsStore, useUIStore, useWorkspaceStore } from '@/store';
import { translations } from '@/shared/i18n';

import {
  buildCanonicalExportContext,
  buildCanonicalWorkspaceExportAssets,
  type CanonicalExportContext,
} from './canonicalExportContext';

/** Subscribes to the canonical state needed by every export route. */
export function useFileExportContext() {
  const lang = useUIStore((state) => state.lang);
  const t = translations[lang];
  const assetsState = useAssetsStore(
    useShallow((state) => ({
      assets: state.assets,
      availableFiles: state.availableFiles,
      allFileContents: state.allFileContents,
      usdSceneSnapshots: state.usdSceneSnapshots,
      getUsdSceneSnapshot: state.getUsdSceneSnapshot,
      getUsdPreparedExportCache: state.getUsdPreparedExportCache,
      usdPreparedExportCaches: state.usdPreparedExportCaches,
      componentSourceDrafts: state.componentSourceDrafts,
    })),
  );
  const workspace = useWorkspaceStore((state) => state.workspace);
  const workspaceExportAssets = useMemo(
    () => buildCanonicalWorkspaceExportAssets({ workspace, assets: assetsState.assets }),
    [assetsState.assets, workspace],
  );
  const getCanonicalExportContext = useCallback(
    (): CanonicalExportContext => buildCanonicalExportContext({
      workspace,
      componentSourceDrafts: assetsState.componentSourceDrafts,
    }),
    [assetsState.componentSourceDrafts, workspace],
  );

  return {
    ...assetsState,
    getCanonicalExportContext,
    lang,
    t,
    workspace,
    workspaceExportAssets,
  };
}
