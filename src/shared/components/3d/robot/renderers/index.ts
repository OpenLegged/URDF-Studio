/**
 * Unified Robot Renderer Backend
 *
 * This module provides format-agnostic robot rendering through a backend
 * abstraction layer. Robot sources are rendered after they have been resolved
 * to the shared RobotState/Three.js path.
 * handled by specialized backend implementations that conform to a common
 * interface.
 */

export type {
  RobotRendererBackend,
  RobotSceneGraph,
  RaycastHit,
  RaycastOptions,
  TransformUpdateRequest,
  RendererSceneProps,
  RenderMode,
  BackendCapabilities,
  BackendFactory,
  BackendRegistry,
} from '@/shared/components/3d/robot/renderers/types';

export { createThreeJsBackend } from '@/shared/components/3d/robot/renderers/ThreeJsBackend';
export { createRendererBackend } from '@/shared/components/3d/robot/renderers/createRendererBackend';
