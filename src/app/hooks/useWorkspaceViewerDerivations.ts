import { useMemo, useSyncExternalStore } from 'react';

import { buildCanonicalWorkspaceSourceDocuments } from '../utils/sourceCodeDocuments';
import { resolveCanonicalWorkspaceViewerDocument } from '../utils/canonicalWorkspaceViewerDocument';
import {
  readStoredWorkspaceViewerShowVisualPreference,
  resolveWorkspaceViewerShowVisual,
  subscribeToShowVisualPreference,
} from './workspaceViewerDetailPreferences';
import { createAssemblyScenePlacement, createAssemblySceneProjection } from '@/core/robot';
import { buildBridgePreviewWorkspace } from '@/features/assembly';
import { projectWorkspaceJointMotionToRenderer } from '@/features/editor';
import type { AssemblyState, BridgeJoint, ComponentSourceDraft, RobotFile } from '@/types';

interface UseWorkspaceViewerDerivationsParams {
  workspace: AssemblyState;
  semanticWorkspace: AssemblyState;
  bridgePreview: BridgeJoint | null;
  activeComponentId: string;
  availableFiles: RobotFile[];
  componentSourceDrafts: Record<string, ComponentSourceDraft>;
  allFileContents: Record<string, string>;
}

export interface WorkspaceViewerDerivations {
  sceneWorkspace: ReturnType<typeof buildBridgePreviewWorkspace>;
  sceneProjection: ReturnType<typeof createAssemblySceneProjection>;
  scenePlacement: ReturnType<typeof createAssemblyScenePlacement>;
  viewerRobot: ReturnType<typeof createAssemblyScenePlacement>['robotData'];
  viewerDocument: ReturnType<typeof resolveCanonicalWorkspaceViewerDocument>;
  canonicalSource: ReturnType<typeof buildCanonicalWorkspaceSourceDocuments>;
  jointAngleState: ReturnType<typeof projectWorkspaceJointMotionToRenderer>['jointAngles'];
  jointMotionState: ReturnType<typeof projectWorkspaceJointMotionToRenderer>['jointMotion'];
  showVisual: boolean;
}

/**
 * Projects canonical workspace state into the renderer and source-editor read models.
 * Semantic scene work remains isolated from high-frequency joint-motion updates.
 */
export function useWorkspaceViewerDerivations({
  workspace,
  semanticWorkspace,
  bridgePreview,
  activeComponentId,
  availableFiles,
  componentSourceDrafts,
  allFileContents,
}: UseWorkspaceViewerDerivationsParams): WorkspaceViewerDerivations {
  const sceneWorkspace = useMemo(
    () => buildBridgePreviewWorkspace(semanticWorkspace, bridgePreview),
    [bridgePreview, semanticWorkspace],
  );
  const sceneProjection = useMemo(
    () => createAssemblySceneProjection(sceneWorkspace),
    [sceneWorkspace],
  );
  const scenePlacement = useMemo(
    () => createAssemblyScenePlacement(sceneWorkspace, sceneProjection),
    [sceneProjection, sceneWorkspace],
  );
  const viewerDocument = useMemo(
    () =>
      resolveCanonicalWorkspaceViewerDocument({
        workspace: sceneWorkspace,
        projection: sceneProjection,
        availableFiles,
        componentSourceDrafts,
      }),
    [availableFiles, componentSourceDrafts, sceneProjection, sceneWorkspace],
  );
  const canonicalSource = useMemo(
    () =>
      buildCanonicalWorkspaceSourceDocuments({
        workspace: semanticWorkspace,
        activeComponentId,
        componentSourceDrafts,
        availableFiles,
        allFileContents,
      }),
    [activeComponentId, allFileContents, availableFiles, componentSourceDrafts, semanticWorkspace],
  );
  const projectedJointMotion = useMemo(
    () => projectWorkspaceJointMotionToRenderer(workspace, sceneProjection),
    [sceneProjection, workspace],
  );
  const storedShowVisualPreference = useSyncExternalStore(
    subscribeToShowVisualPreference,
    readStoredWorkspaceViewerShowVisualPreference,
    () => null,
  );
  const showVisual = useMemo(
    () =>
      resolveWorkspaceViewerShowVisual({
        robotLinks: sceneProjection.robotData.links,
        storedPreference: storedShowVisualPreference,
      }),
    [sceneProjection.robotData.links, storedShowVisualPreference],
  );

  return {
    sceneWorkspace,
    sceneProjection,
    scenePlacement,
    viewerRobot: scenePlacement.robotData,
    viewerDocument,
    canonicalSource,
    jointAngleState: projectedJointMotion.jointAngles,
    jointMotionState: projectedJointMotion.jointMotion,
    showVisual,
  };
}
