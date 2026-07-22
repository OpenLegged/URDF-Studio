import type JSZip from 'jszip';

import type {
  ExportDialogConfig,
  PrepareMjcfMeshExportAssetsOptions,
  PreparedMjcfMeshExportAssets,
} from '@/features/file-io';
import {
  ensureXacroNamespace,
  generateMujocoXML,
  generateSDF,
  generateSdfModelConfig,
  generateURDF,
  injectGazeboTags,
} from '@/core/parsers';
import type { RosGazeboProfile } from '@/core/parsers';
import { translations } from '@/shared/i18n';
import type { RobotFile, RobotState, AssemblyState } from '@/types';
import type {
  AddRobotAssetsToZipResult,
  RobotAssetPackagingFailure,
} from '@/app/utils/exportArchiveAssets';
import { buildGeneratedUrdfOptions } from '@/app/utils/generatedUrdfOptions';
import { prepareRobotForSdfExport } from './sdfExportRobot';
import {
  addArchiveFilesToZip,
  addSkeletonToZip,
  createArchiveRoot,
} from './archive';
import { applyBoxFaceMaterialExportFallback } from './materialFallbacks';
import type { ExportProgressReporter } from './progress';
import { replaceTemplate, trimProgressFileLabel } from './progress';
import {
  assertAssemblyUrdfExportSupported,
  assertUrdfExportSupported,
  createBoxFaceTextureFallbackWarnings,
  type BoxFaceFallbackWarningLabels,
  resolveDisconnectedWorkspaceUrdfAction,
} from './urdfSupport';
import type {
  ExportContext,
  ExportExecutionResult,
  ExportTarget,
  HandleExportWithConfigOptions,
} from './types';

type ExportTranslations = typeof translations.en;

function resolveRosGazeboProfile(config: ExportDialogConfig['xacro']): RosGazeboProfile {
  if (config.rosVersion === 'ros1') {
    return 'ros1';
  }

  return config.gazeboBackend === 'gz' ? 'ros2_gz' : 'ros2';
}

type AddMeshesToZip = (
  robot: RobotState,
  zip: JSZip,
  compressOptions?: { compressSTL: boolean; stlQuality: number },
  extraMeshFiles?: Map<string, Blob>,
  skipMeshPaths?: ReadonlySet<string>,
  onProgress?: (progress: { completed: number; total: number; currentFile: string }) => void,
) => Promise<AddRobotAssetsToZipResult>;

interface ExecuteConfiguredRobotExportParams {
  addMeshesToZip: AddMeshesToZip;
  assets: Record<string, string>;
  boxFaceFallbackWarningLabels: BoxFaceFallbackWarningLabels;
  buildBomCsv: (robot: RobotState) => string;
  buildSourcePreservingExportContent: (
    format: 'urdf' | 'mjcf' | 'sdf' | 'xacro',
    target: ExportTarget,
    currentRobot: RobotState,
    generatedContent: string,
    options?: { useRelativePaths?: boolean; preferSourceVisualMeshes?: boolean },
  ) => string | null;
  config: ExportDialogConfig;
  createProgressReporter: (
    onProgress: HandleExportWithConfigOptions['onProgress'],
    totalSteps: number,
  ) => ExportProgressReporter;
  createZip: () => Promise<JSZip>;
  downloadBlob: (blob: Blob, fileName: string) => void;
  generateZipBlobWithProgress: (
    zip: JSZip,
    reportProgress: ExportProgressReporter,
    currentStep: number,
  ) => Promise<Blob>;
  markCurrentTargetSaved: () => void;
  normalizedAssemblyState: AssemblyState | null;
  options: HandleExportWithConfigOptions;
  prepareMjcfMeshExportAssets: (
    params: PrepareMjcfMeshExportAssetsOptions,
  ) => Promise<PreparedMjcfMeshExportAssets>;
  resolveExportContext: (target?: ExportTarget) => Promise<ExportContext | null>;
  resolveLibraryExportContext: (file: RobotFile) => Promise<ExportContext>;
  t: ExportTranslations;
  target: ExportTarget;
  throwForAssetPackagingFailures: (failures: RobotAssetPackagingFailure[]) => void;
}

function resolveConfiguredExportTotalSteps(config: ExportDialogConfig): number {
  if (config.format === 'mjcf') {
    return config.mjcf.includeMeshes ? 5 : 4;
  }

  const includeMeshes =
    config.format === 'urdf'
      ? config.urdf.includeMeshes
      : config.format === 'xacro'
        ? config.xacro.includeMeshes
        : config.sdf.includeMeshes;

  return includeMeshes ? 4 : 3;
}

