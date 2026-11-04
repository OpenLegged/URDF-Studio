/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: {
  readonly app: string;
  readonly revision: string | null;
  readonly coreRevision: string | null;
  readonly builtAt: string;
  readonly dirty: boolean | null;
};

// Monaco ships its ESM internals without per-entry type declarations. The source
// editor intentionally imports the trimmed `edcore.main` entry (see
// src/features/code-editor/utils/monacoLoader.ts) to drop the unused language
// services. Alias its types to the package's public API surface; the imported
// namespace is only handed to `loader.config({ monaco })`, never dot-accessed
// for the language-service members edcore.main omits at runtime.
declare module 'monaco-editor/esm/vs/editor/edcore.main' {
  export * from 'monaco-editor';
}
