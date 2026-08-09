import { useMemo } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle,
  Code,
  Copy,
  Download,
  Files,
  Info,
  Loader2,
  Lock,
  Save,
} from 'lucide-react';
import { FLOATING_WINDOW_TITLE_CLASS } from '@/shared/components/DraggableWindow';
import { Select, Tooltip } from '@/shared/components/ui';
import type { TranslationKeys } from '@/shared/i18n';
import {
  getSourceCodeEditorTabAccentClassName,
  getSourceCodeEditorTabBadgeClassName,
  getSourceCodeEditorTabClassName,
  shouldCollapseSourceCodeEditorTabs,
  SOURCE_CODE_EDITOR_TABS_CLASS,
} from '../utils/sourceCodeEditorTabClasses';
import type { ValidationError } from '../utils/urdfValidation';
import type {
  ActiveSourceCodeDocument,
  SourceCodeDocumentMeta,
} from './sourceCodeEditorModel';

const HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-element-hover';
const HEADER_PRIMARY_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors';

interface SourceCodeEditorTitleProps {
  activeDocumentFlavor: ActiveSourceCodeDocument['documentFlavor'];
  activeDocumentLabel: string;
  activeDocumentPath: string;
  contentSizeLabel: string;
  documentCount: number;
  isDirty: boolean;
  isReadOnly: boolean;
  t: TranslationKeys;
}

