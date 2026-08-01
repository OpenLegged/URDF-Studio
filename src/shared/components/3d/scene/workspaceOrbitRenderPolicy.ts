export type WorkspaceOrbitFrameloop = 'always' | 'demand' | 'never';

export interface WorkspaceOrbitDemandFrameState {
  controlsEnabled: boolean;
  frameloop: WorkspaceOrbitFrameloop;
  frameScheduled: boolean;
}

/**
 * OrbitControls already receives an R3F frame while the canvas is running
 * continuously. The DOM-event fallback exists only to wake a demand canvas;
 * running it during `always` would update the camera and dispatch `change`
 * twice around the same rendered frame.
 */
export function shouldScheduleWorkspaceOrbitDemandFrame({
  controlsEnabled,
  frameloop,
  frameScheduled,
}: WorkspaceOrbitDemandFrameState) {
  return controlsEnabled && frameloop === 'demand' && !frameScheduled;
}
