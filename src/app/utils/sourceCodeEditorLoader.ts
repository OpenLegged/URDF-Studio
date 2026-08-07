import { createPreloadableComponent } from './preloadableComponent';

export const loadSourceCodeEditorModule = () => import('@/features/code-editor');

const sourceCodeEditorResource = createPreloadableComponent(
  loadSourceCodeEditorModule,
  (module) => module.SourceCodeEditor,
);

export const SourceCodeEditor = sourceCodeEditorResource.Component;
export const preloadSourceCodeEditorRuntime = sourceCodeEditorResource.preload;
