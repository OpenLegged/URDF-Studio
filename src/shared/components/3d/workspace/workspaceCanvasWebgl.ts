export type WorkspaceCanvasWebglFailureReason = 'missing-api';

export interface WorkspaceCanvasWebglSupportState {
  supported: boolean;
  reason?: WorkspaceCanvasWebglFailureReason;
  detail?: string;
}

interface WebglProbeWindowLike {
  WebGLRenderingContext?: unknown;
  WebGL2RenderingContext?: unknown;
}

interface WorkspaceCanvasWebglProbeEnvironment {
  window?: WebglProbeWindowLike;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    const normalized = error.message.trim();
    return normalized.length > 0 ? normalized : error.name;
  }

  if (typeof error === 'string') {
    const normalized = error.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

export function probeWorkspaceCanvasWebglSupport(
  environment: WorkspaceCanvasWebglProbeEnvironment = globalThis as WorkspaceCanvasWebglProbeEnvironment,
): WorkspaceCanvasWebglSupportState {
  const probeWindow = environment.window;

  if (!probeWindow) {
    return { supported: true };
  }

  if (!probeWindow.WebGLRenderingContext && !probeWindow.WebGL2RenderingContext) {
    return {
      supported: false,
      reason: 'missing-api',
      detail: 'WebGL APIs are unavailable in the current browser environment.',
    };
  }

  // Do not create a throwaway WebGL context here. Mode changes mount a real R3F
  // canvas immediately afterwards; probing with getContext() consumes another
  // context and explicitly releasing it produces a context-lost event. Chrome
  // can block the page after enough of those events, leaving both workspaces
  // unable to mount. The real renderer remains the authority for whether context
  // creation succeeds and reports its initialization error through the boundary.
  return { supported: true };
}

export function getWorkspaceCanvasErrorDetail(error: unknown): string | undefined {
  return getErrorMessage(error);
}
