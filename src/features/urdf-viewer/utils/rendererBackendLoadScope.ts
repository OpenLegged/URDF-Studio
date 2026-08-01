import type { RobotData, RobotFile, UrdfJoint, UrdfLink } from '@/types';
import type { RobotPrimitiveGeometryDetail } from '@/core/parsers/urdf/loader/primitiveGeometry';
import { isUsdLikeFormat } from '@/core/parsers/usd';
import { createStableJsonSnapshot } from '@/shared/utils/robot/semanticSnapshot';
import {
  createViewerRobotLoadInputSignature,
  stripPatchableRuntimeStateFromJoints,
} from './robotLoadScope';
import {
  areRobotLinkChangesVisibilityOnly,
  detectJointPatches,
  detectGeometryPatches,
} from './robotLoaderDiff';

interface CreateRendererBackendLoadScopeKeyOptions {
  sourceFile: RobotFile;
  availableFiles?: RobotFile[];
  assets: Record<string, string>;
  reloadToken?: number;
  allowUrdfXmlFallback?: boolean;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
  robotData?: RobotData | null;
  primitiveGeometryDetail?: RobotPrimitiveGeometryDetail;
  textureAnisotropy?: number;
  materialDithering?: boolean;
}

export interface RendererBackendLoadScopeKeyMemo {
  lastKey?: string;
  lastSourceFile?: RobotFile;
  lastAvailableFiles?: RobotFile[];
  lastAssets?: Record<string, string>;
  lastReloadToken?: number;
  lastAllowUrdfXmlFallback?: boolean;
  lastRenderQualitySignature?: string;
  lastResolvedRobotLinks?: Record<string, UrdfLink>;
  lastResolvedRobotJoints?: Record<string, UrdfJoint>;
  lastResolvedRobotJointsSignature?: string;
  lastRuntimeBuildMetadataSignature?: string;
  lastRuntimeBuildNonPatchableMetadataSignature?: string;
  lastRuntimePatchAwaitingSourceContent?: boolean;
}

function hashStringFNV1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function hashStableValue(value: unknown): string {
  return hashStringFNV1a(createStableJsonSnapshot(value));
}

function createRenderQualitySignature(options: CreateRendererBackendLoadScopeKeyOptions): string {
  return hashStableValue({
    primitiveGeometryDetail: options.primitiveGeometryDetail ?? null,
    textureAnisotropy: options.textureAnisotropy ?? null,
    materialDithering: options.materialDithering ?? null,
  });
}

