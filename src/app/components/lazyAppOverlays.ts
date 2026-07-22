import { createPreloadableComponent } from '../utils/preloadableComponent';

export const loadAIInspectionConnectorModule = () => import('./ai/AIInspectionConnector');
export const loadAIConversationConnectorModule = () => import('./ai/AIConversationConnector');
export const loadExportDialogConnectorModule = () => import('./export/ExportDialogConnector');
export const loadDisconnectedWorkspaceUrdfExportDialogModule = () =>
  import('@/features/file-io');
export const loadExportProgressDialogModule = () => import('@/features/file-io');
export const loadSettingsModalModule = () => import('./SettingsModal');

const aiInspectionConnectorResource = createPreloadableComponent(
  loadAIInspectionConnectorModule,
  (module) => module.AIInspectionConnector,
);

const aiConversationConnectorResource = createPreloadableComponent(
  loadAIConversationConnectorModule,
  (module) => module.AIConversationConnector,
);

const disconnectedWorkspaceUrdfExportDialogResource = createPreloadableComponent(
  loadDisconnectedWorkspaceUrdfExportDialogModule,
  (module) => module.DisconnectedWorkspaceUrdfExportDialog,
);

const exportProgressDialogResource = createPreloadableComponent(
  loadExportProgressDialogModule,
  (module) => module.ExportProgressDialog,
);

const exportDialogConnectorResource = createPreloadableComponent(
  loadExportDialogConnectorModule,
  (module) => module.ExportDialogConnector,
);

const settingsModalResource = createPreloadableComponent(
  loadSettingsModalModule,
  (module) => module.SettingsModal,
);

export const AIInspectionConnector = aiInspectionConnectorResource.Component;
export const preloadAIInspectionConnector = aiInspectionConnectorResource.preload;

export const AIConversationConnector = aiConversationConnectorResource.Component;
export const preloadAIConversationConnector = aiConversationConnectorResource.preload;

export const DisconnectedWorkspaceUrdfExportDialog =
  disconnectedWorkspaceUrdfExportDialogResource.Component;
export const preloadDisconnectedWorkspaceUrdfExportDialog =
  disconnectedWorkspaceUrdfExportDialogResource.preload;

export const ExportProgressDialog = exportProgressDialogResource.Component;
export const preloadExportProgressDialog = exportProgressDialogResource.preload;

export const ExportDialogConnector = exportDialogConnectorResource.Component;
export const preloadExportDialogConnector = exportDialogConnectorResource.preload;

export const SettingsModal = settingsModalResource.Component;
export const preloadSettingsModal = settingsModalResource.preload;
