import { GeometryType, JointType } from '@/types';
import type { AssemblyState, BridgeJoint, RobotData, RobotFile, UrdfLink } from '@/types';
import { generateMujocoXML, generateURDF } from '@/core/parsers';
import { normalizeMeshPathForExport, resolveMeshAssetUrl } from '@/core/parsers/meshPathUtils';
import { generateBOM } from './bomGenerator';
import { prepareMjcfMeshExportAssets } from './mjcfMeshExport';
import {
  assertProjectWorkspace,
  assertProjectWorkspaceHistory,
  assertProjectAssetsManifest,
  assertProjectComponentSourceDraftManifest,
  assertProjectManifest,
  buildAssetArchivePath,
  buildLibraryArchivePath,
  chooseCanonicalLogicalPath,
  ensureUniqueLogicalPath,
  MAX_PROJECT_ACTIVITY_ENTRIES,
  MAX_PROJECT_HISTORY_ENTRIES,
  normalizeArchivePath,
  PROJECT_ALL_FILE_CONTENTS_FILE,
  PROJECT_ASSET_MANIFEST_FILE,
  PROJECT_COMPONENT_SOURCE_DRAFTS_FILE,
  PROJECT_COMPONENT_SOURCE_DRAFTS_PREFIX,
  PROJECT_MANIFEST_FILE,
  PROJECT_MOTOR_LIBRARY_FILE,
  PROJECT_USD_PREPARED_EXPORT_CACHES_FILE,
  PROJECT_VERSION,
  PROJECT_WORKSPACE_HISTORY_FILE,
  PROJECT_WORKSPACE_STATE_FILE,
  stringifyProjectJson,
} from './projectArchive';
import { buildUsdPreparedExportCacheEntries } from './projectUsdPreparedExportCaches';
import { buildProjectArchiveBlob } from './projectArchiveZip';
import { buildProjectArchiveBlobWithWorker } from './projectArchiveWorkerBridge';
import type { ProjectArchiveEntryData } from './projectArchiveWorkerTransfer';
import { isAssetLibraryOnlyFormat } from '@/shared/utils/robotFileSupport';
import {
  getVisualGeometryEntries,
  isComponentSourceFormat,
  resolveSourcePreservingComponentDraft,
} from '@/core/robot';
import { buildExportableAssemblyRobotData } from '@/core/robot/assemblyTransforms';
import type {
  ExportProjectParams,
  ExportProjectResult,
  ProjectAssetEntry,
  ProjectAssetsManifest,
  ProjectComponentSourceDraftManifest,
  ProjectExportProgressPhase,
  ProjectExportWarning,
  ProjectManifest,
} from './projectExportTypes';

export type {
  ExportProjectParams,
  ExportProjectResult,
  ProjectExportProgress,
  ProjectExportProgressPhase,
  ProjectExportWarning,
  ProjectExportWarningCode,
  ProjectAssetsManifest,
  ProjectComponentSourceDraftEntry,
  ProjectComponentSourceDraftManifest,
  ProjectDerivedCaches,
  ProjectExportAssets,
  ProjectManifest,
} from './projectExportTypes';

const AXIS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
  JointType.PLANAR,
]);

const FULL_LIMIT_EXPORT_TYPES = new Set<JointType>([JointType.REVOLUTE, JointType.PRISMATIC]);

const EFFORT_VELOCITY_LIMIT_EXPORT_TYPES = new Set<JointType>([JointType.CONTINUOUS]);
const DYNAMICS_EXPORT_TYPES = new Set<JointType>([
  JointType.REVOLUTE,
  JointType.CONTINUOUS,
  JointType.PRISMATIC,
]);

const USP_README_EN = `# URDF Studio Project (.usp) File Format 3.0

The .usp file is a ZIP-compressed package that contains the full URDF Studio workspace state.

## Directory Structure
- manifest.json: Versioned project metadata and archive entry pointers.
- workspace/state.json: Canonical non-empty AssemblyState snapshot.
- workspace/component-source-drafts.json: Optional component-owned editable source drafts.
- components/: Self-contained assembly components.
- assets/: Packed project asset blobs and manifest.
- library/: Asset library source files and extra text content.
- history/: Undo/redo checkpoints and change logs.
- bridges/: Multi-robot assembly connection data.
- output/: Auto-generated export artifacts.
`;

