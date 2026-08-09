import type { OnChange, OnMount } from '@monaco-editor/react';
import { Loader2 } from 'lucide-react';
import type { CodeEditorFontFamily } from '@/store';
import type { Theme } from '@/types';
import type { TranslationKeys } from '@/shared/i18n';
import { resolveCodeEditorFontFamily, type SourceCodeDocumentMeta } from './sourceCodeEditorModel';

interface SourceCodeEditorPaneProps {
  activeDocumentCode: string;
  activeDocumentId: string;
  codeEditorFontFamily: CodeEditorFontFamily;
  codeEditorFontSize: number;
  documentMeta: SourceCodeDocumentMeta;
  editorComponent: typeof import('@monaco-editor/react').default;
  isContentLoading: boolean;
  isEditorReady: boolean;
  isReadOnly: boolean;
  onChange: OnChange;
  onMount: OnMount;
  t: TranslationKeys;
  theme: Theme;
  validationEnabled: boolean;
}

export function SourceCodeEditorPane({
  activeDocumentCode,
  activeDocumentId,
  codeEditorFontFamily,
  codeEditorFontSize,
  documentMeta,
  editorComponent: MonacoEditor,
  isContentLoading,
  isEditorReady,
  isReadOnly,
  onChange,
  onMount,
  t,
  theme,
  validationEnabled,
}: SourceCodeEditorPaneProps) {
  return (
    <div className="relative flex-1 overflow-hidden">
      {!isEditorReady ? (
        <div className="source-code-editor-panel absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            <span>{t.sourceCodeLoading}</span>
          </div>
        </div>
      ) : null}
      {isEditorReady && isContentLoading ? (
        <div className="source-code-editor-overlay absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
            <span>{t.sourceCodeLoading}</span>
          </div>
        </div>
      ) : null}

      <MonacoEditor
        key={activeDocumentId}
        height="100%"
        defaultLanguage={documentMeta.language}
        defaultValue={activeDocumentCode}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        onMount={onMount}
        onChange={onChange}
        options={{
          minimap: { enabled: false },
          fontSize: codeEditorFontSize,
          fontFamily: resolveCodeEditorFontFamily(codeEditorFontFamily),
          fontLigatures: true,
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          stickyScroll: { enabled: false },
          scrollbar: { horizontal: 'auto', vertical: 'auto' },
          automaticLayout: false,
          tabSize: 2,
          formatOnPaste: !isReadOnly && documentMeta.isXmlLike,
          formatOnType: !isReadOnly && documentMeta.isXmlLike,
          lineNumbersMinChars: 4,
          padding: { top: 12, bottom: 14 },
          renderLineHighlight: 'all',
          readOnly: isReadOnly,
          domReadOnly: isReadOnly,
          glyphMargin: validationEnabled,
          renderValidationDecorations: validationEnabled ? 'editable' : 'off',
        }}
      />
    </div>
  );
}
