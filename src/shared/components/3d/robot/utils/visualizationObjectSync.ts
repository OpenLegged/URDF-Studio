// Facade for the visualization-object sync helpers.
//
// The implementation was split into cohesive modules under ./visualizationSync/
// for readability; this file preserves the original public surface verbatim so
// that the sole production consumer (hooks/useVisualizationEffects.ts) and the
// neighboring unit tests keep importing the same symbol names from the same path.
//
// Behavior is intentionally unchanged: every sync function keeps its name,
// signature and internal ordering, and all consumer modules share the single
// scratch singleton set defined in ./visualizationSync/scratch.ts.
export {
  syncIkHandleVisualizationForLinks,
  syncOriginAxesVisualizationForLinks,
  syncJointAxesVisualizationForJoints,
  syncInertiaVisualizationForLinks,
  syncLinkVisualColors,
} from '@/shared/components/3d/robot/utils/visualizationSync/structuralHelperSync';
export {
  syncMjcfSiteVisualizationForLinks,
  syncMjcfTendonVisualizationForRobot,
} from '@/shared/components/3d/robot/utils/visualizationSync/mjcfSiteTendonSync';
export {
  syncLinkHelperInteractionStateForLinks,
  syncJointHelperInteractionStateForJoints,
} from '@/shared/components/3d/robot/utils/visualizationSync/interactionStateSync';