const USP_README_ZH = `# URDF Studio 工程文件 (.usp) 3.0 格式说明

.usp 文件是一个 ZIP 压缩包，包含 URDF Studio 的完整工程状态。

## 目录结构
- manifest.json: 版本化工程元数据与归档入口指针。
- workspace/state.json: canonical 非空 AssemblyState 快照。
- workspace/component-source-drafts.json: 可选的组件专属可编辑源码草稿。
- components/: 自包含的装配组件。
- assets/: 打包后的工程素材及清单。
- library/: 素材库源文件与额外文本内容。
- history/: 撤销/重做快照与变更日志。
- bridges/: 多机器人装配连接数据。
- output/: 自动生成的导出产物。
`;

const COMPONENT_README_EN = `# URDF Studio Component Format

A component folder is a self-contained robot definition.

## Directory Structure
- state.json: JSON snapshot of the component's RobotData.
- meshes/: Component-specific 3D assets.

Editable source is stored by component ownership in workspace/source-drafts/.
`;

const COMPONENT_README_ZH = `# URDF Studio 组件格式说明

组件文件夹是一个自包含的机器人定义。

## 目录结构
- state.json: 组件 RobotData 的当前状态快照。
- meshes/: 组件专用的 3D 资源。

可编辑源码按组件归属存放在 workspace/source-drafts/。
`;

const clampHistoryEntries = <T>(entries: T[] | undefined): T[] =>
  (entries ?? []).slice(-MAX_PROJECT_HISTORY_ENTRIES);
const clampFutureEntries = <T>(entries: T[] | undefined): T[] =>
  (entries ?? []).slice(0, MAX_PROJECT_HISTORY_ENTRIES);

type ProjectArchiveEntries = Map<string, ProjectArchiveEntryData>;

const STRICT_PROJECT_LIBRARY_SOURCE_FORMATS = new Set<RobotFile['format']>([
  'urdf',
  'mjcf',
  'xacro',
  'sdf',
]);

type ProjectPhaseProgressReporter = (progress: {
  completed: number;
  total: number;
  label?: string;
}) => void;

const generateBridgeXml = (bridges: Record<string, BridgeJoint>): string => {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<bridges>\n';

  Object.values(bridges).forEach((bridge) => {
    const { joint } = bridge;
    xml += `  <bridge id="${bridge.id}" name="${bridge.name}" `;
    xml += `parent_comp="${bridge.parentComponentId}" parent_link="${bridge.parentLinkId}" `;
    xml += `child_comp="${bridge.childComponentId}" child_link="${bridge.childLinkId}">\n`;
    xml += `    <joint name="${joint.name}" type="${joint.type}">\n`;
    const quatAttr = joint.origin.quatXyzw
      ? ` quat_xyzw="${joint.origin.quatXyzw.x} ${joint.origin.quatXyzw.y} ${joint.origin.quatXyzw.z} ${joint.origin.quatXyzw.w}"`
      : '';
    xml += `      <origin xyz="${joint.origin.xyz.x} ${joint.origin.xyz.y} ${joint.origin.xyz.z}" `;
    xml += `rpy="${joint.origin.rpy.r} ${joint.origin.rpy.p} ${joint.origin.rpy.y}"${quatAttr} />\n`;

    if (AXIS_EXPORT_TYPES.has(joint.type) && joint.axis) {
      xml += `      <axis xyz="${joint.axis.x} ${joint.axis.y} ${joint.axis.z}" />\n`;

      if (joint.limit) {
        const limitAttributes: string[] = [];
        const appendFiniteLimitAttribute = (name: string, value: number | undefined) => {
          if (typeof value === 'number' && Number.isFinite(value)) {
            limitAttributes.push(`${name}="${value}"`);
          }
        };
        if (FULL_LIMIT_EXPORT_TYPES.has(joint.type)) {
          appendFiniteLimitAttribute('lower', joint.limit.lower);
          appendFiniteLimitAttribute('upper', joint.limit.upper);
        }
        if (EFFORT_VELOCITY_LIMIT_EXPORT_TYPES.has(joint.type)) {
          appendFiniteLimitAttribute('effort', joint.limit.effort);
          appendFiniteLimitAttribute('velocity', joint.limit.velocity);
        }
        if (limitAttributes.length > 0) {
          xml += `      <limit ${limitAttributes.join(' ')} />\n`;
        }
      }
    }

    if (
      DYNAMICS_EXPORT_TYPES.has(joint.type) &&
      joint.dynamics &&
      (joint.dynamics.damping !== 0 || joint.dynamics.friction !== 0)
    ) {
      xml += `      <dynamics damping="${joint.dynamics.damping}" friction="${joint.dynamics.friction}" />\n`;
    }

    if (joint.hardware?.hardwareInterface) {
      xml += '      <hardware>\n';
      xml += `        <hardwareInterface>${joint.hardware.hardwareInterface}</hardwareInterface>\n`;
      xml += '      </hardware>\n';
    }

    if (joint.mimic?.joint) {
      const mimicAttributes = [`joint="${joint.mimic.joint}"`];
      if (typeof joint.mimic.multiplier === 'number' && Number.isFinite(joint.mimic.multiplier)) {
        mimicAttributes.push(`multiplier="${joint.mimic.multiplier}"`);
      }
      if (typeof joint.mimic.offset === 'number' && Number.isFinite(joint.mimic.offset)) {
        mimicAttributes.push(`offset="${joint.mimic.offset}"`);
      }
      xml += `      <mimic ${mimicAttributes.join(' ')} />\n`;
    }

    xml += '    </joint>\n';
    xml += '  </bridge>\n';
  });

  xml += '</bridges>';
  return xml;
};

