export function shouldRenderRealtimeAmbientOcclusion({
  composerAvailable,
  isInteracting,
  snapshotRenderActive,
}: {
  composerAvailable: boolean;
  isInteracting: boolean;
  snapshotRenderActive: boolean;
}): boolean {
  return composerAvailable && !isInteracting && !snapshotRenderActive;
}
