/**
 * SourceCodeEditor - Unified Monaco source window for editable and read-only code.
 * Supports URDF, Xacro, MJCF, USD text, and equivalent MJCF previews in one reusable shell.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import MonacoEditor from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';
import { Maximize, Minimize, X } from 'lucide-react';
import { useManagedWindowLayer, useUIStore } from '@/store';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
} from '@/shared/components/DraggableWindow';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS } from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import type { MonacoInstance } from '../utils/monacoLoader';
import { ensureSourceCodeEditorLanguages } from '../utils/monacoLoader';
import { downloadSourceCodeDocument } from '../utils/sourceCodeDownload';
import {
  accumulateSourceCodeDirtyRanges,
  shouldResetSourceCodeEditorSession,
  type SourceCodeEditorApplyRequest,
  type SourceCodeEditorSessionBoundary,
} from '../utils/sourceCodeEditorSession';
import { useSourceCodeEditorAutoApply } from '../hooks/useSourceCodeEditorAutoApply';
import { useSourceCodeEditorValidation } from '../hooks/useSourceCodeEditorValidation';
import {
  SourceCodeEditorDocumentNavigation,
  SourceCodeEditorHeaderActions,
  SourceCodeEditorStatusBar,
  SourceCodeEditorTitle,
} from './SourceCodeEditorChrome';
import { SourceCodeEditorPane } from './SourceCodeEditorPane';
import {
  formatCodeEditorOpacityPercent,
  formatSourceCodeContentSize,
  getSourceCodeDocumentMeta,
  normalizeSourceCodeDocuments,
  type SourceCodeEditorProps,
} from './sourceCodeEditorModel';

export type { SourceCodeEditorDocument, SourceCodeEditorProps } from './sourceCodeEditorModel';

interface RegressionSourceEditorDebugApi {
  getValue: () => string;
  replaceFirst: (fromText: string, toText: string) => { ok: boolean; error?: string };
  setValue: (value: string) => { ok: boolean };
}

type RegressionSourceEditorWindow = Window & {
  __URDF_STUDIO_DEBUG__?: {
    __sourceEditor?: RegressionSourceEditorDebugApi;
  };
};

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;
const FIND_WIDGET_TOOLTIP_TARGET_SELECTOR =
  '.find-widget .button, .find-widget .monaco-custom-toggle';

const attachFindWidgetTooltipSuppression = (
  editor: Pick<Monaco.editor.IStandaloneCodeEditor, 'getDomNode'>,
) => {
  const editorDomNode = editor.getDomNode();
  if (!(editorDomNode instanceof HTMLElement)) {
    return () => undefined;
  }

  const handleMouseOverCapture = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(FIND_WIDGET_TOOLTIP_TARGET_SELECTOR)) {
      event.stopPropagation();
    }
  };

  editorDomNode.addEventListener('mouseover', handleMouseOverCapture, true);

  return () => {
    editorDomNode.removeEventListener('mouseover', handleMouseOverCapture, true);
  };
};

export const SourceCodeEditor: React.FC<SourceCodeEditorProps> = ({
  documents,
  code,
  onCodeChange,
  onClose,
  theme,
  fileName = 'robot.urdf',
  lang = 'en',
  documentFlavor = 'urdf',
  readOnly = false,
  autoApplyEnabled = true,
  onDownload,
}) => {
  const codeEditorFontFamily = useUIStore((state) => state.codeEditorFontFamily);
  const codeEditorFontSize = useUIStore((state) => state.codeEditorFontSize);
  const codeEditorOpacity = useUIStore((state) => state.codeEditorOpacity);
  const sourceCodeWindowLayer = useManagedWindowLayer('sourceCode');
  const t = translations[lang];
  const xmlValidationTexts = useMemo(
    () => ({
      xmlParseError: t.sourceCodeXmlParseError,
      cannotParseXml: t.sourceCodeCannotParseXml,
    }),
    [t],
  );
  const normalizedDocuments = useMemo(
    () =>
      normalizeSourceCodeDocuments({
        documents,
        code,
        onCodeChange,
        fileName,
        documentFlavor,
        readOnly,
        onDownload,
      }),
    [code, documentFlavor, documents, fileName, onCodeChange, onDownload, readOnly],
  );
  const [activeDocumentId, setActiveDocumentId] = useState(
    () => normalizedDocuments[0]?.id ?? fileName,
  );
  const activeDocument = useMemo(
    () =>
      normalizedDocuments.find((document) => document.id === activeDocumentId) ??
      normalizedDocuments[0],
    [activeDocumentId, normalizedDocuments],
  );

  useEffect(() => {
    if (!normalizedDocuments.some((document) => document.id === activeDocument.id)) {
      setActiveDocumentId(normalizedDocuments[0]?.id ?? activeDocument.id);
    }
  }, [activeDocument, normalizedDocuments]);

  const activeDocumentFileName = activeDocument.fileName;
  const activeDocumentLabel = activeDocument.tabLabel ?? activeDocument.fileName;
  const activeDocumentPath = activeDocument.filePath ?? activeDocument.fileName;
  const activeDocumentFlavor = activeDocument.documentFlavor;
  const activeDocumentValidationEnabled = activeDocument.validationEnabled;
  const isEquivalentMjcfPreview = activeDocumentFlavor === 'equivalent-mjcf';
  const isReadOnly = activeDocument.readOnly || activeDocumentFlavor === 'equivalent-mjcf';
  const documentMeta = useMemo(
    () => getSourceCodeDocumentMeta(activeDocumentFlavor, t),
    [activeDocumentFlavor, t],
  );
  const validationEnabled = activeDocumentValidationEnabled ?? documentMeta.supportsValidation;
  const [isDirty, setIsDirty] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyErrorMessage, setApplyErrorMessage] = useState<string | null>(null);
  const [autoApplyBlockedCode, setAutoApplyBlockedCode] = useState<string | null>(null);
  const [loadedDocumentCodes, setLoadedDocumentCodes] = useState<
    Record<string, { contentUrl: string; code: string }>
  >({});
  const [loadingDocumentId, setLoadingDocumentId] = useState<string | null>(null);
  const loadedActiveDocumentCode =
    activeDocument.contentUrl && activeDocument.code.length === 0
      ? loadedDocumentCodes[activeDocument.id]
      : undefined;
  const activeDocumentCode =
    loadedActiveDocumentCode && loadedActiveDocumentCode.contentUrl === activeDocument.contentUrl
      ? loadedActiveDocumentCode.code
      : activeDocument.code;
  const [currentCode, setCurrentCode] = useState(activeDocumentCode);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAppliedCodeRef = useRef<string | null>(null);
  const pendingAppliedBaseCodeRef = useRef<string | null>(null);
  const dirtyRangesRef = useRef<NonNullable<SourceCodeEditorApplyRequest['dirtyRanges']>>([]);
  const suppressDirtyTrackingRef = useRef(0);
  const contentChangeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const sessionBoundaryRef = useRef<SourceCodeEditorSessionBoundary | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const editorMountVersionRef = useRef(0);
  const [monacoInstance, setMonacoInstance] = useState<MonacoInstance | null>(null);
  const {
    isValidationPending,
    resetValidation,
    validateImmediately,
    validationErrors,
  } = useSourceCodeEditorValidation({
    currentCode,
    documentFlavor: activeDocumentFlavor,
    documentLanguage: documentMeta.language,
    editorRef,
    monacoInstance,
    t,
    validationEnabled,
    validationTexts: xmlValidationTexts,
  });
  const shouldLoadActiveDocumentContent = Boolean(
    activeDocument.contentUrl &&
    activeDocument.code.length === 0 &&
    loadedActiveDocumentCode?.contentUrl !== activeDocument.contentUrl,
  );

  const windowState = useDraggableWindow({
    defaultPosition: { x: 100, y: 100 },
    defaultSize: { width: 800, height: 600 },
    minSize: { width: MIN_WIDTH, height: MIN_HEIGHT },
    centerOnMount: false,
    enableMinimize: false,
    clampResizeToViewport: false,
    dragBounds: {
      allowNegativeX: true,
      minVisibleWidth: 100,
      bottomMargin: 50,
    },
  });

  const { isMaximized, size, toggleMaximize } = windowState;

  const contentSizeLabel = useMemo(() => formatSourceCodeContentSize(currentCode), [currentCode]);
  const opacityStyle = useMemo(
    () =>
      ({
        '--source-code-editor-opacity-percent': formatCodeEditorOpacityPercent(codeEditorOpacity),
      }) as React.CSSProperties,
    [codeEditorOpacity],
  );
  const isActiveDocumentContentLoading =
    shouldLoadActiveDocumentContent || loadingDocumentId === activeDocument.id;

  useEffect(() => {
    return () => {
      editorMountVersionRef.current += 1;
      contentChangeDisposableRef.current?.dispose();
      contentChangeDisposableRef.current = null;
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!shouldLoadActiveDocumentContent || !activeDocument.contentUrl) {
      return undefined;
    }

    const documentId = activeDocument.id;
    const contentUrl = activeDocument.contentUrl;
    const controller = new AbortController();
    setLoadingDocumentId(documentId);

    void fetch(contentUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load source document: ${response.status}`);
        }
        return response.text();
      })
      .then((code) => {
        setLoadedDocumentCodes((previous) => ({
          ...previous,
          [documentId]: { contentUrl, code },
        }));
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        console.error('Failed to load source document content:', error);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingDocumentId((current) => (current === documentId ? null : current));
        }
      });

    return () => {
      controller.abort();
      setLoadingDocumentId((current) => (current === documentId ? null : current));
    };
  }, [activeDocument.contentUrl, activeDocument.id, shouldLoadActiveDocumentContent]);

  useEffect(() => {
    const nextSessionBoundary = {
      documentId: activeDocument.id,
      validationEnabled,
    } satisfies SourceCodeEditorSessionBoundary;

    if (!shouldResetSourceCodeEditorSession(sessionBoundaryRef.current, nextSessionBoundary)) {
      return;
    }

    sessionBoundaryRef.current = nextSessionBoundary;
    pendingAppliedCodeRef.current = null;
    pendingAppliedBaseCodeRef.current = null;
    dirtyRangesRef.current = [];
    contentChangeDisposableRef.current?.dispose();
    contentChangeDisposableRef.current = null;
    editorRef.current = null;
    setCurrentCode(activeDocumentCode);
    setIsDirty(false);
    setAutoApplyBlockedCode(null);
    resetValidation();
    setIsApplying(false);
    setApplyErrorMessage(null);
    setIsEditorReady(false);
    setCopied(false);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [activeDocument.id, activeDocumentCode, resetValidation, validationEnabled]);

  useEffect(() => {
    const awaitingParentApplySync =
      pendingAppliedCodeRef.current !== null &&
      pendingAppliedCodeRef.current === currentCode &&
      activeDocumentCode === pendingAppliedBaseCodeRef.current;

    if (awaitingParentApplySync) {
      return;
    }

    if (
      pendingAppliedCodeRef.current !== null &&
      activeDocumentCode !== pendingAppliedBaseCodeRef.current
    ) {
      pendingAppliedCodeRef.current = null;
      pendingAppliedBaseCodeRef.current = null;
    }

    if (editorRef.current && activeDocumentCode !== currentCode && !isDirty) {
      suppressDirtyTrackingRef.current += 1;
      editorRef.current.setValue(activeDocumentCode);
      suppressDirtyTrackingRef.current = Math.max(0, suppressDirtyTrackingRef.current - 1);
      setCurrentCode(activeDocumentCode);
      dirtyRangesRef.current = [];
      setApplyErrorMessage(null);
      setAutoApplyBlockedCode(null);
      return;
    }

    if (
      activeDocumentCode === currentCode &&
      pendingAppliedCodeRef.current === activeDocumentCode
    ) {
      pendingAppliedCodeRef.current = null;
      pendingAppliedBaseCodeRef.current = null;
    }
  }, [activeDocumentCode, currentCode, isDirty]);

  const handleApply = useCallback(
    async (trigger: 'manual' | 'auto' = 'manual') => {
      if (isReadOnly || !editorRef.current || isApplying) {
        return false;
      }

      const value = editorRef.current.getValue();
      validateImmediately(value);

      setIsApplying(true);

      try {
        const didApply = await Promise.resolve(
          activeDocument.onCodeChange(value, {
            dirtyRanges: [...dirtyRangesRef.current],
          }),
        );
        if (didApply) {
          pendingAppliedCodeRef.current = value;
          pendingAppliedBaseCodeRef.current = activeDocumentCode;
          dirtyRangesRef.current = [];
          setIsDirty(false);
          setApplyErrorMessage(null);
          setAutoApplyBlockedCode(null);
          return true;
        }

        setApplyErrorMessage(t.sourceCodeApplyFailedMessage);
        if (trigger === 'auto') {
          setAutoApplyBlockedCode(value);
        }
        return false;
      } catch (error) {
        if (trigger === 'auto') {
          setAutoApplyBlockedCode(value);
        }
        setApplyErrorMessage(
          error instanceof Error && error.message
            ? `${t.sourceCodeApplyFailedMessage} ${error.message}`
            : t.sourceCodeApplyFailedMessage,
        );
        console.error('Failed to apply source code changes:', error);
        return false;
      } finally {
        setIsApplying(false);
      }
    },
    [
      activeDocument,
      activeDocumentCode,
      isApplying,
      isReadOnly,
      t,
      validateImmediately,
    ],
  );

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value === undefined) {
        return;
      }

      setCurrentCode(value);
      setIsDirty(isReadOnly ? false : value !== activeDocumentCode);
      if (applyErrorMessage) {
        setApplyErrorMessage(null);
      }
      if (autoApplyBlockedCode && autoApplyBlockedCode !== value) {
        setAutoApplyBlockedCode(null);
      }
    },
    [activeDocumentCode, applyErrorMessage, autoApplyBlockedCode, isReadOnly],
  );

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(currentCode);
    setCopied(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
  }, [currentCode]);

  const handleDownload = useCallback(() => {
    downloadSourceCodeDocument({
      content: currentCode,
      fileName: activeDocumentFileName,
      documentFlavor: activeDocumentFlavor,
      onDownload: activeDocument.onDownload,
    });
  }, [activeDocument, activeDocumentFileName, activeDocumentFlavor, currentCode]);

  const handleDocumentSwitch = useCallback(
    async (nextDocumentId: string) => {
      if (
        nextDocumentId === activeDocument.id ||
        isApplying ||
        !normalizedDocuments.some((document) => document.id === nextDocumentId)
      ) {
        return;
      }

      if (isDirty && !isReadOnly) {
        const didApply = await handleApply('manual');
        if (!didApply) {
          return;
        }
      }

      setActiveDocumentId(nextDocumentId);
    },
    [activeDocument.id, handleApply, isApplying, isDirty, isReadOnly, normalizedDocuments],
  );

  useEffect(() => {
    if (isReadOnly) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (isDirty) {
          void handleApply('manual');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleApply, isDirty, isReadOnly]);

  const handleAutoApply = useCallback(() => {
    void handleApply('auto');
  }, [handleApply]);

  useSourceCodeEditorAutoApply({
    enabled: autoApplyEnabled,
    currentCode,
    isDirty,
    isReadOnly,
    supportsValidation: validationEnabled,
    validationErrorCount: validationErrors.length,
    isValidationPending,
    isApplying,
    autoApplyBlockedCode,
    onAutoApply: handleAutoApply,
  });

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      editorRef.current?.layout();
    });
    return () => cancelAnimationFrame(id);
  }, [isMaximized, size.height, size.width]);

  useEffect(() => {
    if (!isEditorReady || !editorRef.current) {
      return undefined;
    }

    return attachFindWidgetTooltipSuppression(editorRef.current);
  }, [isEditorReady]);

  useEffect(() => {
    if (!isEditorReady || !editorRef.current || !monacoInstance || typeof window === 'undefined') {
      return undefined;
    }

    const debugApi = (window as RegressionSourceEditorWindow).__URDF_STUDIO_DEBUG__;
    if (!debugApi) {
      return undefined;
    }

    const editor = editorRef.current;
    const sourceEditorDebug: RegressionSourceEditorDebugApi = {
      getValue: () => editor.getValue(),
      replaceFirst: (fromText, toText) => {
        const model = editor.getModel?.();
        if (!model || typeof fromText !== 'string') {
          return { ok: false, error: 'source editor model is unavailable' };
        }

        const value = editor.getValue();
        const offset = value.indexOf(fromText);
        if (offset < 0) {
          return { ok: false, error: `source text not found: ${fromText}` };
        }

        const start = model.getPositionAt(offset);
        const end = model.getPositionAt(offset + fromText.length);

        model.applyEdits([
          {
            range: new monacoInstance.Range(
              start.lineNumber,
              start.column,
              end.lineNumber,
              end.column,
            ),
            text: toText,
          },
        ]);
        return { ok: true };
      },
      setValue: (value) => {
        editor.setValue(value);
        return { ok: true };
      },
    };

    debugApi.__sourceEditor = sourceEditorDebug;
    return () => {
      if (debugApi.__sourceEditor === sourceEditorDebug) {
        delete debugApi.__sourceEditor;
      }
    };
  }, [activeDocument.id, isEditorReady, monacoInstance]);

  const handleEditorMount = useCallback(
    (editor: Monaco.editor.IStandaloneCodeEditor, monaco: MonacoInstance) => {
      const mountVersion = editorMountVersionRef.current + 1;
      editorMountVersionRef.current = mountVersion;
      contentChangeDisposableRef.current?.dispose();
      contentChangeDisposableRef.current = null;
      editorRef.current = editor;

      if (editorMountVersionRef.current !== mountVersion || editorRef.current !== editor) {
        return;
      }

      try {
        setMonacoInstance(ensureSourceCodeEditorLanguages(monaco));
      } catch (error) {
        console.error('Failed to initialize Monaco editor languages:', error);
        setMonacoInstance(monaco);
      }

      const model = editor.getModel();
      contentChangeDisposableRef.current =
        model?.onDidChangeContent((event) => {
          if (suppressDirtyTrackingRef.current > 0 || isReadOnly) {
            return;
          }

          const changes =
            event.changes?.map((change) => ({
              rangeOffset: change.rangeOffset,
              rangeLength: change.rangeLength,
              text: change.text,
            })) ?? [];
          if (changes.length === 0) {
            return;
          }

          dirtyRangesRef.current = accumulateSourceCodeDirtyRanges(dirtyRangesRef.current, changes);
        }) ?? null;

      const domNode = editor.getDomNode();
      if (domNode) {
        const styleId = 'source-code-editor-transparent-bg';
        if (!domNode.querySelector(`#${styleId}`)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `.monaco-editor, .monaco-editor-background, .monaco-editor .margin { background-color: transparent !important; }`;
          domNode.appendChild(style);
        }
      }

      setIsEditorReady(true);
      requestAnimationFrame(() => {
        if (editorMountVersionRef.current === mountVersion && editorRef.current) {
          editorRef.current.layout();
        }
      });
    },
    [isReadOnly],
  );

  const handleManualApply = useCallback(() => {
    void handleApply('manual');
  }, [handleApply]);

  const handleJumpToFirstProblem = useCallback(() => {
    const firstError = validationErrors[0];
    if (!editorRef.current || !firstError) {
      return;
    }

    editorRef.current.revealLineInCenter(firstError.line);
    editorRef.current.setPosition({
      lineNumber: firstError.line,
      column: firstError.column || 1,
    });
    editorRef.current.focus();
  }, [validationErrors]);

  return (
    <DraggableWindow
      window={windowState}
      onClose={onClose}
      title={
        <SourceCodeEditorTitle
          activeDocumentFlavor={activeDocumentFlavor}
          activeDocumentLabel={activeDocumentLabel}
          activeDocumentPath={activeDocumentPath}
          contentSizeLabel={contentSizeLabel}
          documentCount={normalizedDocuments.length}
          isDirty={isDirty}
          isReadOnly={isReadOnly}
          t={t}
        />
      }
      headerActions={
        <SourceCodeEditorHeaderActions
          copied={copied}
          isApplying={isApplying}
          isDirty={isDirty}
          isEquivalentMjcfPreview={isEquivalentMjcfPreview}
          isReadOnly={isReadOnly}
          onCopy={handleCopy}
          onDownload={handleDownload}
          onSave={handleManualApply}
          t={t}
        />
      }
      style={opacityStyle}
      className={`source-code-editor-window flex flex-col overflow-hidden ${FLOATING_WINDOW_RADIUS_CLASS} border border-border-black text-text-primary shadow-2xl ${
        isMaximized ? 'inset-0 !h-full !w-full !transform-none rounded-none' : ''
      }`}
      zIndex={sourceCodeWindowLayer.zIndex}
      onActivate={sourceCodeWindowLayer.onActivate}
      headerClassName={`source-code-editor-chrome flex ${FLOATING_WINDOW_HEADER_HEIGHT_CLASS} shrink-0 items-center justify-between gap-3 border-b border-border-black px-3 select-none`}
      headerLeftClassName="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden"
      headerRightClassName="flex shrink-0 items-center gap-1"
      showMinimizeButton={false}
      maximizeTitle={t.maximize}
      restoreTitle={t.restore}
      closeTitle={t.close}
      onHeaderDoubleClick={toggleMaximize}
      controlButtonClassName="rounded p-1.5 text-text-tertiary transition-colors hover:bg-element-hover"
      closeButtonClassName={`rounded p-1.5 ${CLOSE_BUTTON_DANGER_TERTIARY_CLASS}`}
      rightResizeHandleClassName="absolute resize-edge-right resize-edge-visual-right top-10 bottom-7 z-40 w-1.5 cursor-ew-resize after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      bottomResizeHandleClassName="absolute resize-edge-bottom resize-edge-visual-bottom left-0 right-0 z-40 h-1.5 cursor-ns-resize after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
      cornerResizeHandleClassName="absolute resize-edge-bottom resize-edge-right z-50 h-4 w-4 cursor-nwse-resize"
      rightResizeDirection="e"
      bottomResizeDirection="s"
      cornerResizeDirection="se"
      controlIcons={{
        maximize: <Maximize className="h-3.5 w-3.5" />,
        restore: <Minimize className="h-3.5 w-3.5" />,
        close: <X className="h-4 w-4" />,
      }}
    >
      <SourceCodeEditorDocumentNavigation
        activeDocument={activeDocument}
        activeDocumentPath={activeDocumentPath}
        documents={normalizedDocuments}
        onDocumentSwitch={handleDocumentSwitch}
        t={t}
      />
      <SourceCodeEditorPane
        activeDocumentCode={activeDocumentCode}
        activeDocumentId={activeDocument.id}
        codeEditorFontFamily={codeEditorFontFamily}
        codeEditorFontSize={codeEditorFontSize}
        documentMeta={documentMeta}
        editorComponent={MonacoEditor}
        isContentLoading={isActiveDocumentContentLoading}
        isEditorReady={isEditorReady}
        isReadOnly={isReadOnly}
        onChange={handleEditorChange}
        onMount={handleEditorMount}
        t={t}
        theme={theme}
        validationEnabled={validationEnabled}
      />
      <SourceCodeEditorStatusBar
        applyErrorMessage={applyErrorMessage}
        documentMeta={documentMeta}
        isMaximized={isMaximized}
        isReadOnly={isReadOnly}
        onJumpToFirstProblem={handleJumpToFirstProblem}
        size={size}
        t={t}
        validationEnabled={validationEnabled}
        validationErrors={validationErrors}
      />
    </DraggableWindow>
  );
};
