/**
 * App Module - Application entry components
 * Contains main layout, providers, and header components
 */

// Main App component
export { default as App } from './App';

// AppContent (for external composition / extension)
export { AppContent } from './App';
export type {
  AppExtensionSlots,
  AppExtensionConfig,
  AppExposedActions,
  AppImportResult,
  AppToolboxItem,
} from './appExtensions';

// Layout components
export { AppLayout } from './AppLayout';
export { Providers } from './Providers';

// Sub-components
export { Header } from './components/Header';
export { SettingsModal } from './components/SettingsModal';

// Hooks
export * from './hooks';