export function SourceCodeEditorTitle({
  activeDocumentFlavor,
  activeDocumentLabel,
  activeDocumentPath,
  contentSizeLabel,
  documentCount,
  isDirty,
  isReadOnly,
  t,
}: SourceCodeEditorTitleProps) {
  const shouldShowActiveDocumentPath = activeDocumentPath !== activeDocumentLabel;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
      <Code className="h-4 w-4 shrink-0 text-system-blue" />
      <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
        <span
          className={`min-w-0 truncate font-mono ${FLOATING_WINDOW_TITLE_CLASS}`}
          title={activeDocumentPath}
        >
          {activeDocumentLabel}
        </span>
        {documentCount > 1 && shouldShowActiveDocumentPath ? (
          <span className="min-w-0 truncate font-mono text-[10px] text-text-tertiary">
            {activeDocumentPath}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="shrink-0 text-[10px] text-text-tertiary">{contentSizeLabel}</span>
        {isReadOnly ? (
          <span className="shrink-0 rounded bg-element-hover px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-secondary">
            {t.sourceCodeReadOnly}
          </span>
        ) : null}
        {activeDocumentFlavor === 'equivalent-mjcf' ? (
          <span className="shrink-0 rounded bg-system-blue/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-system-blue">
            {t.sourceCodeGenerated}
          </span>
        ) : null}
        {!isReadOnly && isDirty ? (
          <span className="shrink-0 rounded bg-amber-500/12 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            {t.sourceCodeModified}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface SourceCodeEditorHeaderActionsProps {
  copied: boolean;
  isApplying: boolean;
  isDirty: boolean;
  isEquivalentMjcfPreview: boolean;
  isReadOnly: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onSave: () => void;
  t: TranslationKeys;
}

export function SourceCodeEditorHeaderActions({
  copied,
  isApplying,
  isDirty,
  isEquivalentMjcfPreview,
  isReadOnly,
  onCopy,
  onDownload,
  onSave,
  t,
}: SourceCodeEditorHeaderActionsProps) {
  return (
    <div className="flex items-center gap-1">
      {!isReadOnly ? (
        <Tooltip content={t.sourceCodeSaveTooltip} side="bottom">
          <button
            onClick={onSave}
            disabled={!isDirty || isApplying}
            data-testid="source-code-save"
            className={`${HEADER_PRIMARY_ACTION_CLASS} ${
              isDirty || isApplying
                ? 'bg-system-blue-solid text-white hover:bg-system-blue-hover'
                : 'cursor-not-allowed bg-transparent text-text-tertiary'
            }`}
            type="button"
          >
            {isApplying ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Save className="h-3 w-3" />
            )}
            <span>{t.sourceCodeSave}</span>
          </button>
        </Tooltip>
      ) : null}
      <Tooltip
        content={
          isEquivalentMjcfPreview
            ? t.sourceCodePreviewDownloadTooltip
            : t.sourceCodeDownloadTooltip
        }
        side="bottom"
      >
        <button
          onClick={onDownload}
          className={`${HEADER_ACTION_CLASS} ${
            isEquivalentMjcfPreview ? 'cursor-not-allowed opacity-60' : ''
          }`}
          disabled={isEquivalentMjcfPreview}
          type="button"
        >
          <Download className="h-3.5 w-3.5" />
          <span>{t.sourceCodeDownload}</span>
        </button>
      </Tooltip>
      <Tooltip content={t.sourceCodeCopyTooltip} side="bottom">
        <button
          onClick={onCopy}
          className={`${HEADER_ACTION_CLASS} ${copied ? 'bg-element-hover text-system-blue' : ''}`}
          type="button"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          <span>{copied ? t.sourceCodeCopied : t.sourceCodeCopy}</span>
        </button>
      </Tooltip>
    </div>
  );
}

interface SourceCodeEditorDocumentNavigationProps {
  activeDocument: ActiveSourceCodeDocument;
  activeDocumentPath: string;
  documents: ActiveSourceCodeDocument[];
  onDocumentSwitch: (documentId: string) => Promise<void> | void;
  t: TranslationKeys;
}

export function SourceCodeEditorDocumentNavigation({
  activeDocument,
  activeDocumentPath,
  documents,
  onDocumentSwitch,
  t,
}: SourceCodeEditorDocumentNavigationProps) {
  const documentSelectOptions = useMemo(
    () =>
      documents.map((document) => ({
        value: document.id,
        label: document.tabLabel ?? document.fileName,
      })),
    [documents],
  );

  if (documents.length <= 1) {
    return null;
  }

  if (shouldCollapseSourceCodeEditorTabs(documents.length)) {
    return (
      <div className="source-code-editor-chrome flex h-10 shrink-0 items-center gap-2 border-b border-border-black px-3 select-none">
        <Files className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        <Select
          aria-label={t.sourceCodeSelectFile}
          className="h-7 rounded-md bg-element-bg py-1 pr-7 pl-2 font-mono text-[11px] leading-none"
          containerClassName="min-w-0 max-w-[420px] flex-1"
          menuClassName="font-mono"
          optionButtonClassName="rounded-md px-2 py-1.5"
          optionClassName="text-[11px]"
          options={documentSelectOptions}
          title={activeDocumentPath}
          value={activeDocument.id}
          onChange={(event) => {
            void onDocumentSwitch(event.currentTarget.value);
          }}
        />
        <span className="shrink-0 text-[10px] font-medium text-text-tertiary">
          {documents.length} {t.sourceCodeFiles}
        </span>
      </div>
    );
  }

  return (
    <div className="source-code-editor-chrome custom-scrollbar flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-border-black select-none">
      <div
        aria-label={t.sourceCodeSelectFile}
        className={SOURCE_CODE_EDITOR_TABS_CLASS}
        role="tablist"
      >
        {documents.map((document) => {
          const isActiveDocument = document.id === activeDocument.id;
          return (
            <button
              key={document.id}
              aria-selected={isActiveDocument}
              className={getSourceCodeEditorTabClassName(isActiveDocument)}
              onClick={() => {
                void onDocumentSwitch(document.id);
              }}
              role="tab"
              title={document.filePath ?? document.fileName}
              type="button"
            >
              <span
                aria-hidden="true"
                className={getSourceCodeEditorTabAccentClassName(isActiveDocument)}
              />
              <span className="max-w-44 truncate">{document.tabLabel ?? document.fileName}</span>
              {document.documentFlavor === 'equivalent-mjcf' ? (
                <span className={getSourceCodeEditorTabBadgeClassName(isActiveDocument)}>
                  {t.sourceCodeGenerated}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface SourceCodeEditorStatusBarProps {
  applyErrorMessage: string | null;
  documentMeta: SourceCodeDocumentMeta;
  isMaximized: boolean;
  isReadOnly: boolean;
  onJumpToFirstProblem: () => void;
  size: { width: number; height: number };
  t: TranslationKeys;
  validationEnabled: boolean;
  validationErrors: ValidationError[];
}

export function SourceCodeEditorStatusBar({
  applyErrorMessage,
  documentMeta,
  isMaximized,
  isReadOnly,
  onJumpToFirstProblem,
  size,
  t,
  validationEnabled,
  validationErrors,
}: SourceCodeEditorStatusBarProps) {
  return (
    <div className="source-code-editor-chrome flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border-black px-3 text-[10px] select-none">
      <div className="flex min-w-0 items-center gap-3">
        {validationEnabled ? (
          validationErrors.length > 0 ? (
            <Tooltip content={t.sourceCodeJumpToProblem} side="bottom">
              <button
                className="flex items-center gap-1.5 text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-400"
                onClick={onJumpToFirstProblem}
                type="button"
              >
                <AlertCircle className="h-3 w-3" />
                <span>
                  {validationErrors.length} {t.sourceCodeProblems}
                </span>
              </button>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-1.5 text-success dark:text-success">
              <CheckCircle className="h-3 w-3" />
              <span>{t.sourceCodeNoErrors}</span>
            </div>
          )
        ) : (
          <div className="flex items-center gap-1.5 text-text-secondary">
            {isReadOnly ? <Lock className="h-3 w-3" /> : <Info className="h-3 w-3" />}
            <span>{isReadOnly ? t.sourceCodeReadOnlyView : t.sourceCodeNoStructuralValidation}</span>
          </div>
        )}

        {isReadOnly ? (
          <>
            <div className="h-3 w-px bg-border-black" />
            <div className="flex items-center gap-1.5 text-text-secondary">
              <span>{t.sourceCodeReadOnly}</span>
            </div>
          </>
        ) : null}

        {!isReadOnly && applyErrorMessage ? (
          <>
            <div className="h-3 w-px bg-border-black" />
            <div className="flex min-w-0 items-center gap-1.5 text-danger" title={applyErrorMessage}>
              <AlertCircle className="h-3 w-3 shrink-0" />
              <span className="truncate">{t.sourceCodeApplyFailed}</span>
            </div>
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-2 font-mono text-text-tertiary">
        {!isReadOnly ? (
          <>
            <span>{t.sourceCodeSaveShortcut}</span>
            <span aria-hidden="true">•</span>
          </>
        ) : null}
        <span>{documentMeta.label}</span>
        <span aria-hidden="true">•</span>
        <span>
          {isMaximized
            ? t.sourceCodeMaximized
            : `${Math.round(size.width)} × ${Math.round(size.height)}`}
        </span>
      </div>
    </div>
  );
}
