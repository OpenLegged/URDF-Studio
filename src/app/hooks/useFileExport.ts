/**
 * File Export Hook
 * Handles exporting robot as URDF, extended URDF, BOM, and MuJoCo XML
 */
import { useCallback, useMemo } from 'react';
import type JSZip from 'jszip';
import type { RobotFile, RobotState } from '@/types';
import { generateURDF } from '@/core/parsers';
import { resolveSourcePreservingComponentDraft } from '@/core/robot';
import { useAssetsStore } from '@/store';
import type { ExportDialogConfig, PrepareMjcfMeshExportAssetsOptions } from '@/features/file-io';
import type { RobotAssetPackagingFailure } from '../utils/exportArchiveAssets';
import { addRobotAssetsToZip } from '../utils/exportArchiveAssets';
import { flushPendingHistory } from '../utils/pendingHistory';
import { buildGeneratedUrdfOptions } from '../utils/generatedUrdfOptions';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';
import { markUnsavedChangesBaselineSaved } from '../utils/unsavedChangesBaseline';
import {
  resolveSourcePreservingExportContent,
  type SourcePreservingExportFile,
  type SourcePreservingExportFormat,
} from './sourcePreservingExportUtils';
import {
  addSkeletonToZip,
  createArchiveRoot,
  getFileBaseName,
} from './file-export/archive';
import { generateRobotBomCsv } from './file-export/bom';
import {
  createExportProgressReporter,
  replaceTemplate,
  trimProgressFileLabel,
  type ExportProgressReporter,
} from './file-export/progress';
import {
  DEFAULT_EXPORT_TARGET,
  type ExportContext,
  type ExportExecutionResult,
  type HandleExportWithConfigOptions,
  type HandleProjectExportOptions,
  type ProjectExportExecutionResult,
  type UrdfSourceExportPreference,
  type ExportTarget,
} from './file-export/types';
import {
  assertAssemblyUrdfExportSupported,
  createBoxFaceTextureFallbackWarnings,
} from './file-export/urdfSupport';
import { applyBoxFaceMaterialExportFallback } from './file-export/materialFallbacks';
import { executeConfiguredRobotExport } from './file-export/configuredRobotExport';
import {
  collectCanonicalWorkspacePreparedMeshFiles,
} from './file-export/canonicalExportContext';
import {
  captureProjectExportPersistenceSnapshot,
  isProjectExportPersistenceSnapshotCurrent,
} from './file-export/projectExportPersistence';
import { useFileExportContext } from './file-export/useFileExportContext';

export type {
  ExportActionRequired,
  ExportExecutionResult,
  ProjectExportExecutionResult,
} from './file-export/types';

type JSZipInstance = JSZip;

interface AddMeshesToZipOptions {
  compressOptions?: { compressSTL: boolean; stlQuality: number };
  extraMeshFiles?: Map<string, Blob>;
  onProgress?: (progress: { completed: number; total: number; currentFile: string }) => void;
  robot: RobotState;
  skipMeshPaths?: ReadonlySet<string>;
  zip: JSZipInstance;
}

interface BuildSourcePreservingExportContentOptions {
  currentRobot: RobotState;
  format: SourcePreservingExportFormat;
  generatedContent: string;
  options?: UrdfSourceExportPreference;
  target: ExportTarget;
}

async function createZip(): Promise<JSZipInstance> {
  const { default: JSZip } = await import('jszip');
  return new JSZip();
}

async function prepareMjcfMeshExportAssetsLazy(
  params: PrepareMjcfMeshExportAssetsOptions,
) {
  const { prepareMjcfMeshExportAssets } = await import('@/features/file-io');
  return prepareMjcfMeshExportAssets(params);
}

