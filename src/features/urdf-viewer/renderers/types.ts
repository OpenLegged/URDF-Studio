/**
 * Unified Robot Renderer Backend Interface
 *
 * This module defines the contract that all robot rendering backends must implement.
 * Backend implementations handle format-specific loading and rendering while
 * providing a consistent interface for the format-agnostic frontend components.
 */

import type * as THREE from 'three';
import type { InteractionSelection, RobotData, RobotFile, UrdfJoint, UrdfLink } from '@/types';
import type { RobotPrimitiveGeometryDetail } from '@/core/parsers/urdf/loader/primitiveGeometry';
import type {
  ToolMode,
  ViewerHelperKind,
  ViewerInteractiveLayer,
  ViewerRuntimeStageBridge,
} from '@/shared/components/3d/viewerInteractionTypes';
import type { ViewerDocumentLoadEvent } from '@/shared/components/3d/loadingTypes';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';

/**
 * Raycast hit result returned by backend raycast operations
 */
export interface RaycastHit {
  /** The intersected object/mesh */
  object: THREE.Object3D;
  /** Point of intersection in world space */
  point: THREE.Vector3;
  /** Distance from ray origin to intersection point */
  distance: number;
  /** Link identifier (may be different from USD prim path) */
  linkId: string | null;
  /** Joint identifier if hit object is a joint */
  jointId: string | null;
  /** Whether this is a visual or collision mesh */
  subType: 'visual' | 'collision' | undefined;
  /** Object index within the link (for multi-mesh links) */
  objectIndex?: number;
  /** Helper kind if hit object is a helper (origin-axes, joint-axis, etc.) */
  helperKind?: ViewerHelperKind;
  /** Specific highlight object ID for helpers */
  highlightObjectId?: number;
  /** Whether this object is a gizmo/transform control */
  isGizmo?: boolean;
  /** Mesh ID for USD backends */
  meshId?: string;
  /** Prim path for USD backends */
  primPath?: string;
}

/**
 * Options for raycast operations
 */
export interface RaycastOptions {
  /** Raycaster to use for intersection */
  raycaster: THREE.Raycaster;
  /** Whether to include visual meshes in raycast */
  includeVisual?: boolean;
  /** Whether to include collision meshes in raycast */
  includeCollision?: boolean;
  /** Whether to include helpers in raycast */
  includeHelpers?: boolean;
  /** Whether to include gizmos in raycast */
  includeGizmos?: boolean;
  /** Priority order for interaction layers */
  layerPriority?: readonly ViewerInteractiveLayer[];
  /** Selection state for filtering */
  selection?: InteractionSelection | null;
  /** Hovered selection state */
  hoveredSelection?: InteractionSelection | null;
  /** Tool mode for interaction policy */
  toolMode?: ToolMode;
  /** Additional targets to include in raycast */
  additionalTargets?: THREE.Object3D[];
}

/**
 * Scene graph metadata returned after loading
 */
export interface RobotSceneGraph {
  /** Root object of the robot scene */
  root: THREE.Object3D | null;
  /** Map of `${linkId}:visual` / `${linkId}:collision` to associated meshes */
  linkMeshMap: Map<string, THREE.Mesh[]>;
  /** Complete robot data resolved from the source format */
  robotData: RobotData;
  /** Robot links data (resolved from format) */
  robotLinks: Record<string, UrdfLink>;
  /** Robot joints data (resolved from format) */
  robotJoints: Record<string, UrdfJoint>;
  /** Root link ID */
  rootLinkId: string | null;
  /** Runtime version for change tracking */
  version: number;
}

/**
 * Transform update request
 */
export interface TransformUpdateRequest {
  /** Target link ID */
  linkId: string;
  /** Target object index (for multi-mesh links) */
  objectIndex?: number;
  /** New world transformation matrix */
  matrix: THREE.Matrix4;
  /** Whether this is a collision transform */
  isCollision?: boolean;
}

/**
 * Props for renderer backend initialization
 */
