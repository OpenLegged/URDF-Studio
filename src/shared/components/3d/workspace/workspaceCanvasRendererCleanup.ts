import * as THREE from 'three';

import { disposeWebGLRenderer } from '../../../utils/three/dispose.ts';

type WorkspaceCanvasCleanupNode = HTMLCanvasElement & {
  __workspaceCanvasCleanup?: () => void;
};

export function cleanupWorkspaceCanvasRenderer(
  renderer: THREE.WebGLRenderer | null | undefined,
  contextMenuCleanup?: (() => void) | null,
): void {
  if (!renderer) {
    contextMenuCleanup?.();
    return;
  }

  const canvas = renderer.domElement as WorkspaceCanvasCleanupNode;
  const hasCanvasCleanup = typeof canvas.__workspaceCanvasCleanup === 'function';

  canvas.__workspaceCanvasCleanup?.();

  if (!hasCanvasCleanup) {
    contextMenuCleanup?.();
  }

  // R3F removes the canvas after unmount and renderer.dispose() releases its GPU
  // resources. Forcing WEBGL_lose_context during an ordinary model/scene switch
  // turns navigation into a stream of artificial context-loss events and can make
  // Chrome block subsequent contexts for the entire page.
  disposeWebGLRenderer(renderer);
}
