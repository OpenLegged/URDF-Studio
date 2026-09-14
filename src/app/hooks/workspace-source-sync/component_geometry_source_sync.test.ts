import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createComponentSourceDraft,
  createDefaultWorkspace,
  isComponentSourceDraftMatchingComponent,
} from '@/core/robot';
import { GeometryType } from '@/types';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { generateEditableRobotSource } from '@/app/utils/generateEditableRobotSource';
import { synchronizeComponentSourceDraft } from './component_source_draft_sync';

for (const { format, type } of [
  { format: 'urdf', type: GeometryType.PLANE },
  { format: 'xacro', type: GeometryType.ELLIPSOID },
  { format: 'sdf', type: GeometryType.ELLIPSOID },
  { format: 'sdf', type: GeometryType.MESH },
  { format: 'mjcf', type: GeometryType.POLYLINE },
] as const) {
  test(`${format} ${type} edits preserve canonical geometry and the previous source draft`, (t) => {
    const previousAssets = useAssetsStore.getState();
    const previousWorkspace = useWorkspaceStore.getState();
    t.after(() => {
      useAssetsStore.setState(previousAssets);
      useWorkspaceStore.setState(previousWorkspace);
    });
    const warn = t.mock.method(console, 'warn', () => {});
    const error = t.mock.method(console, 'error', () => {});
    const workspace = createDefaultWorkspace('shape_edit');
    const component = workspace.components.component_1;
    const draft = createComponentSourceDraft({
      componentId: component.id,
      format,
      content: generateEditableRobotSource({
        format,
        robotState: { ...component.robot, selection: { type: null, id: null } },
      }),
      robot: component.robot,
    });
    useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
    useAssetsStore.setState({
      availableFiles: [],
      allFileContents: {},
      componentSourceDrafts: { [component.id]: draft },
    });
    assert.equal(useWorkspaceStore.getState().updateLink(
      { type: 'link', componentId: component.id, entityId: component.robot.rootLinkId },
      {
        collision: {
          ...component.robot.links[component.robot.rootLinkId].collision,
          type,
          meshPath: '',
        },
      },
    ), true);
    const editedComponent = useWorkspaceStore.getState().workspace.components[component.id];
    const editedRobot = structuredClone(editedComponent.robot);

    assert.equal(synchronizeComponentSourceDraft(component.id), 'failed');
    assert.equal(useAssetsStore.getState().componentSourceDrafts[component.id], draft);
    assert.deepEqual(useWorkspaceStore.getState().workspace.components[component.id].robot, editedRobot);
    assert.equal(isComponentSourceDraftMatchingComponent(draft, editedComponent), false);
    assert.equal(warn.mock.callCount(), 0);
    assert.equal(error.mock.callCount(), 0);
  });
}