export interface RendererSceneProps {
  /** Source robot file */
  sourceFile: RobotFile;
  /** Available files for dependency resolution */
  availableFiles?: RobotFile[];
  /** Map of asset paths to URLs */
  assets: Record<string, string>;
  /** Ground plane offset for positioning */
  groundPlaneOffset?: number;
  /** Show visual meshes */
  showVisual?: boolean;
  /** Show collision meshes */
  showCollision?: boolean;
  /** Parse collision meshes into the runtime scene */
  parseCollisionMeshes?: boolean;
  /** Show collision always on top */
  showCollisionAlwaysOnTop?: boolean;
  /** Allow raw URDF XML parsing before structured robot state is available */
  allowUrdfXmlFallback?: boolean;
  /** Existing robot links data (for incremental updates) */
  robotLinks?: Record<string, UrdfLink>;
  /** Existing robot joints data (for incremental updates) */
  robotJoints?: Record<string, UrdfJoint>;
  /** Existing complete robot data (for formats with pre-resolved state) */
  robotData?: RobotData | null;
  /** Tessellation used when constructing editable curved primitives */
  primitiveGeometryDetail?: RobotPrimitiveGeometryDetail;
  /** Texture sampling quality after clamping to renderer capabilities */
  textureAnisotropy?: number;
  /** Enables material dithering to reduce smooth-gradient banding */
  materialDithering?: boolean;
  /** Initial joint angles */
  initialJointAngles?: Record<string, number>;
  /** Callback for document load events */
  onDocumentLoadEvent?: (event: ViewerDocumentLoadEvent) => void;
  /** Callback when runtime robot is loaded */
  onRuntimeRobotLoaded?: (robot: RuntimeRobotObject) => void;
  /** Runtime bridge for USD-specific interactions */
  runtimeBridge?: ViewerRuntimeStageBridge;
  /** Renderer invalidation callback */
  invalidate?: () => void;
  /** R3F host objects needed by embedded runtimes such as USD WASM */
  runtimeHost?: {
    camera?: THREE.Camera;
    scene?: THREE.Scene;
    controls?: unknown;
  };
}

/**
 * Render mode for the backend
 */
export type RenderMode = 'editor' | 'preview' | 'export';

/**
 * Backend capabilities and features
 */
export interface BackendCapabilities {
  /** Whether backend supports real-time joint updates */
  realtimeJointUpdates: boolean;
  /** Whether backend supports collision mesh raycasting */
  collisionRaycast: boolean;
  /** Whether backend supports origin transforms */
  originTransforms: boolean;
  /** Whether backend supports IK handles */
  ikHandles: boolean;
  /** Whether backend supports mesh face painting */
  facePainting: boolean;
  /** Whether backend supports material overrides */
  materialOverrides: boolean;
}

/**
 * Robot Renderer Backend Interface
 *
 * All rendering backends must implement this interface to provide
 * format-agnostic robot loading and interaction capabilities.
 */
export interface RobotRendererBackend {
  /**
   * Unique identifier for this backend instance
   */
  readonly id: string;

  /**
   * Source format this backend handles
   */
  readonly format: 'urdf' | 'mjcf' | 'sdf' | 'usd' | 'xacro' | 'mesh';

  /**
   * Capabilities of this backend
   */
  readonly capabilities: BackendCapabilities;

  /**
   * Load robot from source
   * @param props - Scene properties for loading
   * @returns Promise resolving to robot scene graph
   */
  load(props: RendererSceneProps): Promise<RobotSceneGraph>;

  /**
   * Get the root THREE.Object3D for the loaded robot
   * @returns Root object or null if not loaded
   */
  getRobotObject(): THREE.Object3D | null;

  /**
   * Get map of link IDs to meshes
   * @returns Map of link ID to array of meshes
   */
  getLinkMeshMap(): Map<string, THREE.Mesh[]>;

  /**
   * Update link transformation
   * @param request - Transform update request
   */
  updateLinkTransform(request: TransformUpdateRequest): void;

  /**
   * Perform raycast against the robot scene
   * @param options - Raycast options
   * @returns Array of raycast hits, sorted by distance
   */
  raycast(options: RaycastOptions): RaycastHit[];

  /**
   * Update joint angles
   * @param jointAngles - Map of joint name to angle
   */
  updateJointAngles(jointAngles: Record<string, number>): void;

  /**
   * Get current joint angles
   * @returns Map of joint name to angle
   */
  getJointAngles(): Record<string, number>;

  /**
   * Check if backend is currently loading
   */
  isLoading(): boolean;

  /**
   * Get loading progress if currently loading
   */
  getLoadingProgress(): ViewerDocumentLoadEvent | null;

  /**
   * Dispose backend resources
   */
  dispose(): void;

  /**
   * Invalidate/refresh the renderer
   */
  invalidate(): void;

  /**
   * Get runtime metadata for debugging
   */
  getDebugInfo?(): Record<string, unknown>;
}

/**
 * Backend factory function type
 */
export type BackendFactory = () => RobotRendererBackend;

/**
 * Registry of available backends
 */
export interface BackendRegistry {
  [format: string]: BackendFactory;
}
