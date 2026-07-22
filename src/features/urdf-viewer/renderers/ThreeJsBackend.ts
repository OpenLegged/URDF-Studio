/**
 * Three.js Robot Renderer Backend
 *
 * Handles loading and rendering of URDF, MJCF, SDF, Xacro, and Mesh formats
 * using Three.js. This backend provides the bridge between format-specific
 * loaders and the format-agnostic RobotRendererBackend interface.
 */

import * as THREE from 'three';
import {
  buildRuntimeRobotFromState,
  URDFLoader,
  type URDFJoint as RuntimeURDFJoint,
  type URDFRobot,
} from '@/core/parsers/urdf/loader';
import { normalizeLoadingProgress } from '@/shared/components/3d/loadingHudState';
import { disposeObject3D } from '@/shared/utils/three/dispose';
import {
  alignRobotToGroundBeforeFirstMount,
  hasInitialGroundAlignment,
} from '@/shared/components/3d/robotPositioning';
import { SHARED_MATERIALS } from '@/shared/components/3d/sharedMaterials';
import { createLoadingManager, createMeshLoader } from '@/core/loaders';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import { getSourceFileDirectory } from '@/core/parsers/meshPathUtils';
import {
  getJointActualAngleFromMotionAngle,
  getJointMotionAngleFromActualAngle,
  hasFiniteJointLimitBounds,
  resolveJointKey,
} from '@/core/robot';
import type { RobotData, RobotFile, UrdfJoint, UrdfLink } from '@/types';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import { resolveURDFMaterialsForScene } from '@/shared/components/3d/urdfMaterials';
import { syncLoadedRobotScene } from './loadedRobotSceneSync';
import { resolveRobotLoaderSourceMetadata } from './robotLoaderSourceMetadata';
import {
  resolveViewerRobotSourceFormat,
  type ViewerRobotSourceFormat,
} from './sourceFormat';
import { shouldWaitForStructuredUrdfRobotState } from './urdfXmlFallbackPolicy';
import type {
  RobotRendererBackend,
  RobotSceneGraph,
  RaycastHit,
  RaycastOptions,
  TransformUpdateRequest,
  RendererSceneProps,
  BackendCapabilities,
} from './types';
import type { ViewerDocumentLoadEvent } from '@/shared/components/3d/loadingTypes';

const VIEWER_LOAD_YIELD_BUDGET_MS = 4;

type ThreeJsBackendSourceFileLike = {
  name?: string;
  path?: string;
  content?: string;
  format?: string;
};

export type ThreeJsBackendSourceFile = Omit<RobotFile, 'format'> & {
  path?: string;
  format: RobotFile['format'] | 'usda';
};

function preprocessURDFForLoader(content: string): string {
  // Remove <transmission> blocks to prevent urdf-loader from finding duplicate joints
  // which can overwrite valid joints with empty origins
  return content.replace(/<transmission[\s\S]*?<\/transmission>/g, '');
}

export function resolveThreeJsBackendSourceFileDirectory(
  sourceFile: ThreeJsBackendSourceFileLike | null | undefined,
): string | undefined {
  return getSourceFileDirectory(sourceFile?.path ?? sourceFile?.name);
}

function getRuntimeJoints(robot: THREE.Object3D | null): Record<string, RuntimeURDFJoint> | null {
  if (!robot || !('joints' in robot)) {
    return null;
  }

  return (robot as Partial<Pick<URDFRobot, 'joints'>>).joints ?? null;
}

function getBackendViewerSourceFormat(
  format: ThreeJsBackendSourceFile['format'] | undefined,
): ViewerRobotSourceFormat {
  switch (format) {
    case 'urdf':
    case 'mjcf':
    case 'sdf':
    case 'xacro':
    case 'usd':
      return format;
    case 'usda':
      return 'usd';
    default:
      return 'auto';
  }
}

/**
 * Three.js-based robot renderer backend
 *
 * Supports URDF, MJCF, SDF, Xacro, and standalone mesh formats.
 */