export function useFileExport() {
  const {
    assets,
    availableFiles,
    allFileContents,
    usdSceneSnapshots,
    getUsdSceneSnapshot,
    getUsdPreparedExportCache,
    usdPreparedExportCaches,
    componentSourceDrafts,
    getCanonicalExportContext,
    lang,
    t,
    workspace,
    workspaceExportAssets,
  } = useFileExportContext();

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const createProgressReporter = useCallback(
    (
      onProgress: HandleExportWithConfigOptions['onProgress'],
      totalSteps: number,
    ): ExportProgressReporter => createExportProgressReporter(onProgress, totalSteps),
    [],
  );

  const throwForAssetPackagingFailures = useCallback(
    (failures: RobotAssetPackagingFailure[]): void => {
      if (failures.length === 0) {
        return;
      }

      const [firstFailure] = failures;
      throw new Error(firstFailure?.message || 'Failed to package export assets');
    },
    [],
  );

  const generateZipBlobWithProgress = useCallback(
    async (zip: JSZipInstance, reportProgress: ExportProgressReporter, currentStep: number) => {
      reportProgress(currentStep, t.exportProgressPackaging, t.exportProgressPackagingDetail, {
        stageProgress: 0.04,
        indeterminate: true,
      });

      return zip.generateAsync({ type: 'blob' }, (metadata) => {
        const currentFile = trimProgressFileLabel(metadata.currentFile);
        reportProgress(
          currentStep,
          t.exportProgressPackaging,
          currentFile
            ? replaceTemplate(t.exportProgressPackagingDetailFile, { file: currentFile })
            : t.exportProgressPackagingDetail,
          {
            stageProgress: metadata.percent / 100,
            indeterminate: false,
          },
        );
      });
    },
    [replaceTemplate, t, trimProgressFileLabel],
  );

  const boxFaceFallbackWarningLabels = useMemo(
    () => ({
      sdf: t.exportSdfBoxFaceTextureFallbackWarning,
      urdf: t.exportUrdfBoxFaceTextureFallbackWarning,
      xacro: t.exportXacroBoxFaceTextureFallbackWarning,
    }),
    [
      t.exportSdfBoxFaceTextureFallbackWarning,
      t.exportUrdfBoxFaceTextureFallbackWarning,
      t.exportXacroBoxFaceTextureFallbackWarning,
    ],
  );

  const bomLabels = useMemo(
    () => ({
      armature: t.armature,
      direction: t.direction,
      jointName: t.jointName,
      lower: t.lower,
      motorId: t.motorId,
      motorType: t.motorType,
      type: t.type,
      upper: t.upper,
    }),
    [t.armature, t.direction, t.jointName, t.lower, t.motorId, t.motorType, t.type, t.upper],
  );

  const buildBomCsv = useCallback(
    (robot: RobotState): string => generateRobotBomCsv(robot, bomLabels),
    [bomLabels],
  );

  const addMeshesToZip = useCallback(
    async ({
      compressOptions,
      extraMeshFiles,
      onProgress,
      robot,
      skipMeshPaths,
      zip,
    }: AddMeshesToZipOptions) => {
      return addRobotAssetsToZip({
        robot,
        zip,
        assets: workspaceExportAssets,
        compressOptions,
        extraMeshFiles,
        skipMeshPaths,
        onProgress,
      });
    },
    [workspaceExportAssets],
  );

  const resolveLibraryRobotForExport = useCallback(
    async (file: RobotFile): Promise<RobotState> => {
      const isSupportedFormat =
        file.format === 'urdf' ||
        file.format === 'mjcf' ||
        file.format === 'xacro' ||
        file.format === 'sdf' ||
        file.format === 'usd';

      if (!isSupportedFormat) {
        throw new Error(
          replaceTemplate(t.exportLibraryUnsupportedFormat, { format: file.format.toUpperCase() }),
        );
      }

      const preparedUsdRobot = file.format === 'usd'
        ? getUsdPreparedExportCache(file.name)?.robotData
        : null;
      if (preparedUsdRobot) {
        return {
          ...preparedUsdRobot,
          selection: { type: null, id: null },
        };
      }

      const importResult = await resolveRobotFileDataWithWorker(file, {
        availableFiles,
        assets,
        allFileContents,
        usdRobotData: getUsdPreparedExportCache(file.name)?.robotData ?? null,
      });

      if (importResult.status !== 'ready') {
        throw new Error(replaceTemplate(t.exportLibraryParseFailed, { file: file.name }));
      }

      return {
        ...importResult.robotData,
        selection: { type: null, id: null },
      };
    },
    [
      allFileContents,
      assets,
      availableFiles,
      getUsdPreparedExportCache,
      replaceTemplate,
      t.exportLibraryParseFailed,
      t.exportLibraryUnsupportedFormat,
    ],
  );

  const resolveLibraryExportContext = useCallback(
    async (file: RobotFile): Promise<ExportContext> => {
      const robot = await resolveLibraryRobotForExport(file);
      const preparedCache = file.format === 'usd'
        ? getUsdPreparedExportCache(file.name)
        : null;
      const extraMeshFiles = preparedCache
        ? new Map<string, Blob>(Object.entries(preparedCache.meshFiles ?? {}))
        : undefined;
      return {
        robot,
        exportName: getFileBaseName(file.name),
        ...(extraMeshFiles && extraMeshFiles.size > 0 ? { extraMeshFiles } : {}),
      };
    },
    [getUsdPreparedExportCache, resolveLibraryRobotForExport],
  );

  const resolveSourcePreservingSourceFile = useCallback(
    (
      format: SourcePreservingExportFormat,
      target: ExportTarget,
    ): SourcePreservingExportFile | null => {
      if (target.type === 'library-file') {
        return target.file.format === format
          ? {
              name: target.file.name,
              format,
              content: target.file.content || allFileContents[target.file.name] || '',
            }
          : null;
      }

      const sourceFile = getCanonicalExportContext().sourceFile;
      if (sourceFile?.format !== format || !sourceFile.content.trim()) {
        return null;
      }

      return {
        name: sourceFile.name,
        format,
        content: sourceFile.content,
      };
    },
    [allFileContents, getCanonicalExportContext],
  );

  const buildSourcePreservingExportContent = useCallback(
    ({
      currentRobot,
      format,
      generatedContent,
      options = {},
      target,
    }: BuildSourcePreservingExportContentOptions): string | null => {
      if (options.preferSourceVisualMeshes === false) {
        return null;
      }

      const sourceFile = resolveSourcePreservingSourceFile(format, target);
      if (!sourceFile) {
        return null;
      }

      return resolveSourcePreservingExportContent({
        format,
        currentRobot,
        sourceFile,
        generatedContent,
        availableFiles,
        allFileContents,
      }).content;
    },
    [allFileContents, availableFiles, resolveSourcePreservingSourceFile],
  );

  const buildCurrentCanonicalExportContext = useCallback(async (): Promise<ExportContext> => {
    const canonicalContext = getCanonicalExportContext();
    const extraMeshFiles = collectCanonicalWorkspacePreparedMeshFiles({
      workspace,
      getPreparedCache: getUsdPreparedExportCache,
    });

    const identityComponent = canonicalContext.identityComponent;
    const identitySourcePath = identityComponent?.sourceFile ?? null;
    const identitySourceFormat = identityComponent
      ? (
          componentSourceDrafts[identityComponent.id]?.format
          ?? availableFiles.find((file) => file.name === identitySourcePath)?.format
          ?? null
        )
      : null;
    if (identityComponent && identitySourcePath && identitySourceFormat === 'usd') {
      const { resolveCurrentUsdExportBundle } = await import('../utils/usdExportContext');
      const bundle = resolveCurrentUsdExportBundle({
        stageSourcePath: identitySourcePath,
        currentRobot: canonicalContext.robot,
        cachedSnapshot: getUsdSceneSnapshot(identitySourcePath),
        preparedCache: getUsdPreparedExportCache(identitySourcePath),
      });
      if (bundle) {
        bundle.meshFiles.forEach((blob, meshPath) => extraMeshFiles.set(meshPath, blob));
        return {
          robot: bundle.robot,
          exportName: canonicalContext.exportName,
          extraMeshFiles,
        };
      }
    }

    return extraMeshFiles.size > 0
      ? { ...canonicalContext, extraMeshFiles }
      : canonicalContext;
  }, [
    availableFiles,
    componentSourceDrafts,
    getCanonicalExportContext,
    getUsdPreparedExportCache,
    getUsdSceneSnapshot,
    workspace,
  ]);

  const requiresResolvedUsdContext = useMemo(() => {
    const identityComponent = getCanonicalExportContext().identityComponent;
    return Object.values(workspace.components)
      .filter((component) => component.visible !== false)
      .some((component) => {
        if (!component.sourceFile) return false;
        const sourceFormat =
          componentSourceDrafts[component.id]?.format
          ?? availableFiles.find((file) => file.name === component.sourceFile)?.format
          ?? null;
        if (sourceFormat !== 'usd') return false;
        if (getUsdPreparedExportCache(component.sourceFile)) return false;
        return !(
          identityComponent?.id === component.id
          && getUsdSceneSnapshot(component.sourceFile)
        );
      });
  }, [
    availableFiles,
    componentSourceDrafts,
    getCanonicalExportContext,
    getUsdPreparedExportCache,
    getUsdSceneSnapshot,
    usdPreparedExportCaches,
    usdSceneSnapshots,
    workspace,
  ]);

  const resolveExportContext = useCallback(
    async (target: ExportTarget = DEFAULT_EXPORT_TARGET): Promise<ExportContext | null> => {
      if (target.type === 'library-file') {
        return null;
      }
      return buildCurrentCanonicalExportContext();
    },
    [buildCurrentCanonicalExportContext],
  );

  const handleExportDisconnectedWorkspaceUrdfBundle = useCallback(
    async (config: ExportDialogConfig): Promise<ExportExecutionResult> => {
      flushPendingHistory();

      if (config.format !== 'urdf') {
        throw new Error(t.exportFailedParse);
      }

      assertAssemblyUrdfExportSupported(
        workspace,
        replaceTemplate,
        t.exportClosedLoopUrdfUnsupported,
      );

      const zip = await createZip();
      const assemblyExportName = workspace.name?.trim() || 'assembly';
      const archiveRoot = createArchiveRoot(zip, assemblyExportName);
      const componentsRoot = archiveRoot.folder('components') ?? archiveRoot;
      const assetPackagingFailures: RobotAssetPackagingFailure[] = [];
      let boxFaceFallbackCount = 0;

      const {
        includeExtended,
        includeBOM,
        useRelativePaths,
        includeMeshes,
        compressSTL,
        stlQuality,
        preferSourceVisualMeshes,
      } = config.urdf;

      for (const component of Object.values(workspace.components)) {
        const componentExportName = component.name?.trim() || component.id;
        const componentFolder = componentsRoot.folder(componentExportName) ?? componentsRoot;
        const componentRobot: RobotState = {
          ...component.robot,
          selection: { type: null, id: null },
        };
        const fallbackResult = applyBoxFaceMaterialExportFallback(componentRobot);
        const exportRobot = fallbackResult.robot;
        boxFaceFallbackCount += fallbackResult.records.length;
        const sourceResolution = resolveSourcePreservingComponentDraft({
          workspace,
          componentId: component.id,
          drafts: componentSourceDrafts,
        });
        const sourceFile =
          component.sourceFile
          && sourceResolution.status === 'matched'
          && sourceResolution.draft.format === 'urdf'
          && sourceResolution.draft.content.trim()
            ? {
                name: component.sourceFile,
                format: 'urdf' as const,
                content: sourceResolution.draft.content,
              }
            : null;
        const generatedUrdfOptions = await buildGeneratedUrdfOptions(undefined, {
          useRelativePaths,
        });
        const generatedUrdfContent = generateURDF(exportRobot, generatedUrdfOptions);
        const urdfContent = includeExtended
          ? generateURDF(
              exportRobot,
              await buildGeneratedUrdfOptions(undefined, { extended: true, useRelativePaths }),
            )
          : ((sourceFile
              && fallbackResult.records.length === 0
              && preferSourceVisualMeshes !== false
              ? resolveSourcePreservingExportContent({
                  format: 'urdf',
                  currentRobot: exportRobot,
                  sourceFile,
                  generatedContent: generatedUrdfContent,
                  availableFiles,
                  allFileContents,
                }).content
              : null) ?? generatedUrdfContent);

        componentFolder.file(`${componentExportName}.urdf`, urdfContent);

        if (config.includeSkeleton) {
          addSkeletonToZip(exportRobot, componentFolder, componentExportName, includeMeshes);
        }

        if (includeBOM) {
          const hardwareFolder = componentFolder.folder('hardware');
          hardwareFolder?.file('bom_list.csv', buildBomCsv(exportRobot));
        }

        if (!includeMeshes) {
          continue;
        }

        const meshPackagingResult = await addMeshesToZip({
          robot: exportRobot,
          zip: componentFolder,
          compressOptions: {
            compressSTL,
            stlQuality,
          },
        });
        assetPackagingFailures.push(...meshPackagingResult.failedAssets);
      }

      throwForAssetPackagingFailures(assetPackagingFailures);

      const content = await zip.generateAsync({ type: 'blob' });
      downloadBlob(content, `${assemblyExportName}_components_urdf.zip`);

      const warnings = createBoxFaceTextureFallbackWarnings(
        'urdf',
        boxFaceFallbackCount,
        replaceTemplate,
        boxFaceFallbackWarningLabels,
      );

      return {
        partial: warnings.length > 0,
        warnings,
        issues: [],
      };
    },
    [
      addMeshesToZip,
      allFileContents,
      availableFiles,
      bomLabels,
      boxFaceFallbackWarningLabels,
      buildSourcePreservingExportContent,
      componentSourceDrafts,
      downloadBlob,
      replaceTemplate,
      t.exportClosedLoopUrdfUnsupported,
      t.exportFailedParse,
      throwForAssetPackagingFailures,
      workspace,
    ],
  );

  const handleExportWithConfig = useCallback(
    async (
      config: ExportDialogConfig,
      target: ExportTarget = DEFAULT_EXPORT_TARGET,
      options: HandleExportWithConfigOptions = {},
    ): Promise<ExportExecutionResult> => {
      flushPendingHistory();
      const markCurrentTargetSaved = () => {
        if (target.type === 'current') {
          markUnsavedChangesBaselineSaved();
        }
      };
      if (config.format === 'usd') {
        const { executeUsdExport } = await import('./file-export/usdExport');
        return executeUsdExport({
          config,
          target,
          options,
          assets: workspaceExportAssets,
          requiresResolvedUsdContext,
          t,
          resolveLibraryExportContext,
          resolveExportContext,
          createProgressReporter,
          replaceTemplate,
          trimProgressFileLabel,
          generateZipBlobWithProgress,
          downloadBlob,
          markCurrentTargetSaved,
        });
      }

      return executeConfiguredRobotExport({
        addMeshesToZip,
        assets: workspaceExportAssets,
        boxFaceFallbackWarningLabels,
        buildBomCsv,
        buildSourcePreservingExportContent,
        config,
        createProgressReporter,
        createZip,
        downloadBlob,
        generateZipBlobWithProgress,
        markCurrentTargetSaved,
        normalizedAssemblyState: workspace,
        options,
        prepareMjcfMeshExportAssets: prepareMjcfMeshExportAssetsLazy,
        resolveExportContext,
        resolveLibraryExportContext,
        t,
        target,
        throwForAssetPackagingFailures,
      });
    },
    [
      addMeshesToZip,
      createProgressReporter,
      bomLabels,
      boxFaceFallbackWarningLabels,
      downloadBlob,
      workspaceExportAssets,
      generateZipBlobWithProgress,
      buildSourcePreservingExportContent,
      replaceTemplate,
      resolveLibraryExportContext,
      resolveExportContext,
      requiresResolvedUsdContext,
      t.exportClosedLoopUrdfUnsupported,
      t.exportFailedParse,
      t,
      throwForAssetPackagingFailures,
      trimProgressFileLabel,
      workspace,
    ],
  );

  // Export project as .usp
  const handleExportProject = useCallback(
    async (options: HandleProjectExportOptions = {}): Promise<ProjectExportExecutionResult> => {
      const persistenceCapture = captureProjectExportPersistenceSnapshot();
      const currentAssets = useAssetsStore.getState();
      const { executeProjectExport } = await import('./file-export/projectExport');
      return executeProjectExport({
        options,
        name: persistenceCapture.workspace.name,
        lang,
        workspace: persistenceCapture.workspace,
        workspaceHistory: persistenceCapture.workspaceHistory,
        componentSourceDrafts: currentAssets.componentSourceDrafts,
        assets: {
          availableFiles: currentAssets.availableFiles,
          assetUrls: currentAssets.assets,
          allFileContents: currentAssets.allFileContents,
          motorLibrary: currentAssets.motorLibrary,
          selectedFileName: currentAssets.selectedFile?.name ?? null,
        },
        derivedCaches: {
          usdPreparedExportCaches: currentAssets.usdPreparedExportCaches,
        },
        createProgressReporter,
        downloadBlob,
        replaceTemplate,
        t,
        markAllSaved: markUnsavedChangesBaselineSaved,
        isPersistenceSnapshotCurrent: () =>
          isProjectExportPersistenceSnapshotCurrent(persistenceCapture),
      });
    },
    [
      createProgressReporter,
      downloadBlob,
      lang,
      replaceTemplate,
      t,
    ],
  );

  return {
    handleExportDisconnectedWorkspaceUrdfBundle,
    handleExportProject,
    handleExportWithConfig,
  };
}

export default useFileExport;