const getReferencedMeshes = (robot: RobotData): Set<string> => {
  const referencedFiles = new Set<string>();

  Object.values(robot.links).forEach((link: UrdfLink) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.MESH && entry.geometry.meshPath) {
        referencedFiles.add(entry.geometry.meshPath);
      }
    });
    if (link.collision.type === GeometryType.MESH && link.collision.meshPath) {
      referencedFiles.add(link.collision.meshPath);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH && body.meshPath) {
        referencedFiles.add(body.meshPath);
      }
    });
  });

  return referencedFiles;
};

const formatProjectProgressLabel = (value: string | null | undefined): string => {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/');
  if (!normalized) {
    return '';
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= 2) {
    return segments.join('/');
  }

  return segments.slice(-2).join('/');
};

const joinArchivePath = (...segments: Array<string | null | undefined>): string =>
  normalizeArchivePath(
    segments.filter((segment) => typeof segment === 'string' && segment.length > 0).join('/'),
  );

const setProjectArchiveEntry = (
  archiveEntries: ProjectArchiveEntries,
  archivePath: string,
  data: ProjectArchiveEntryData,
): void => {
  archiveEntries.set(normalizeArchivePath(archivePath), data);
};

const writeReferencedMeshesToFolder = async (
  archiveEntries: ProjectArchiveEntries,
  folderPath: string,
  robot: RobotData,
  assets: Record<string, string>,
  skipMeshPaths?: ReadonlySet<string>,
  onProgress?: ProjectPhaseProgressReporter,
): Promise<ProjectExportWarning[]> => {
  const writtenPaths = new Set<string>();
  const warnings: ProjectExportWarning[] = [];
  const meshPaths = Array.from(getReferencedMeshes(robot)).filter(
    (meshPath) => !skipMeshPaths?.has(meshPath),
  );
  const totalMeshes = meshPaths.length;
  let completedMeshes = 0;

  if (totalMeshes > 0) {
    onProgress?.({
      completed: 0,
      total: totalMeshes,
      label: formatProjectProgressLabel(meshPaths[0]),
    });
  }

  await Promise.all(
    meshPaths.map(async (meshPath) => {
      const exportPath = normalizeMeshPathForExport(meshPath);
      if (!exportPath || writtenPaths.has(exportPath)) {
        completedMeshes += 1;
        onProgress?.({
          completed: completedMeshes,
          total: totalMeshes,
          label: formatProjectProgressLabel(meshPath),
        });
        return;
      }
      writtenPaths.add(exportPath);

      const blobUrl = resolveMeshAssetUrl(meshPath, assets);
      try {
        if (!blobUrl) {
          warnings.push({
            code: 'project_mesh_asset_missing',
            message: `Missing mesh asset for project export: ${meshPath}`,
            context: {
              meshPath,
              exportPath,
            },
          });
          return;
        }

        const response = await fetch(blobUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        setProjectArchiveEntry(archiveEntries, joinArchivePath(folderPath, exportPath), blob);
      } catch (error) {
        console.error(`[ProjectExport] Failed to package mesh "${meshPath}"`, error);
        warnings.push({
          code: 'project_mesh_package_failed',
          message: `Failed to package mesh "${meshPath}": ${error instanceof Error ? error.message : String(error)}`,
          context: {
            meshPath,
            exportPath,
          },
        });
      } finally {
        completedMeshes += 1;
        onProgress?.({
          completed: completedMeshes,
          total: totalMeshes,
          label: formatProjectProgressLabel(meshPath),
        });
      }
    }),
  );

  return warnings;
};

const assertNoProjectExportWarnings = (warnings: ProjectExportWarning[]): void => {
  const [firstWarning] = warnings;
  if (!firstWarning) {
    return;
  }

  throw new Error(firstWarning.message);
};

const cloneCanonicalWorkspace = (state: AssemblyState): AssemblyState => {
  assertProjectWorkspace(state);
  const clone = structuredClone(state);
  assertProjectWorkspace(clone);
  return clone;
};

const writeTextLibraryFiles = (
  archiveEntries: ProjectArchiveEntries,
  availableFiles: RobotFile[],
  assetMap: Record<string, string>,
  allFileContents: Record<string, string>,
): void => {
  availableFiles.forEach((file) => {
    if (isAssetLibraryOnlyFormat(file.format)) return;
    const content = file.content || allFileContents[file.name] || '';
    if (content.length === 0) {
      const normalizedName = file.name.replace(/^\/+/, '');
      const hasBlobBackedUsdSource =
        file.format === 'usd' &&
        Boolean(file.blobUrl || assetMap[normalizedName] || assetMap[`/${normalizedName}`]);

      if (STRICT_PROJECT_LIBRARY_SOURCE_FORMATS.has(file.format) || !hasBlobBackedUsdSource) {
        throw new Error(`Missing library source content for project export: ${file.name}`);
      }
    }
    setProjectArchiveEntry(archiveEntries, buildLibraryArchivePath(file.name), content);
  });
};

const writeMatchingComponentSourceDrafts = (
  archiveEntries: ProjectArchiveEntries,
  workspace: AssemblyState,
  drafts: ExportProjectParams['componentSourceDrafts'],
): ProjectComponentSourceDraftManifest | null => {
  if (!drafts) return null;

  const manifest: ProjectComponentSourceDraftManifest = { drafts: [] };
  Object.keys(workspace.components).sort().forEach((componentId) => {
    const draft = drafts[componentId];
    if (
      !draft
      || draft.format === 'usd'
      || typeof draft.content !== 'string'
      || draft.content.length === 0
      || typeof draft.robotSnapshotHash !== 'string'
      || !isComponentSourceFormat(draft.format)
    ) {
      return;
    }
    const resolution = resolveSourcePreservingComponentDraft({
      workspace,
      componentId,
      drafts,
    });
    if (resolution.status !== 'matched') return;

    const contentPath = `${PROJECT_COMPONENT_SOURCE_DRAFTS_PREFIX}${manifest.drafts.length
      .toString()
      .padStart(4, '0')}.txt`;
    manifest.drafts.push({
      componentId,
      format: draft.format,
      robotSnapshotHash: draft.robotSnapshotHash,
      contentPath,
    });
    setProjectArchiveEntry(archiveEntries, contentPath, draft.content);
  });

  if (manifest.drafts.length === 0) return null;
  assertProjectComponentSourceDraftManifest(manifest, workspace);
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_COMPONENT_SOURCE_DRAFTS_FILE,
    stringifyProjectJson(manifest),
  );
  return manifest;
};