function cloneMemoSnapshot<T>(value: T): T {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function createAssetSignature(assets: Record<string, string>): string {
  return hashStableValue(
    Object.entries(assets)
      .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
      .map(([path, url]) => [path, url]),
  );
}

function createAvailableFilesSignature(availableFiles: RobotFile[] | undefined): string {
  return hashStableValue(
    (availableFiles ?? [])
      .map((file) => ({
        name: file.name,
        format: file.format,
        blobUrl: file.blobUrl ?? null,
        content: hashStringFNV1a(file.content ?? ''),
      }))
      .sort((left, right) =>
        `${left.format}:${left.name}`.localeCompare(`${right.format}:${right.name}`),
      ),
  );
}

function createSourceFileIdentitySignature(sourceFile: RobotFile | undefined): string {
  if (!sourceFile) {
    return '';
  }

  return hashStableValue({
    name: sourceFile.name,
    format: sourceFile.format,
    blobUrl: sourceFile.blobUrl ?? null,
  });
}

const PATCHABLE_RUNTIME_SOURCE_FORMATS = new Set<RobotFile['format']>([
  'urdf',
  'xacro',
  'sdf',
  'mjcf',
]);

function isPatchableRuntimeSourceFile(file: RobotFile | undefined): boolean {
  return Boolean(file && PATCHABLE_RUNTIME_SOURCE_FORMATS.has(file.format));
}

function createAvailableFilesRuntimePatchReuseSignature(
  availableFiles: RobotFile[] | undefined,
): string {
  return hashStableValue(
    (availableFiles ?? [])
      .filter((file) => !isPatchableRuntimeSourceFile(file))
      .map((file) => ({
        name: file.name,
        format: file.format,
        blobUrl: file.blobUrl ?? null,
        content: hashStringFNV1a(file.content ?? ''),
      }))
      .sort((left, right) =>
        `${left.format}:${left.name}`.localeCompare(`${right.format}:${right.name}`),
      ),
  );
}

function createPatchableAvailableFileContentSignature(
  availableFiles: RobotFile[] | undefined,
): string {
  return hashStableValue(
    (availableFiles ?? [])
      .filter(isPatchableRuntimeSourceFile)
      .map((file) => ({
        name: file.name,
        format: file.format,
        blobUrl: file.blobUrl ?? null,
        content: hashStringFNV1a(file.content ?? ''),
      }))
      .sort((left, right) =>
        `${left.format}:${left.name}`.localeCompare(`${right.format}:${right.name}`),
      ),
  );
}

function createJointStructureSignature(joints: Record<string, UrdfJoint> | undefined): string {
  if (!joints) {
    return '';
  }

  return hashStableValue(stripPatchableRuntimeStateFromJoints(joints));
}

function createRuntimeBuildMetadataSignature(robotData: RobotData | null | undefined): string {
  return hashStableValue({
    name: robotData?.name ?? null,
    rootLinkId: robotData?.rootLinkId ?? null,
    materials: robotData?.materials ?? null,
    inspectionContext: robotData?.inspectionContext ?? null,
  });
}

function createRuntimeBuildNonPatchableMetadataSignature(
  robotData: RobotData | null | undefined,
): string {
  return hashStableValue({
    name: robotData?.name ?? null,
    rootLinkId: robotData?.rootLinkId ?? null,
    inspectionContext: robotData?.inspectionContext ?? null,
  });
}

function hasRuntimePatchableGeometryChanges(
  previousLinks: Record<string, UrdfLink>,
  resolvedRobotLinks: Record<string, UrdfLink>,
): boolean {
  const patches = detectGeometryPatches(previousLinks, resolvedRobotLinks);
  if (!patches || patches.length === 0) {
    return false;
  }

  return patches.every((patch) =>
    Boolean(
      patch.linkNameChanged ||
        patch.visualChanged ||
        patch.visualBodiesChanged ||
        patch.collisionChanged ||
        patch.collisionBodiesChanged ||
        patch.inertialChanged ||
        patch.visibilityChanged,
    ),
  );
}

function areRobotLinksExactlyEqual(
  previousLinks: Record<string, UrdfLink> | undefined,
  resolvedRobotLinks: Record<string, UrdfLink> | undefined,
): boolean {
  if (!previousLinks || !resolvedRobotLinks) {
    return false;
  }

  return hashStableValue(previousLinks) === hashStableValue(resolvedRobotLinks);
}

function areRobotJointsExactlyEqual(
  previousJoints: Record<string, UrdfJoint> | undefined,
  resolvedRobotJoints: Record<string, UrdfJoint> | undefined,
): boolean {
  if (!previousJoints || !resolvedRobotJoints) {
    return false;
  }

  return hashStableValue(previousJoints) === hashStableValue(resolvedRobotJoints);
}

function hasRuntimePatchableJointChanges(
  previousJoints: Record<string, UrdfJoint> | undefined,
  resolvedRobotJoints: Record<string, UrdfJoint> | undefined,
): boolean {
  const patches = detectJointPatches(previousJoints ?? null, resolvedRobotJoints);
  return Boolean(patches && patches.length > 0);
}

function hasActiveSourceFileContentChange(
  previousSourceFile: RobotFile | undefined,
  sourceFile: RobotFile,
): boolean {
  if (!previousSourceFile) {
    return false;
  }

  return (previousSourceFile.content ?? '') !== (sourceFile.content ?? '');
}

function hasPatchableAvailableFileContentChange(
  previousAvailableFiles: RobotFile[] | undefined,
  availableFiles: RobotFile[] | undefined,
): boolean {
  return (
    createPatchableAvailableFileContentSignature(previousAvailableFiles) !==
    createPatchableAvailableFileContentSignature(availableFiles)
  );
}

function hasRuntimePatchSourceContentChange(
  options: CreateRendererBackendLoadScopeKeyOptions,
  memo: RendererBackendLoadScopeKeyMemo,
): boolean {
  return (
    hasActiveSourceFileContentChange(memo.lastSourceFile, options.sourceFile) ||
    hasPatchableAvailableFileContentChange(memo.lastAvailableFiles, options.availableFiles)
  );
}

function hasCompatibleRuntimePatchReuseScope(
  options: CreateRendererBackendLoadScopeKeyOptions,
  memo: RendererBackendLoadScopeKeyMemo,
  nextRuntimeBuildNonPatchableMetadataSignature: string,
): boolean {
  if (!memo.lastKey || !memo.lastSourceFile) {
    return false;
  }

  if (memo.lastReloadToken !== (options.reloadToken ?? 0)) {
    return false;
  }

  if (memo.lastAllowUrdfXmlFallback !== (options.allowUrdfXmlFallback ?? false)) {
    return false;
  }

  if (memo.lastRenderQualitySignature !== createRenderQualitySignature(options)) {
    return false;
  }

  if (createAssetSignature(memo.lastAssets ?? {}) !== createAssetSignature(options.assets)) {
    return false;
  }

  if (
    createSourceFileIdentitySignature(memo.lastSourceFile) !==
    createSourceFileIdentitySignature(options.sourceFile)
  ) {
    return false;
  }

  if (
    memo.lastRuntimeBuildNonPatchableMetadataSignature !==
    nextRuntimeBuildNonPatchableMetadataSignature
  ) {
    return false;
  }

  return (
    createAvailableFilesRuntimePatchReuseSignature(memo.lastAvailableFiles) ===
    createAvailableFilesRuntimePatchReuseSignature(options.availableFiles)
  );
}

interface RendererBackendLoadScopeMemoContext {
  options: CreateRendererBackendLoadScopeKeyOptions;
  memo: RendererBackendLoadScopeKeyMemo;
  resolvedRobotLinks: Record<string, UrdfLink> | undefined;
  resolvedRobotJoints: Record<string, UrdfJoint> | undefined;
  nextJointStructureSignature: string;
  nextRuntimeBuildMetadataSignature: string;
  nextRuntimeBuildNonPatchableMetadataSignature: string;
}

function updateMemoSnapshot(
  context: RendererBackendLoadScopeMemoContext,
  awaitingSourceContent: boolean,
): void {
  const {
    options,
    memo,
    resolvedRobotLinks,
    resolvedRobotJoints,
    nextJointStructureSignature,
    nextRuntimeBuildMetadataSignature,
    nextRuntimeBuildNonPatchableMetadataSignature,
  } = context;
  memo.lastSourceFile = cloneMemoSnapshot(options.sourceFile);
  memo.lastAvailableFiles = cloneMemoSnapshot(options.availableFiles);
  memo.lastAssets = cloneMemoSnapshot(options.assets);
  memo.lastReloadToken = options.reloadToken ?? 0;
  memo.lastAllowUrdfXmlFallback = options.allowUrdfXmlFallback ?? false;
  memo.lastRenderQualitySignature = createRenderQualitySignature(options);
  memo.lastResolvedRobotLinks = cloneMemoSnapshot(resolvedRobotLinks);
  memo.lastResolvedRobotJoints = cloneMemoSnapshot(resolvedRobotJoints);
  memo.lastResolvedRobotJointsSignature = nextJointStructureSignature;
  memo.lastRuntimeBuildMetadataSignature = nextRuntimeBuildMetadataSignature;
  memo.lastRuntimeBuildNonPatchableMetadataSignature =
    nextRuntimeBuildNonPatchableMetadataSignature;
  memo.lastRuntimePatchAwaitingSourceContent = awaitingSourceContent;
}

function canReuseMemoizedKeyForRuntimePatch({
  options,
  memo,
  resolvedRobotLinks,
  resolvedRobotJoints,
  nextJointStructureSignature,
  nextRuntimeBuildNonPatchableMetadataSignature,
}: RendererBackendLoadScopeMemoContext): boolean {
  if (
    !hasCompatibleRuntimePatchReuseScope(
      options,
      memo,
      nextRuntimeBuildNonPatchableMetadataSignature,
    )
  ) {
    return false;
  }

  if (
    isUsdLikeFormat(options.sourceFile.format) &&
    hasRuntimePatchSourceContentChange(options, memo)
  ) {
    return false;
  }

  if (!memo.lastResolvedRobotLinks || !resolvedRobotLinks) {
    return false;
  }

  if (memo.lastResolvedRobotJointsSignature !== nextJointStructureSignature) {
    return false;
  }

  const linkChangePatchable = Boolean(
    hasRuntimePatchableGeometryChanges(memo.lastResolvedRobotLinks, resolvedRobotLinks) ||
      areRobotLinkChangesVisibilityOnly(memo.lastResolvedRobotLinks, resolvedRobotLinks),
  );
  const jointChangePatchable =
    areRobotLinksExactlyEqual(memo.lastResolvedRobotLinks, resolvedRobotLinks) &&
    hasRuntimePatchableJointChanges(memo.lastResolvedRobotJoints, resolvedRobotJoints);

  return linkChangePatchable || jointChangePatchable;
}

function canReuseMemoizedKeyForUnchangedRuntimeState({
  options,
  memo,
  resolvedRobotLinks,
  resolvedRobotJoints,
  nextJointStructureSignature,
  nextRuntimeBuildMetadataSignature,
  nextRuntimeBuildNonPatchableMetadataSignature,
}: RendererBackendLoadScopeMemoContext): boolean {
  if (
    !hasCompatibleRuntimePatchReuseScope(
      options,
      memo,
      nextRuntimeBuildNonPatchableMetadataSignature,
    )
  ) {
    return false;
  }

  if (memo.lastRuntimeBuildMetadataSignature !== nextRuntimeBuildMetadataSignature) {
    return false;
  }

  if (hasRuntimePatchSourceContentChange(options, memo)) {
    return false;
  }

  if (memo.lastResolvedRobotJointsSignature !== nextJointStructureSignature) {
    return false;
  }

  return (
    areRobotLinksExactlyEqual(memo.lastResolvedRobotLinks, resolvedRobotLinks) &&
    areRobotJointsExactlyEqual(memo.lastResolvedRobotJoints, resolvedRobotJoints)
  );
}

function canReuseMemoizedKeyForRuntimeSourcePatchCatchup({
  options,
  memo,
  resolvedRobotLinks,
  nextJointStructureSignature,
  nextRuntimeBuildMetadataSignature,
  nextRuntimeBuildNonPatchableMetadataSignature,
}: RendererBackendLoadScopeMemoContext): boolean {
  if (!memo.lastRuntimePatchAwaitingSourceContent || isUsdLikeFormat(options.sourceFile.format)) {
    return false;
  }

  if (
    !hasCompatibleRuntimePatchReuseScope(
      options,
      memo,
      nextRuntimeBuildNonPatchableMetadataSignature,
    )
  ) {
    return false;
  }

  if (memo.lastRuntimeBuildMetadataSignature !== nextRuntimeBuildMetadataSignature) {
    return false;
  }

  if (!hasRuntimePatchSourceContentChange(options, memo)) {
    return false;
  }

  if (!memo.lastResolvedRobotLinks || !resolvedRobotLinks) {
    return false;
  }

  if (memo.lastResolvedRobotJointsSignature !== nextJointStructureSignature) {
    return false;
  }

  return areRobotLinksExactlyEqual(memo.lastResolvedRobotLinks, resolvedRobotLinks);
}

function canReuseMemoizedKeyForRuntimeSourcePatchAwaitingState({
  options,
  memo,
  resolvedRobotLinks,
  resolvedRobotJoints,
  nextJointStructureSignature,
  nextRuntimeBuildMetadataSignature,
  nextRuntimeBuildNonPatchableMetadataSignature,
}: RendererBackendLoadScopeMemoContext): boolean {
  if (isUsdLikeFormat(options.sourceFile.format)) {
    return false;
  }

  if (
    !hasCompatibleRuntimePatchReuseScope(
      options,
      memo,
      nextRuntimeBuildNonPatchableMetadataSignature,
    )
  ) {
    return false;
  }

  if (memo.lastRuntimeBuildMetadataSignature !== nextRuntimeBuildMetadataSignature) {
    return false;
  }

  if (!hasRuntimePatchSourceContentChange(options, memo)) {
    return false;
  }

  if (!memo.lastResolvedRobotLinks || !resolvedRobotLinks) {
    return false;
  }

  if (memo.lastResolvedRobotJointsSignature !== nextJointStructureSignature) {
    return false;
  }

  return (
    areRobotLinksExactlyEqual(memo.lastResolvedRobotLinks, resolvedRobotLinks) &&
    areRobotJointsExactlyEqual(memo.lastResolvedRobotJoints, resolvedRobotJoints)
  );
}

function hasStructuredRobotState(
  links: Record<string, UrdfLink> | undefined,
  joints: Record<string, UrdfJoint> | undefined,
): links is Record<string, UrdfLink> {
  return Boolean(
    links &&
      joints &&
      (Object.keys(links).length > 0 || Object.keys(joints).length > 0),
  );
}

export function createRendererBackendLoadScopeKey({
  sourceFile,
  availableFiles,
  assets,
  reloadToken = 0,
  allowUrdfXmlFallback = false,
  robotLinks,
  robotJoints,
  robotData,
  primitiveGeometryDetail,
  textureAnisotropy,
  materialDithering,
}: CreateRendererBackendLoadScopeKeyOptions): string {
  const sourceContentHash = hashStringFNV1a(sourceFile.content ?? '');
  const format = sourceFile.format;
  const sourceSignature = hashStableValue({
    name: sourceFile.name,
    format,
    blobUrl: sourceFile.blobUrl ?? null,
    content: sourceContentHash,
  });
  const resolvedRobotLinks = robotData?.links ?? robotLinks;
  const resolvedRobotJoints = robotData?.joints ?? robotJoints;
  const structuredRobotStateAvailable = hasStructuredRobotState(
    resolvedRobotLinks,
    resolvedRobotJoints,
  );
  const robotInputSignature =
    isUsdLikeFormat(format)
      ? `usd-source:${sourceContentHash}`
      : createViewerRobotLoadInputSignature({
          urdfContent: sourceFile.content ?? '',
          hasStructuredRobotState: structuredRobotStateAvailable,
          robotLinks: resolvedRobotLinks,
          robotJoints: resolvedRobotJoints,
          robotName: robotData?.name,
          rootLinkId: robotData?.rootLinkId,
          robotMaterials: robotData?.materials,
          inspectionContext: robotData?.inspectionContext,
        });

  return hashStableValue({
    format,
    reloadToken,
    allowUrdfXmlFallback,
    source: sourceSignature,
    input: robotInputSignature,
    assets: createAssetSignature(assets),
    availableFiles: createAvailableFilesSignature(availableFiles),
    primitiveGeometryDetail: primitiveGeometryDetail ?? null,
    textureAnisotropy: textureAnisotropy ?? null,
    materialDithering: materialDithering ?? null,
  });
}

export function createMemoizedRendererBackendLoadScopeKey(
  options: CreateRendererBackendLoadScopeKeyOptions,
  memo: RendererBackendLoadScopeKeyMemo,
): string {
  const resolvedRobotLinks = options.robotData?.links ?? options.robotLinks;
  const resolvedRobotJoints = options.robotData?.joints ?? options.robotJoints;
  const nextJointStructureSignature = createJointStructureSignature(resolvedRobotJoints);
  const nextRuntimeBuildMetadataSignature = createRuntimeBuildMetadataSignature(options.robotData);
  const nextRuntimeBuildNonPatchableMetadataSignature =
    createRuntimeBuildNonPatchableMetadataSignature(options.robotData);
  const memoContext: RendererBackendLoadScopeMemoContext = {
    options,
    memo,
    resolvedRobotLinks,
    resolvedRobotJoints,
    nextJointStructureSignature,
    nextRuntimeBuildMetadataSignature,
    nextRuntimeBuildNonPatchableMetadataSignature,
  };

  if (canReuseMemoizedKeyForUnchangedRuntimeState(memoContext)) {
    updateMemoSnapshot(
      memoContext,
      memo.lastRuntimePatchAwaitingSourceContent === true,
    );
    return memo.lastKey!;
  }

  if (canReuseMemoizedKeyForRuntimeSourcePatchCatchup(memoContext)) {
    updateMemoSnapshot(memoContext, false);
    return memo.lastKey!;
  }

  if (canReuseMemoizedKeyForRuntimeSourcePatchAwaitingState(memoContext)) {
    updateMemoSnapshot(memoContext, false);
    return memo.lastKey!;
  }

  if (canReuseMemoizedKeyForRuntimePatch(memoContext)) {
    const sourceContentChangedForRuntimePatch = hasRuntimePatchSourceContentChange(
      options,
      memo,
    );
    updateMemoSnapshot(
      memoContext,
      !sourceContentChangedForRuntimePatch,
    );
    return memo.lastKey!;
  }

  const nextKey = createRendererBackendLoadScopeKey(options);
  const keepAwaitingSourceContent =
    memo.lastRuntimePatchAwaitingSourceContent === true &&
    memo.lastKey === nextKey &&
    !hasRuntimePatchSourceContentChange(options, memo);
  memo.lastKey = nextKey;
  updateMemoSnapshot(memoContext, keepAwaitingSourceContent);

  return nextKey;
}