function createAssetProgressCallback(
  reportProgress: ExportProgressReporter,
  t: ExportTranslations,
  step: number,
) {
  return ({ completed, total, currentFile }: { completed: number; total: number; currentFile: string }) => {
    reportProgress(
      step,
      t.exportProgressCollectingAssets,
      replaceTemplate(t.exportProgressCollectingAssetsDetail, {
        current: completed,
        total,
        file: trimProgressFileLabel(currentFile) || t.exportProgressArchiveFallbackFile,
      }),
      {
        stageProgress: total > 0 ? completed / total : 1,
        indeterminate: false,
      },
    );
  };
}

export async function executeConfiguredRobotExport({
  addMeshesToZip,
  assets,
  boxFaceFallbackWarningLabels,
  buildBomCsv,
  buildSourcePreservingExportContent,
  config,
  createProgressReporter,
  createZip,
  downloadBlob,
  generateZipBlobWithProgress,
  markCurrentTargetSaved,
  normalizedAssemblyState,
  options,
  prepareMjcfMeshExportAssets,
  resolveExportContext,
  resolveLibraryExportContext,
  t,
  target,
  throwForAssetPackagingFailures,
}: ExecuteConfiguredRobotExportParams): Promise<ExportExecutionResult> {
  if (
    config.format === 'urdf' &&
    target.type === 'current' &&
    normalizedAssemblyState
  ) {
    assertAssemblyUrdfExportSupported(
      normalizedAssemblyState,
      replaceTemplate,
      t.exportClosedLoopUrdfUnsupported,
    );
  }

  const disconnectedWorkspaceUrdfAction = resolveDisconnectedWorkspaceUrdfAction(
    target,
    config,
    normalizedAssemblyState,
  );
  if (disconnectedWorkspaceUrdfAction) {
    return {
      partial: false,
      warnings: [],
      issues: [],
      actionRequired: disconnectedWorkspaceUrdfAction,
    };
  }

  const totalSteps = resolveConfiguredExportTotalSteps(config);
  const reportProgress = createProgressReporter(options.onProgress, totalSteps);
  reportProgress(1, t.exportProgressPreparing, t.exportProgressPreparingDetail, {
    stageProgress: 0.2,
    indeterminate: true,
  });

  const exportContext =
    target.type === 'library-file'
      ? await resolveLibraryExportContext(target.file)
      : await resolveExportContext(target);
  if (!exportContext) {
    throw new Error(t.exportFailedParse);
  }

  const { robot, exportName, extraMeshFiles } = exportContext;
  const boxFaceFallback =
    config.format === 'urdf' || config.format === 'sdf' || config.format === 'xacro'
      ? applyBoxFaceMaterialExportFallback(robot)
      : null;
  const exportRobot = boxFaceFallback?.robot ?? robot;
  const boxFaceFallbackCount = boxFaceFallback?.records.length ?? 0;
  const assetPackagingFailures: RobotAssetPackagingFailure[] = [];
  const zip = await createZip();
  const archiveRoot = createArchiveRoot(zip, exportName);
  const skeletonUsesMeshes =
    config.format === 'mjcf'
      ? config.mjcf.includeMeshes
      : config.format === 'urdf'
        ? config.urdf.includeMeshes
        : config.format === 'xacro'
          ? config.xacro.includeMeshes
          : config.sdf.includeMeshes;

  if (config.format === 'urdf') {
    assertUrdfExportSupported(
      exportRobot,
      exportName,
      replaceTemplate,
      t.exportClosedLoopUrdfUnsupported,
    );
  }

  if (config.includeSkeleton) {
    addSkeletonToZip(exportRobot, archiveRoot, exportName, skeletonUsesMeshes);
  }

  if (config.format === 'mjcf') {
    const {
      meshdir,
      addFloatBase,
      preferSharedMeshReuse,
      includeActuators,
      actuatorType,
      includeMeshes,
      compressSTL,
      stlQuality,
    } = config.mjcf;
    reportProgress(
      2,
      t.exportProgressPreparingSimulationMeshes,
      t.exportProgressPreparingSimulationMeshesDetail,
      {
        stageProgress: 0.04,
        indeterminate: true,
      },
    );

    const mjcfMeshExport = await prepareMjcfMeshExportAssets({
      robot,
      assets,
      extraMeshFiles,
      preferSharedMeshReuse,
      meshFormat: config.mjcf.meshFormat,
    });

    reportProgress(3, t.exportProgressGeneratingFiles, t.exportProgressGeneratingMjcfDetail, {
      stageProgress: 0.85,
      indeterminate: false,
    });

    const generatedMjcfContent = generateMujocoXML(robot, {
      meshdir,
      addFloatBase,
      includeActuators,
      actuatorType,
      meshPathOverrides: mjcfMeshExport.meshPathOverrides,
      visualMeshVariants: mjcfMeshExport.visualMeshVariants,
    });
    archiveRoot.file(
      `${exportName}.xml`,
      buildSourcePreservingExportContent('mjcf', target, robot, generatedMjcfContent) ??
        generatedMjcfContent,
    );
    if (includeMeshes) {
      reportProgress(
        4,
        t.exportProgressCollectingAssets,
        t.exportProgressCollectingAssetsPreparingDetail,
        {
          stageProgress: 0.04,
          indeterminate: true,
        },
      );

      const meshPackagingResult = await addMeshesToZip(
        robot,
        archiveRoot,
        { compressSTL, stlQuality },
        extraMeshFiles,
        mjcfMeshExport.convertedSourceMeshPaths,
        createAssetProgressCallback(reportProgress, t, 4),
      );
      assetPackagingFailures.push(...meshPackagingResult.failedAssets);
      addArchiveFilesToZip(archiveRoot, 'meshes', mjcfMeshExport.archiveFiles);
    }
    throwForAssetPackagingFailures(assetPackagingFailures);
    const content = await generateZipBlobWithProgress(zip, reportProgress, includeMeshes ? 5 : 4);
    downloadBlob(content, `${exportName}_mjcf.zip`);
    markCurrentTargetSaved();
    return {
      partial: false,
      warnings: [],
      issues: [],
    };
  }

  if (config.format === 'urdf') {
    const {
      includeExtended,
      includeBOM,
      useRelativePaths,
      includeMeshes,
      compressSTL,
      stlQuality,
    } = config.urdf;
    const preferSourceVisualMeshes = config.urdf.preferSourceVisualMeshes;
    const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles, {
      useRelativePaths,
    });
    reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingUrdfDetail, {
      stageProgress: 0.85,
      indeterminate: false,
    });

    const warnings = createBoxFaceTextureFallbackWarnings(
      'urdf',
      boxFaceFallbackCount,
      replaceTemplate,
      boxFaceFallbackWarningLabels,
    );
    const urdfContent = includeExtended
      ? generateURDF(
          exportRobot,
          await buildGeneratedUrdfOptions(extraMeshFiles, { extended: true, useRelativePaths }),
        )
      : (() => {
          const generatedUrdfContent = generateURDF(exportRobot, generatedUrdfOptions);
          return (
            (boxFaceFallbackCount === 0
              ? buildSourcePreservingExportContent(
                  'urdf',
                  target,
                  exportRobot,
                  generatedUrdfContent,
                  {
                    useRelativePaths,
                    preferSourceVisualMeshes,
                  },
                )
              : null) ?? generatedUrdfContent
          );
        })();
    archiveRoot.file(`${exportName}.urdf`, urdfContent);
    if (includeBOM) {
      const hardwareFolder = archiveRoot.folder('hardware');
      hardwareFolder?.file('bom_list.csv', buildBomCsv(exportRobot));
    }
    if (includeMeshes) {
      reportProgress(
        3,
        t.exportProgressCollectingAssets,
        t.exportProgressCollectingAssetsPreparingDetail,
        {
          stageProgress: 0.04,
          indeterminate: true,
        },
      );

      const meshPackagingResult = await addMeshesToZip(
        exportRobot,
        archiveRoot,
        { compressSTL, stlQuality },
        extraMeshFiles,
        undefined,
        createAssetProgressCallback(reportProgress, t, 3),
      );
      assetPackagingFailures.push(...meshPackagingResult.failedAssets);
    }
    throwForAssetPackagingFailures(assetPackagingFailures);
    const content = await generateZipBlobWithProgress(zip, reportProgress, includeMeshes ? 4 : 3);
    downloadBlob(content, `${exportName}_urdf.zip`);
    markCurrentTargetSaved();
    return {
      partial: warnings.length > 0,
      warnings,
      issues: [],
    };
  }

  if (config.format === 'sdf') {
    const { includeMeshes, compressSTL, stlQuality } = config.sdf;
    const sdfRobot = prepareRobotForSdfExport(exportRobot);
    const warnings = createBoxFaceTextureFallbackWarnings(
      'sdf',
      boxFaceFallbackCount,
      replaceTemplate,
      boxFaceFallbackWarningLabels,
    );
    reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingSdfDetail, {
      stageProgress: 0.85,
      indeterminate: false,
    });

    const generatedSdfContent = generateSDF(sdfRobot, {
      packageName: exportName,
    });
    archiveRoot.file(
      'model.sdf',
      buildSourcePreservingExportContent('sdf', target, sdfRobot, generatedSdfContent) ??
        generatedSdfContent,
    );
    archiveRoot.file(
      'model.config',
      generateSdfModelConfig(sdfRobot.name?.trim() || exportName),
    );
    if (includeMeshes) {
      reportProgress(
        3,
        t.exportProgressCollectingAssets,
        t.exportProgressCollectingAssetsPreparingDetail,
        {
          stageProgress: 0.04,
          indeterminate: true,
        },
      );

      const meshPackagingResult = await addMeshesToZip(
        sdfRobot,
        archiveRoot,
        { compressSTL, stlQuality },
        extraMeshFiles,
        undefined,
        createAssetProgressCallback(reportProgress, t, 3),
      );
      assetPackagingFailures.push(...meshPackagingResult.failedAssets);
    }
    throwForAssetPackagingFailures(assetPackagingFailures);
    const content = await generateZipBlobWithProgress(zip, reportProgress, includeMeshes ? 4 : 3);
    downloadBlob(content, `${exportName}_sdf.zip`);
    markCurrentTargetSaved();
    return {
      partial: warnings.length > 0,
      warnings,
      issues: [],
    };
  }

  if (config.format === 'xacro') {
    const {
      includeGazeboControl,
      rosVersion,
      gazeboBackend,
      rosHardwareInterface,
      useRelativePaths,
      includeMeshes,
      compressSTL,
      stlQuality,
    } = config.xacro;
    assertUrdfExportSupported(
      exportRobot,
      exportName,
      replaceTemplate,
      t.exportClosedLoopUrdfUnsupported,
    );
    const generatedUrdfOptions = await buildGeneratedUrdfOptions(extraMeshFiles, {
      useRelativePaths,
    });
    reportProgress(2, t.exportProgressGeneratingFiles, t.exportProgressGeneratingXacroDetail, {
      stageProgress: 0.85,
      indeterminate: false,
    });

    const warnings = createBoxFaceTextureFallbackWarnings(
      'xacro',
      boxFaceFallbackCount,
      replaceTemplate,
      boxFaceFallbackWarningLabels,
    );
    const generatedXacroBaseUrdf = generateURDF(exportRobot, generatedUrdfOptions);
    const rosGazeboProfile = resolveRosGazeboProfile({
      ...config.xacro,
      rosVersion,
      gazeboBackend,
    });
    const generatedXacroContent = includeGazeboControl
      ? injectGazeboTags(
          generatedXacroBaseUrdf,
          exportRobot,
          rosGazeboProfile,
          rosHardwareInterface,
          {
            outputMode: 'selected',
          },
        )
      : ensureXacroNamespace(generatedXacroBaseUrdf);
    const xacroContent =
      (boxFaceFallbackCount === 0
        ? buildSourcePreservingExportContent('xacro', target, exportRobot, generatedXacroContent, {
            useRelativePaths,
          })
        : null) ?? generatedXacroContent;
    archiveRoot.file(`${exportName}.urdf.xacro`, xacroContent);
    if (includeMeshes) {
      reportProgress(
        3,
        t.exportProgressCollectingAssets,
        t.exportProgressCollectingAssetsPreparingDetail,
        {
          stageProgress: 0.04,
          indeterminate: true,
        },
      );

      const meshPackagingResult = await addMeshesToZip(
        exportRobot,
        archiveRoot,
        { compressSTL, stlQuality },
        extraMeshFiles,
        undefined,
        createAssetProgressCallback(reportProgress, t, 3),
      );
      assetPackagingFailures.push(...meshPackagingResult.failedAssets);
    }
    throwForAssetPackagingFailures(assetPackagingFailures);
    const content = await generateZipBlobWithProgress(zip, reportProgress, includeMeshes ? 4 : 3);
    downloadBlob(content, `${exportName}_xacro.zip`);
    markCurrentTargetSaved();
    return {
      partial: warnings.length > 0,
      warnings,
      issues: [],
    };
  }

  return {
    partial: false,
    warnings: [],
    issues: [],
  };
}
