/**
 * App Module - Application entry components
 * Contains main layout, providers, and header components
 */

// Main components
export { AppLayout } from './AppLayout';
export { Providers } from './Providers';

// Sub-components
export { Header } from './components/Header';

// Hooks
export { useAppEffects, useKeyboardShortcuts, useSelectionCleanup } from './hooks/useAppEffects';