const writePackedAssets = async (
  archiveEntries: ProjectArchiveEntries,
  assetMap: Record<string, string>,
  onProgress?: ProjectPhaseProgressReporter,
): Promise<{ assetEntries: ProjectAssetEntry[]; warnings: ProjectExportWarning[] }> => {
  const urlToKeys = new Map<string, string[]>();
  Object.entries(assetMap).forEach(([key, url]) => {
    if (!url) return;
    const existingKeys = urlToKeys.get(url) ?? [];
    existingKeys.push(key);
    urlToKeys.set(url, existingKeys);
  });

  const usedLogicalPaths = new Set<string>();
  const assetEntries: ProjectAssetEntry[] = [];
  const warnings: ProjectExportWarning[] = [];
  const assetJobs = Array.from(urlToKeys.entries());
  const totalAssets = assetJobs.length;
  let completedAssets = 0;

  if (totalAssets > 0) {
    onProgress?.({
      completed: 0,
      total: totalAssets,
      label: formatProjectProgressLabel(assetJobs[0]?.[1]?.[0] ?? assetJobs[0]?.[0]),
    });
  }

  await Promise.all(
    assetJobs.map(async ([url, keys], index) => {
      try {
        const fallbackName = keys.find((key) => /\.[a-z0-9]+$/i.test(key)) ?? `asset_${index}`;
        const canonicalPath = chooseCanonicalLogicalPath(keys, fallbackName);
        const logicalPath = ensureUniqueLogicalPath(canonicalPath, usedLogicalPaths, fallbackName);
        const archivePath = buildAssetArchivePath(logicalPath);
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const blob = await response.blob();
        setProjectArchiveEntry(archiveEntries, archivePath, blob);
        assetEntries.push({ logicalPath, archivePath });
      } catch (error) {
        console.error('[ProjectExport] Failed to pack asset', keys[0] ?? url, error);
        warnings.push({
          code: 'project_asset_pack_failed',
          message: `Failed to pack asset "${keys[0] ?? url}": ${error instanceof Error ? error.message : String(error)}`,
          context: {
            key: keys[0] ?? url,
          },
        });
      } finally {
        completedAssets += 1;
        onProgress?.({
          completed: completedAssets,
          total: totalAssets,
          label: formatProjectProgressLabel(keys[0] ?? url),
        });
      }
    }),
  );

  assetEntries.sort((left, right) => left.logicalPath.localeCompare(right.logicalPath));
  return {
    assetEntries,
    warnings,
  };
};