export class ThreeJsBackend implements RobotRendererBackend {
  readonly id: string;
  readonly format: 'urdf' | 'mjcf' | 'sdf' | 'usd' | 'xacro' | 'mesh';
  readonly capabilities: BackendCapabilities = {
    realtimeJointUpdates: true,
    collisionRaycast: true,
    originTransforms: true,
    ikHandles: true,
    facePainting: true,
    materialOverrides: true,
  };

  private robot: THREE.Object3D | null = null;
  private linkMeshMap = new Map<string, THREE.Mesh[]>();
  private robotData: RobotData | null = null;
  private robotLinks: Record<string, UrdfLink> = {};
  private robotJoints: Record<string, UrdfJoint> = {};
  private rootLinkId: string | null = null;
  private version = 0;
  private loading = false;
  private loadingProgress: ViewerDocumentLoadEvent | null = null;
  private abortController: { aborted: boolean } | null = null;
  private groundPlaneOffset = 0;
  private initialJointAngles: Record<string, number> = {};
  private groundAlignTimers: number[] = [];
  private invalidateCallback?: () => void;

  constructor(
    private sourceFile: ThreeJsBackendSourceFile,
    private assets: Record<string, string>,
    invalidate?: () => void,
  ) {
    this.id = `threejs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.format = this.resolveFormat();
    this.invalidateCallback = invalidate;
  }

  private resolveFormat(): 'urdf' | 'mjcf' | 'sdf' | 'usd' | 'xacro' | 'mesh' {
    const format = this.sourceFile?.format || 'urdf';
    if (format === 'usd' || format === 'usda') {
      return 'usd';
    }
    if (format === 'mesh') {
      return 'mesh';
    }
    return format as 'urdf' | 'mjcf' | 'sdf' | 'xacro';
  }

  private getSourceFileDir(): string | undefined {
    return resolveThreeJsBackendSourceFileDirectory(this.sourceFile);
  }

  private resolveRobotJoint(jointName: string): UrdfJoint | undefined {
    const jointKey = resolveJointKey(this.robotJoints, jointName);
    return jointKey ? this.robotJoints[jointKey] : undefined;
  }

  private toRuntimeJointMotion(jointName: string, actualAngle: number): number {
    const joint = this.resolveRobotJoint(jointName);
    return joint ? getJointMotionAngleFromActualAngle(joint, actualAngle) : actualAngle;
  }

  private toRobotJointActualAngle(jointName: string, motionAngle: number): number {
    const joint = this.resolveRobotJoint(jointName);
    return joint ? getJointActualAngleFromMotionAngle(joint, motionAngle) : motionAngle;
  }

  async load(props: RendererSceneProps): Promise<RobotSceneGraph> {
    const {
      sourceFile,
      assets,
      groundPlaneOffset = 0,
      showVisual = true,
      showCollision = true,
      parseCollisionMeshes = showCollision,
      showCollisionAlwaysOnTop = true,
      allowUrdfXmlFallback = false,
      robotLinks: providedRobotLinks,
      robotJoints: providedRobotJoints,
      robotData: providedRobotData,
      initialJointAngles = {},
      onDocumentLoadEvent,
    } = props;

    this.sourceFile = sourceFile;
    this.assets = assets;
    this.groundPlaneOffset = groundPlaneOffset;
    this.initialJointAngles = initialJointAngles;
    this.robotData = providedRobotData ?? null;
    this.robotLinks = providedRobotData?.links ?? providedRobotLinks ?? {};
    this.robotJoints = providedRobotData?.joints ?? providedRobotJoints ?? {};

    // Reset state
    this.loading = true;
    this.abortController = { aborted: false };
    this.loadingProgress = {
      status: 'loading',
      phase: 'preparing-scene',
      progressMode: null,
      progressPercent: null,
      loadedCount: null,
      totalCount: null,
      message: null,
      error: null,
    };
    onDocumentLoadEvent?.(this.loadingProgress);

    try {
      const robotModel = await this.loadRobotInternal({
        showVisual,
        showCollision,
        parseCollisionMeshes,
        showCollisionAlwaysOnTop,
        allowUrdfXmlFallback,
        onDocumentLoadEvent,
      });

      if (!robotModel) {
        throw new Error('Failed to load robot model');
      }

      // Apply initial joint angles
      const runtimeJoints = getRuntimeJoints(robotModel);
      if (this.initialJointAngles && runtimeJoints) {
        Object.entries(this.initialJointAngles).forEach(([jointName, angle]) => {
          const joint = runtimeJoints[jointName];
          if (!isSingleDofJoint(joint) || typeof angle !== 'number') {
            return;
          }
          joint.setJointValue?.(this.toRuntimeJointMotion(jointName, angle));
        });
        robotModel.updateMatrixWorld(true);
      }

      // Compute root link ID
      this.rootLinkId = providedRobotData?.rootLinkId ?? this.computeRootLinkId();
      this.robotData = {
        name: providedRobotData?.name ?? sourceFile.name ?? 'robot',
        links: this.robotLinks,
        joints: this.robotJoints,
        rootLinkId: this.rootLinkId ?? providedRobotData?.rootLinkId ?? '',
        materials: providedRobotData?.materials ?? {},
        closedLoopConstraints: providedRobotData?.closedLoopConstraints,
        inspectionContext: providedRobotData?.inspectionContext,
      };

      this.robot = robotModel;
      this.version += 1;
      this.loading = false;
      this.loadingProgress = {
        status: 'ready',
        phase: 'ready',
        progressMode: null,
        progressPercent: 100,
        loadedCount: null,
        totalCount: null,
        message: null,
        error: null,
      };
      onDocumentLoadEvent?.(this.loadingProgress);

      return {
        root: this.robot,
        linkMeshMap: this.linkMeshMap,
        robotData: this.robotData,
        robotLinks: this.robotLinks,
        robotJoints: this.robotJoints,
        rootLinkId: this.rootLinkId,
        version: this.version,
      };
    } catch (error) {
      this.loading = false;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.loadingProgress = {
        status: 'error',
        phase: null,
        progressMode: null,
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
        message: null,
        error: errorMessage,
      };
      onDocumentLoadEvent?.(this.loadingProgress);
      throw error;
    }
  }

  private async loadRobotInternal(options: {
    showVisual: boolean;
    showCollision: boolean;
    parseCollisionMeshes: boolean;
    showCollisionAlwaysOnTop: boolean;
    allowUrdfXmlFallback: boolean;
    onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  }): Promise<THREE.Object3D> {
    const {
      showVisual,
      showCollision,
      parseCollisionMeshes,
      showCollisionAlwaysOnTop,
      allowUrdfXmlFallback,
      onDocumentLoadEvent,
    } = options;

    const sourceFileDir = this.getSourceFileDir();
    const resolvedSourceFormat = resolveViewerRobotSourceFormat(
      this.sourceFile?.content,
      getBackendViewerSourceFormat(this.sourceFile?.format),
    );

    let robotModel: THREE.Object3D | null = null;
    const urdfMaterials =
      resolvedSourceFormat === 'mjcf'
        ? null
        : resolveURDFMaterialsForScene(this.sourceFile?.content, this.robotLinks);

    const syncLoadedRobot = (loadedRobot: THREE.Object3D) => {
      const { changed, linkMeshMap } = syncLoadedRobotScene({
        robot: loadedRobot,
        sourceFormat: resolvedSourceFormat,
        showCollision,
        showVisual,
        showMjcfWorldLink: false,
        showCollisionAlwaysOnTop,
        urdfMaterials,
        robotLinks: this.robotLinks,
      });

      this.linkMeshMap = linkMeshMap;
      return changed;
    };

    const shouldParseCollisionMeshes = parseCollisionMeshes;
    const hasStructuredRobotState =
      Boolean(this.robotLinks && this.robotJoints) &&
      (Object.keys(this.robotLinks ?? {}).length > 0 ||
        Object.keys(this.robotJoints ?? {}).length > 0);

    const shouldWaitForStructuredRobotState = shouldWaitForStructuredUrdfRobotState({
      resolvedSourceFormat,
      hasStructuredRobotState,
      allowUrdfXmlFallback,
    });

    {
      // Standard runtime loading from canonical RobotState, with URDF XML as the
      // only fallback path when explicitly allowed by the source policy.
      const {
        robotJoints: sourceRobotJoints,
        explicitlyScaledMeshPaths,
        colladaRootNormalizationHints,
      } = resolveRobotLoaderSourceMetadata({
        urdfContent: this.sourceFile?.content || '',
        robotLinks: this.robotLinks,
        robotJoints: this.robotJoints,
      });

      const manager = createLoadingManager(this.assets, sourceFileDir);
      const assetCompletionKey = '__urdf_studio_threejs_backend_finalize__';
      const waitForAssetCompletion = new Promise<void>((resolve) => {
        const previousOnLoad = manager.onLoad;
        manager.onLoad = () => {
          previousOnLoad?.();
          resolve();
        };
      });
      manager.onProgress = (_url, itemsLoaded, itemsTotal) => {
        if (this.abortController?.aborted) return;

        const adjustedTotalCount = Math.max(0, itemsTotal - 1);
        if (adjustedTotalCount <= 0) return;

        this.loadingProgress = normalizeLoadingProgress<ViewerDocumentLoadEvent>({
          status: 'loading',
          phase: 'streaming-meshes',
          progressPercent: null,
          loadedCount: Math.min(itemsLoaded, adjustedTotalCount),
          totalCount: adjustedTotalCount,
          message: null,
        });
        onDocumentLoadEvent?.(this.loadingProgress);
      };

      const loader = new URDFLoader(manager);
      const yieldIfNeeded = createMainThreadYieldController(VIEWER_LOAD_YIELD_BUDGET_MS);
      loader.parseCollision = shouldParseCollisionMeshes;
      loader.parseVisual = true;
      loader.loadMeshCb = createMeshLoader(this.assets, manager, sourceFileDir, {
        allowPlaceholderMeshes: true,
        colladaRootNormalizationHints,
        explicitScaleMeshPaths: explicitlyScaledMeshPaths,
        yieldIfNeeded,
      });
      loader.packages = '';

      manager.itemStart(assetCompletionKey);
      try {
        if (hasStructuredRobotState) {
          robotModel = await buildRuntimeRobotFromState({
            robotName: this.robotData?.name ?? this.sourceFile?.name,
            links: this.robotLinks!,
            joints: this.robotJoints!,
            materials: this.robotData?.materials,
            inspectionContext: this.robotData?.inspectionContext,
            manager,
            loadMeshCb: loader.loadMeshCb,
            parseVisual: true,
            parseCollision: shouldParseCollisionMeshes,
            rootLinkId: this.robotData?.rootLinkId,
            yieldIfNeeded,
          });
        } else {
          if (resolvedSourceFormat === 'mjcf') {
            throw new Error('MJCF sources must be resolved to RobotState before rendering.');
          }
          if (shouldWaitForStructuredRobotState) {
            throw new Error('Waiting for structured robot state');
          }

          const cleanContent = preprocessURDFForLoader(this.sourceFile?.content || '');
          robotModel = await loader.parseAsync(cleanContent, loader.workingPath, {
            yieldIfNeeded,
          });

          // Copy joint limits from source if available
          const runtimeJoints = getRuntimeJoints(robotModel);
          if (sourceRobotJoints && runtimeJoints) {
            Object.entries(runtimeJoints).forEach(([name, joint]) => {
                    const parsedJoint = sourceRobotJoints[name];
                    if (parsedJoint && parsedJoint.limit) {
                      if (
                        typeof parsedJoint.limit.effort === 'number' &&
                        Number.isFinite(parsedJoint.limit.effort)
                      ) {
                        joint.limit.effort = parsedJoint.limit.effort;
                      }
                      if (
                        typeof parsedJoint.limit.velocity === 'number' &&
                        Number.isFinite(parsedJoint.limit.velocity)
                      ) {
                        joint.limit.velocity = parsedJoint.limit.velocity;
                      }
                      if (hasFiniteJointLimitBounds(parsedJoint.limit)) {
                        if (joint.limit.lower === undefined) {
                          joint.limit.lower = parsedJoint.limit.lower;
                        }
                        if (joint.limit.upper === undefined) {
                          joint.limit.upper = parsedJoint.limit.upper;
                        }
                        joint.ignoreLimits = false;
                      } else if (
                        parsedJoint.type === 'revolute' ||
                        parsedJoint.type === 'prismatic'
                      ) {
                        joint.ignoreLimits = true;
                      }
                    } else if (
                      parsedJoint &&
                      (parsedJoint.type === 'revolute' || parsedJoint.type === 'prismatic')
                    ) {
                      joint.ignoreLimits = true;
                    }
            });
          }
        }
      } finally {
        manager.itemEnd(assetCompletionKey);
      }

      await waitForAssetCompletion;

      if (this.abortController?.aborted && robotModel) {
        disposeObject3D(robotModel, true, SHARED_MATERIALS);
        throw new Error('Load aborted');
      }

      if (!robotModel) {
        throw new Error('Failed to build URDF runtime scene.');
      }

      this.loadingProgress = normalizeLoadingProgress<ViewerDocumentLoadEvent>({
        status: 'loading',
        phase: 'finalizing-scene',
        progressPercent: null,
        loadedCount: null,
        totalCount: null,
        message: null,
      });
      onDocumentLoadEvent?.(this.loadingProgress);

      // Finalize after external meshes have attached so picking metadata is complete.
      syncLoadedRobot(robotModel);
      const alignedToGround = alignRobotToGroundBeforeFirstMount(
        robotModel,
        this.groundPlaneOffset,
      );
      if (!alignedToGround) {
        this.scheduleGroundAlignment(robotModel);
      }

      this.loadingProgress = normalizeLoadingProgress<ViewerDocumentLoadEvent>({
        status: 'ready',
        phase: 'ready',
        progressPercent: 100,
        loadedCount: null,
        totalCount: null,
        message: null,
      });
      onDocumentLoadEvent?.(this.loadingProgress);
    }

    return robotModel;
  }

  private computeRootLinkId(): string | null {
    const links = this.robotLinks || {};
    const joints = this.robotJoints || {};
    const linkIds = Object.keys(links);

    if (linkIds.length === 0) {
      return null;
    }

    const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
    return linkIds.find((linkId) => !childLinkIds.has(linkId)) ?? linkIds[0] ?? null;
  }

  private scheduleGroundAlignment(loadedRobot: THREE.Object3D): void {
    if (typeof window === 'undefined') {
      alignRobotToGroundBeforeFirstMount(loadedRobot, this.groundPlaneOffset);
      return;
    }

    this.clearGroundAlignTimers();

    this.groundAlignTimers = [0, 80, 220, 500].map((delay) =>
      window.setTimeout(() => {
        if (hasInitialGroundAlignment(loadedRobot)) {
          return;
        }

        const alignedToGround = alignRobotToGroundBeforeFirstMount(
          loadedRobot,
          this.groundPlaneOffset,
        );
        if (alignedToGround) {
          this.clearGroundAlignTimers();
        }
        this.invalidateCallback?.();
      }, delay),
    );
  }

  private clearGroundAlignTimers(): void {
    this.groundAlignTimers.forEach((timer) => window.clearTimeout(timer));
    this.groundAlignTimers = [];
  }

  getRobotObject(): THREE.Object3D | null {
    return this.robot;
  }

  getLinkMeshMap(): Map<string, THREE.Mesh[]> {
    return this.linkMeshMap;
  }

  updateLinkTransform(request: TransformUpdateRequest): void {
    if (!this.robot) return;

    // Find the target mesh
    const meshes =
      this.linkMeshMap.get(request.isCollision ? `${request.linkId}:collision` : `${request.linkId}:visual`) ??
      this.linkMeshMap.get(request.linkId);
    if (!meshes || meshes.length === 0) return;

    const targetMesh = request.objectIndex !== undefined
      ? meshes[request.objectIndex]
      : meshes[0];

    if (!targetMesh) return;

    // Apply the transformation
    targetMesh.matrix.copy(request.matrix);
    targetMesh.matrix.decompose(targetMesh.position, targetMesh.quaternion, targetMesh.scale);
    targetMesh.updateMatrixWorld();

    this.invalidateCallback?.();
  }

  raycast(options: RaycastOptions): RaycastHit[] {
    if (!this.robot) return [];

    const { raycaster, includeVisual = true, includeCollision = true } = options;

    // Collect all mesh targets
    const targets: THREE.Object3D[] = [];
    this.linkMeshMap.forEach((meshes) => {
      meshes.forEach((mesh) => {
        if (includeVisual && !mesh.userData.isCollision) {
          targets.push(mesh);
        }
        if (includeCollision && mesh.userData.isCollision) {
          targets.push(mesh);
        }
      });
    });

    // Add additional targets if provided
    if (options.additionalTargets) {
      targets.push(...options.additionalTargets);
    }

    if (targets.length === 0) return [];

    const intersects = raycaster.intersectObjects(targets, false);

    return intersects.map((hit) => {
      const mesh = hit.object as THREE.Mesh;
      const linkId = this.findLinkIdForMesh(mesh);

      return {
        object: mesh,
        point: hit.point,
        distance: hit.distance,
        linkId,
        jointId: null,
        subType: mesh.userData.isCollision ? 'collision' : 'visual',
        objectIndex: mesh.userData.objectIndex,
        helperKind: undefined,
        highlightObjectId: undefined,
        isGizmo: mesh.userData.isGizmo,
      };
    });
  }

  private findLinkIdForMesh(mesh: THREE.Object3D): string | null {
    // Check mesh metadata first
    if (mesh.userData.linkId) {
      return mesh.userData.linkId as string;
    }

    // Traverse up to find link
    let obj: THREE.Object3D | null = mesh;
    while (obj && obj !== this.robot) {
      if (obj.userData.linkId) {
        return obj.userData.linkId as string;
      }
      obj = obj.parent;
    }

    // Fall back to linkMeshMap lookup
    for (const [linkId, meshes] of this.linkMeshMap.entries()) {
      if (meshes.includes(mesh as THREE.Mesh)) {
        return linkId;
      }
    }

    return null;
  }

  updateJointAngles(jointAngles: Record<string, number>): void {
    const robot = this.robot;
    const runtimeJoints = getRuntimeJoints(robot);
    if (!robot || !runtimeJoints) return;

    Object.entries(jointAngles).forEach(([jointName, angle]) => {
      const joint = runtimeJoints[jointName];
      if (joint && isSingleDofJoint(joint)) {
        joint.setJointValue?.(this.toRuntimeJointMotion(jointName, angle));
      }
    });

    robot.updateMatrixWorld(true);
    this.invalidateCallback?.();
  }

  getJointAngles(): Record<string, number> {
    const runtimeJoints = getRuntimeJoints(this.robot);
    if (!runtimeJoints) {
      if (this.robot) {
        console.error('[ThreeJsBackend] getJointAngles: robot loaded but has no joints');
      }
      return {};
    }

    const angles: Record<string, number> = {};
    Object.entries(runtimeJoints).forEach(([name, joint]) => {
      if (joint && isSingleDofJoint(joint)) {
        const motionAngle = Number.isFinite(joint.angle)
          ? joint.angle
          : (joint.jointValue?.[0] ?? 0);
        angles[name] = this.toRobotJointActualAngle(name, motionAngle);
      }
    });

    return angles;
  }

  isLoading(): boolean {
    return this.loading;
  }

  getLoadingProgress(): ViewerDocumentLoadEvent | null {
    return this.loadingProgress;
  }

  dispose(): void {
    this.clearGroundAlignTimers();

    if (this.abortController) {
      this.abortController.aborted = true;
    }

    if (this.robot) {
      disposeObject3D(this.robot, true, SHARED_MATERIALS);
      this.robot = null;
    }

    this.linkMeshMap.clear();
  }

  invalidate(): void {
    this.invalidateCallback?.();
  }

  getDebugInfo(): Record<string, unknown> {
    return {
      id: this.id,
      format: this.format,
      version: this.version,
      loading: this.loading,
      robotLinks: Object.keys(this.robotLinks).length,
      robotJoints: Object.keys(this.robotJoints).length,
        rootLinkId: this.rootLinkId,
        meshCount: Array.from(this.linkMeshMap.values()).reduce((sum, meshes) => sum + meshes.length, 0),
      };
  }
}

/**
 * Factory function to create a ThreeJsBackend instance
 */
export function createThreeJsBackend(
  sourceFile: ThreeJsBackendSourceFile,
  assets: Record<string, string>,
  invalidate?: () => void,
): RobotRendererBackend {
  return new ThreeJsBackend(sourceFile, assets, invalidate);
}
