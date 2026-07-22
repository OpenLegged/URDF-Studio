import React from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/shared/components/ui/Button';
import { translations, type Language } from '@/shared/i18n';

interface SourceCodeEditorErrorBoundaryProps {
  children: React.ReactNode;
  lang: Language;
  onClose: () => void;
}

interface SourceCodeEditorErrorBoundaryState {
  error: unknown;
  hasError: boolean;
}

function formatLoadError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** Contains editor initialization/runtime failures so the workspace remains usable. */
export class SourceCodeEditorErrorBoundary extends React.Component<
  SourceCodeEditorErrorBoundaryProps,
  SourceCodeEditorErrorBoundaryState
> {
  state: SourceCodeEditorErrorBoundaryState = { error: null, hasError: false };

  static getDerivedStateFromError(error: unknown): SourceCodeEditorErrorBoundaryState {
    return { error, hasError: true };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error(
      translations[this.props.lang].sourceCodeLoadErrorLogPrefix,
      error,
      info.componentStack,
    );
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const t = translations[this.props.lang];
    return (
      <div
        className="fixed inset-0 z-[160] flex items-center justify-center bg-black/45 p-4"
        data-testid="source-code-editor-load-error"
        lang={this.props.lang === 'zh' ? 'zh-CN' : 'en'}
      >
        <div
          className="w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-border-black bg-panel-bg p-5 text-text-primary shadow-2xl"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-danger/15 p-2 text-danger">
              <AlertTriangle aria-hidden="true" className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">{t.sourceCodeLoadErrorTitle}</h2>
              <p className="mt-1 text-sm leading-5 text-text-secondary">
                {t.sourceCodeLoadErrorMessage}
              </p>
            </div>
          </div>

          <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-element-bg p-3 text-xs whitespace-pre-wrap break-words text-text-secondary">
            {formatLoadError(this.state.error)}
          </pre>

          <div className="mt-5 flex justify-end gap-2">
            <Button
              data-testid="source-code-editor-error-close"
              onClick={this.props.onClose}
              type="button"
              variant="secondary"
            >
              {t.close}
            </Button>
            <Button
              data-testid="source-code-editor-error-reload"
              onClick={this.handleReload}
              type="button"
            >
              {t.appErrorBoundaryReload}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