async function buildProjectArchiveEntries(params: ExportProjectParams): Promise<{
  archiveEntries: ProjectArchiveEntries;
  warnings: ProjectExportWarning[];
}> {
  const {
    name,
    assets,
    derivedCaches,
    workspace,
    workspaceHistory,
    componentSourceDrafts,
    onProgress,
  } = params;

  // Validate all canonical state before fetching assets or constructing a partial archive.
  const currentWorkspace = cloneCanonicalWorkspace(workspace);
  const serializedWorkspaceHistory = {
    past: clampHistoryEntries(workspaceHistory.past).map(cloneCanonicalWorkspace),
    future: clampFutureEntries(workspaceHistory.future).map(cloneCanonicalWorkspace),
    activity: structuredClone(
      workspaceHistory.activity.slice(-MAX_PROJECT_ACTIVITY_ENTRIES),
    ),
  };
  assertProjectWorkspaceHistory(serializedWorkspaceHistory);

  const emitPhaseProgress = (
    phase: ProjectExportProgressPhase,
    completed: number,
    total: number,
    label?: string,
  ) => {
    onProgress?.({
      phase,
      completed: Math.min(Math.max(0, completed), Math.max(total, 1)),
      total: Math.max(total, 1),
      label: formatProjectProgressLabel(label),
    });
  };

  const archiveEntries: ProjectArchiveEntries = new Map();
  const warnings: ProjectExportWarning[] = [];
  const packedAssets = await writePackedAssets(
    archiveEntries,
    assets.assetUrls,
    ({ completed, total, label }) => {
      emitPhaseProgress('assets', completed, total, label);
    },
  );
  warnings.push(...packedAssets.warnings);
  assertNoProjectExportWarnings(packedAssets.warnings);
  const assetEntries = packedAssets.assetEntries;

  const metadataProgressTotal = 6;
  emitPhaseProgress(
    'metadata',
    0,
    metadataProgressTotal,
    assets.availableFiles[0]?.name ?? PROJECT_ALL_FILE_CONTENTS_FILE,
  );
  writeTextLibraryFiles(
    archiveEntries,
    assets.availableFiles,
    assets.assetUrls,
    assets.allFileContents,
  );
  emitPhaseProgress(
    'metadata',
    1,
    metadataProgressTotal,
    assets.availableFiles[0]?.name ?? PROJECT_ALL_FILE_CONTENTS_FILE,
  );
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_ALL_FILE_CONTENTS_FILE,
    stringifyProjectJson(assets.allFileContents),
  );
  emitPhaseProgress('metadata', 2, metadataProgressTotal, PROJECT_ALL_FILE_CONTENTS_FILE);
  const usdPreparedExportCacheEntries = await buildUsdPreparedExportCacheEntries(
    derivedCaches?.usdPreparedExportCaches ?? {},
  );
  usdPreparedExportCacheEntries.forEach((entry, path) => {
    setProjectArchiveEntry(archiveEntries, path, entry);
  });
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_MOTOR_LIBRARY_FILE,
    stringifyProjectJson(assets.motorLibrary),
  );
  emitPhaseProgress('metadata', 3, metadataProgressTotal, PROJECT_USD_PREPARED_EXPORT_CACHES_FILE);

  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_WORKSPACE_STATE_FILE,
    stringifyProjectJson(currentWorkspace),
  );
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_WORKSPACE_HISTORY_FILE,
    stringifyProjectJson(serializedWorkspaceHistory),
  );
  const sourceDraftManifest = writeMatchingComponentSourceDrafts(
    archiveEntries,
    currentWorkspace,
    componentSourceDrafts,
  );
  emitPhaseProgress('metadata', 4, metadataProgressTotal, PROJECT_WORKSPACE_HISTORY_FILE);

  const assetsManifest: ProjectAssetsManifest = {
    availableFiles: assets.availableFiles.map((file) => ({
      name: file.name,
      format: file.format,
    })),
    selectedFileName: assets.selectedFileName,
    packedFiles: assetEntries,
  };
  assertProjectAssetsManifest(assetsManifest);
  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_ASSET_MANIFEST_FILE,
    stringifyProjectJson(assetsManifest),
  );
  emitPhaseProgress('metadata', 5, metadataProgressTotal, PROJECT_ASSET_MANIFEST_FILE);

  const manifest: ProjectManifest = {
    version: PROJECT_VERSION,
    metadata: {
      name: name.trim() || 'unnamed_project',
      lastModified: new Date().toISOString(),
    },
    entries: {
      workspace: PROJECT_WORKSPACE_STATE_FILE,
      workspaceHistory: PROJECT_WORKSPACE_HISTORY_FILE,
      assets: PROJECT_ASSET_MANIFEST_FILE,
      allFileContents: PROJECT_ALL_FILE_CONTENTS_FILE,
      motorLibrary: PROJECT_MOTOR_LIBRARY_FILE,
      ...(sourceDraftManifest
        ? { componentSourceDrafts: PROJECT_COMPONENT_SOURCE_DRAFTS_FILE }
        : {}),
      ...(usdPreparedExportCacheEntries.has(PROJECT_USD_PREPARED_EXPORT_CACHES_FILE)
        ? { usdPreparedExportCaches: PROJECT_USD_PREPARED_EXPORT_CACHES_FILE }
        : {}),
    },
  };
  assertProjectManifest(manifest);

  setProjectArchiveEntry(
    archiveEntries,
    PROJECT_MANIFEST_FILE,
    stringifyProjectJson(manifest),
  );
  setProjectArchiveEntry(archiveEntries, 'README.md', USP_README_EN);
  setProjectArchiveEntry(archiveEntries, 'README_ZH.md', USP_README_ZH);
  emitPhaseProgress('metadata', 6, metadataProgressTotal, PROJECT_MANIFEST_FILE);

  {
    const componentPlans = Object.values(currentWorkspace.components).map((component) => ({
      component,
      meshPaths: Array.from(getReferencedMeshes(component.robot)),
    }));
    const totalComponentTasks = componentPlans.reduce(
      (sum, plan) => sum + 1 + plan.meshPaths.length,
      0,
    );
    const componentAssetTasks: Promise<void>[] = [];
    let completedComponentTasks = 0;

    if (totalComponentTasks > 0) {
      emitPhaseProgress(
        'components',
        0,
        totalComponentTasks,
        componentPlans[0]?.component.name ?? componentPlans[0]?.component.id ?? 'components',
      );
    }

    componentPlans.forEach(({ component, meshPaths }) => {
      const componentFolderPath = joinArchivePath('components', component.id);

      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(componentFolderPath, 'state.json'),
        stringifyProjectJson(component.robot),
      );
      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(componentFolderPath, 'README.md'),
        COMPONENT_README_EN,
      );
      setProjectArchiveEntry(
        archiveEntries,
        joinArchivePath(componentFolderPath, 'README_ZH.md'),
        COMPONENT_README_ZH,
      );

      completedComponentTasks += 1;
      emitPhaseProgress(
        'components',
        completedComponentTasks,
        Math.max(totalComponentTasks, 1),
        component.name || component.id,
      );

      if (meshPaths.length === 0) return;

      meshPaths.forEach((meshPath) => {
        const blobUrl = assets.assetUrls[meshPath];
        if (!blobUrl) {
          warnings.push({
            code: 'project_component_mesh_asset_missing',
            message: `Missing component mesh asset "${meshPath}" for ${component.id}`,
            context: {
              componentId: component.id,
              meshPath,
            },
          });
          completedComponentTasks += 1;
          emitPhaseProgress(
            'components',
            completedComponentTasks,
            Math.max(totalComponentTasks, 1),
            meshPath,
          );
          return;
        }
        const task = fetch(blobUrl)
          .then((response) => {
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            return response.blob();
          })
          .then(async (blob) => {
            setProjectArchiveEntry(
              archiveEntries,
              joinArchivePath(componentFolderPath, 'meshes', meshPath.split('/').pop() || meshPath),
              blob,
            );
          })
          .catch((error) => {
            console.error(
              `[ProjectExport] Failed to package component mesh "${meshPath}" for ${component.id}`,
              error,
            );
            warnings.push({
              code: 'project_component_mesh_package_failed',
              message: `Failed to package component mesh "${meshPath}" for ${component.id}: ${error instanceof Error ? error.message : String(error)}`,
              context: {
                componentId: component.id,
                meshPath,
              },
            });
          })
          .finally(() => {
            completedComponentTasks += 1;
            emitPhaseProgress(
              'components',
              completedComponentTasks,
              Math.max(totalComponentTasks, 1),
              meshPath,
            );
          });
        componentAssetTasks.push(task);
      });
    });

    if (totalComponentTasks === 0) {
      emitPhaseProgress('components', 1, 1, 'components');
    }

    await Promise.all(componentAssetTasks);
    assertNoProjectExportWarnings(warnings);
  }

  if (Object.keys(currentWorkspace.bridges).length > 0) {
    setProjectArchiveEntry(
      archiveEntries,
      'bridges/bridge.xml',
      generateBridgeXml(currentWorkspace.bridges),
    );
  }

  const mergedRobot = buildExportableAssemblyRobotData(currentWorkspace);
  {
    emitPhaseProgress('output', 0, 1, mergedRobot.name);
    const robotForExport = {
      ...mergedRobot,
      selection: { type: null, id: null },
    } as RobotData & { selection: { type: null; id: null } };
    const mjcfMeshExport = await prepareMjcfMeshExportAssets({
      robot: robotForExport,
      assets: assets.assetUrls,
    });
    const outputMeshCount = Array.from(getReferencedMeshes(mergedRobot)).filter(
      (meshPath) => !mjcfMeshExport.convertedSourceMeshPaths.has(meshPath),
    ).length;
    const totalOutputTasks = 4 + outputMeshCount + mjcfMeshExport.archiveFiles.size;
    let completedOutputTasks = 0;

    emitPhaseProgress('output', 0, totalOutputTasks, `${mergedRobot.name}.urdf`);

    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', `${mergedRobot.name}.urdf`),
      generateURDF(robotForExport, false),
    );
    completedOutputTasks += 1;
    emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, `${mergedRobot.name}.urdf`);
    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', `${mergedRobot.name}_extended.urdf`),
      generateURDF(robotForExport, true),
    );
    completedOutputTasks += 1;
    emitPhaseProgress(
      'output',
      completedOutputTasks,
      totalOutputTasks,
      `${mergedRobot.name}_extended.urdf`,
    );
    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', `${mergedRobot.name}.xml`),
      generateMujocoXML(robotForExport, {
        meshdir: 'meshes/',
        meshPathOverrides: mjcfMeshExport.meshPathOverrides,
        visualMeshVariants: mjcfMeshExport.visualMeshVariants,
      }),
    );
    completedOutputTasks += 1;
    emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, `${mergedRobot.name}.xml`);
    setProjectArchiveEntry(
      archiveEntries,
      joinArchivePath('output', 'bom.csv'),
      generateBOM(robotForExport, params.lang as 'en' | 'zh'),
    );
    completedOutputTasks += 1;
    emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, 'bom.csv');

    const outputMeshWarnings = await writeReferencedMeshesToFolder(
      archiveEntries,
      joinArchivePath('output', 'meshes'),
      mergedRobot,
      assets.assetUrls,
      mjcfMeshExport.convertedSourceMeshPaths,
      ({ completed, label }) => {
        emitPhaseProgress('output', completedOutputTasks + completed, totalOutputTasks, label);
      },
    );
    warnings.push(...outputMeshWarnings);
    assertNoProjectExportWarnings(outputMeshWarnings);
    completedOutputTasks += outputMeshCount;
    await Promise.all(
      Array.from(mjcfMeshExport.archiveFiles.entries()).map(async ([relativePath, blob]) => {
        setProjectArchiveEntry(
          archiveEntries,
          joinArchivePath('output', 'meshes', relativePath),
          blob,
        );
        completedOutputTasks += 1;
        emitPhaseProgress('output', completedOutputTasks, totalOutputTasks, relativePath);
      }),
    );
  }

  return {
    archiveEntries,
    warnings,
  };
}

export async function exportProject(params: ExportProjectParams): Promise<ExportProjectResult> {
  const { name, onProgress } = params;
  const emitPhaseProgress = (
    phase: ProjectExportProgressPhase,
    completed: number,
    total: number,
    label?: string,
  ) => {
    onProgress?.({
      phase,
      completed: Math.min(Math.max(0, completed), Math.max(total, 1)),
      total: Math.max(total, 1),
      label: formatProjectProgressLabel(label),
    });
  };

  const { archiveEntries, warnings } = await buildProjectArchiveEntries(params);
  emitPhaseProgress('archive', 0, 100);
  const blob = await buildProjectArchiveBlob(archiveEntries, {
    onProgress: ({ completed, total, label }) => {
      emitPhaseProgress('archive', completed, total, label);
    },
  });
  emitPhaseProgress('archive', 100, 100, `${name || 'project'}.usp`);

  return {
    blob,
    partial: false,
    warnings,
  };
}

export async function exportProjectWithWorker(
  params: ExportProjectParams,
): Promise<ExportProjectResult> {
  const { name, onProgress } = params;
  const emitPhaseProgress = (
    phase: ProjectExportProgressPhase,
    completed: number,
    total: number,
    label?: string,
  ) => {
    onProgress?.({
      phase,
      completed: Math.min(Math.max(0, completed), Math.max(total, 1)),
      total: Math.max(total, 1),
      label: formatProjectProgressLabel(label),
    });
  };

  const { archiveEntries, warnings } = await buildProjectArchiveEntries(params);
  emitPhaseProgress('archive', 0, 100);
  const blob = await buildProjectArchiveBlobWithWorker(archiveEntries, {
    onProgress: ({ completed, total, label }) => {
      emitPhaseProgress('archive', completed, total, label);
    },
  });
  emitPhaseProgress('archive', 100, 100, `${name || 'project'}.usp`);

  return {
    blob,
    partial: false,
    warnings,
  };
}
