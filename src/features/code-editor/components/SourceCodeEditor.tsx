/**
 * SourceCodeEditor - Unified Monaco source window for editable and read-only code.
 * Supports URDF, Xacro, MJCF, USD text, and equivalent MJCF previews in one reusable shell.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import MonacoEditor from '@monaco-editor/react';
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
  Maximize,
  Minimize,
  Save,
  X,
} from 'lucide-react';
import type { Theme } from '@/types';
import {
  useManagedWindowLayer,
  useUIStore,
  type CodeEditorFontFamily,
  type Language,
} from '@/store';
import {
  DraggableWindow,
  FLOATING_WINDOW_HEADER_HEIGHT_CLASS,
  FLOATING_WINDOW_RADIUS_CLASS,
  FLOATING_WINDOW_TITLE_CLASS,
} from '@/shared/components/DraggableWindow';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { CLOSE_BUTTON_DANGER_TERTIARY_CLASS, Select, Tooltip } from '@/shared/components/ui';
import { translations, type TranslationKeys } from '@/shared/i18n';
import type { SourceCodeDocumentFlavor } from '../types';
import type { MonacoInstance } from '../utils/monacoLoader';
import {
  getDocumentLanguageId,
  isXmlLikeDocumentFlavor,
  resolveXmlCompletionEntryForContext,
  supportsDocumentValidation,
} from '../utils/xmlLanguageSupport';
import { getUrdfValidationDebounceMs } from '../utils/editorPerformance.ts';
import { ensureSourceCodeEditorLanguages } from '../utils/monacoLoader';
import { downloadSourceCodeDocument } from '../utils/sourceCodeDownload';
import type { ValidationError } from '../utils/urdfValidation.ts';
import {
  requestXmlCompletionsWithWorker,
  requestXmlValidationWithWorker,
} from '../utils/xmlEditorWorkerBridge.ts';
import {
  getSourceCodeEditorTabAccentClassName,
  getSourceCodeEditorTabBadgeClassName,
  getSourceCodeEditorTabClassName,
  shouldCollapseSourceCodeEditorTabs,
  SOURCE_CODE_EDITOR_TABS_CLASS,
} from '../utils/sourceCodeEditorTabClasses';
import {
  accumulateSourceCodeDirtyRanges,
  shouldResetSourceCodeEditorSession,
  type SourceCodeEditorApplyRequest,
  type SourceCodeEditorSessionBoundary,
} from '../utils/sourceCodeEditorSession';
import { useSourceCodeEditorAutoApply } from '../hooks/useSourceCodeEditorAutoApply';

export interface SourceCodeEditorDocument {
  id: string;
  code: string;
  onCodeChange: (
    newCode: string,
    applyRequest?: SourceCodeEditorApplyRequest,
  ) => Promise<boolean> | boolean;
  fileName: string;
  tabLabel?: string;
  filePath?: string;
  contentUrl?: string;
  documentFlavor?: SourceCodeDocumentFlavor;
  readOnly?: boolean;
  onDownload?: () => void;
  validationEnabled?: boolean;
}

export interface SourceCodeEditorProps {
  documents?: SourceCodeEditorDocument[];
  code?: string;
  onCodeChange?: (
    newCode: string,
    applyRequest?: SourceCodeEditorApplyRequest,
  ) => Promise<boolean> | boolean;
  onClose: () => void;
  theme: Theme;
  fileName?: string;
  lang?: Language;
  documentFlavor?: SourceCodeDocumentFlavor;
  readOnly?: boolean;
  autoApplyEnabled?: boolean;
  onDownload?: () => void;
}

interface DocumentMeta {
  language: ReturnType<typeof getDocumentLanguageId>;
  label: string;
  supportsValidation: boolean;
  isXmlLike: boolean;
}

interface ActiveSourceCodeDocument {
  id: string;
  code: string;
  onCodeChange: (
    newCode: string,
    applyRequest?: SourceCodeEditorApplyRequest,
  ) => Promise<boolean> | boolean;
  fileName: string;
  tabLabel?: string;
  filePath?: string;
  contentUrl?: string;
  documentFlavor: SourceCodeDocumentFlavor;
  readOnly: boolean;
  onDownload?: () => void;
  validationEnabled?: boolean;
}

interface MonacoContentChangeEvent {
  changes?: Array<{
    rangeOffset: number;
    rangeLength: number;
    text: string;
  }>;
}

interface MonacoTextModelLike {
  onDidChangeContent?: (listener: (event: MonacoContentChangeEvent) => void) => {
    dispose: () => void;
  };
}

interface MonacoEditorLike {
  getModel?: () => MonacoTextModelLike | null;
  getValue: () => string;
  setValue: (value: string) => void;
  layout: () => void;
}

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
const HEADER_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-element-hover';
const HEADER_PRIMARY_ACTION_CLASS =
  'inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors';
const formatContentSize = (content: string): string => {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
};

const getCodeDocumentLabel = (fileName: string): string => {
  const normalizedFileName = fileName.replace(/\\/g, '/');
  const segments = normalizedFileName.split('/');
  return segments[segments.length - 1] || normalizedFileName;
};

const normalizeDocuments = ({
  documents,
  code,
  onCodeChange,
  fileName,
  documentFlavor,
  readOnly,
  onDownload,
}: Pick<
  SourceCodeEditorProps,
  'documents' | 'code' | 'onCodeChange' | 'fileName' | 'documentFlavor' | 'readOnly' | 'onDownload'
>): ActiveSourceCodeDocument[] => {
  if (documents && documents.length > 0) {
    return documents.map((document) => ({
      id: document.id,
      code: document.code,
      onCodeChange: document.onCodeChange,
      fileName: document.fileName,
      tabLabel: document.tabLabel ?? document.fileName,
      filePath: document.filePath,
      contentUrl: document.contentUrl,
      documentFlavor: document.documentFlavor ?? 'urdf',
      readOnly: document.readOnly ?? false,
      onDownload: document.onDownload,
      validationEnabled: document.validationEnabled,
    }));
  }

  const resolvedFileName = fileName ?? 'robot.urdf';
  return [
    {
      id: resolvedFileName,
      code: code ?? '',
      onCodeChange:
        onCodeChange ??
        (() => {
          throw new Error(
            'SourceCodeEditor requires onCodeChange when documents are not provided.',
          );
        }),
      fileName: getCodeDocumentLabel(resolvedFileName),
      tabLabel: getCodeDocumentLabel(resolvedFileName),
      documentFlavor: documentFlavor ?? 'urdf',
      readOnly: readOnly ?? false,
      onDownload,
    },
  ];
};

const resolveCodeEditorFontFamily = (fontFamily: CodeEditorFontFamily): string => {
  switch (fontFamily) {
    case 'fira-code':
      return "'Fira Code', 'JetBrains Mono', 'Consolas', 'Monaco', 'Courier New', monospace";
    case 'system-mono':
      return "ui-monospace, 'SFMono-Regular', 'Consolas', 'Monaco', 'Liberation Mono', 'Courier New', monospace";
    case 'jetbrains-mono':
    default:
      return "'JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'Courier New', monospace";
  }
};

const formatCodeEditorOpacityPercent = (opacity: number) => `${Math.round(opacity * 100)}%`;

const getDocumentMeta = (
  documentFlavor: SourceCodeDocumentFlavor,
  t: TranslationKeys,
): DocumentMeta => {
  const language = getDocumentLanguageId(documentFlavor);

  switch (documentFlavor) {
    case 'mjcf':
      return {
        language,
        label: t.sourceCodeMjcfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'sdf':
      return {
        language,
        label: t.sourceCodeSdfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'usd':
      return {
        language,
        label: t.sourceCodeUsdLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'equivalent-mjcf':
      return {
        language,
        label: t.sourceCodeEquivalentMjcfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'xacro':
      return {
        language,
        label: t.sourceCodeXacroLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
    case 'urdf':
    default:
      return {
        language,
        label: t.sourceCodeUrdfLabel,
        supportsValidation: supportsDocumentValidation(documentFlavor),
        isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
      };
  }
};

const attachFindWidgetTooltipSuppression = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: { getDomNode: () => any },
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

const toWorkerValidationError = (error: unknown, t: TranslationKeys): ValidationError[] => [
  {
    line: 1,
    column: 1,
    message: `${t.sourceCodeCannotParseXml}: ${error instanceof Error ? error.message : String(error)}`,
  },
];

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
      normalizeDocuments({
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
  const shouldShowActiveDocumentPath = activeDocumentPath !== activeDocumentLabel;
  const shouldUseDocumentSelector = shouldCollapseSourceCodeEditorTabs(normalizedDocuments.length);
  const documentSelectOptions = useMemo(
    () =>
      normalizedDocuments.map((document) => ({
        value: document.id,
        label: document.tabLabel ?? document.fileName,
      })),
    [normalizedDocuments],
  );
  const activeDocumentFlavor = activeDocument.documentFlavor;
  const activeDocumentValidationEnabled = activeDocument.validationEnabled;
  const isEquivalentMjcfPreview = activeDocumentFlavor === 'equivalent-mjcf';
  const isReadOnly = activeDocument.readOnly || activeDocumentFlavor === 'equivalent-mjcf';
  const documentMeta = useMemo(
    () => getDocumentMeta(activeDocumentFlavor, t),
    [activeDocumentFlavor, t],
  );
  const validationEnabled = activeDocumentValidationEnabled ?? documentMeta.supportsValidation;
  const [isDirty, setIsDirty] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [isValidationPending, setIsValidationPending] = useState(validationEnabled);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
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
  const validationRequestSequenceRef = useRef(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const editorMountVersionRef = useRef(0);
  const [monacoInstance, setMonacoInstance] = useState<MonacoInstance | null>(null);
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

  const contentSizeLabel = useMemo(() => formatContentSize(currentCode), [currentCode]);
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
      validationRequestSequenceRef.current += 1;
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
    validationRequestSequenceRef.current += 1;
    contentChangeDisposableRef.current?.dispose();
    contentChangeDisposableRef.current = null;
    editorRef.current = null;
    setCurrentCode(activeDocumentCode);
    setIsDirty(false);
    setAutoApplyBlockedCode(null);
    setValidationErrors([]);
    setIsValidationPending(validationEnabled);
    setIsApplying(false);
    setApplyErrorMessage(null);
    setIsEditorReady(false);
    setCopied(false);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
  }, [activeDocument.id, activeDocumentCode, validationEnabled]);

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

  useEffect(() => {
    if (!validationEnabled) {
      setValidationErrors([]);
      setIsValidationPending(false);
      validationRequestSequenceRef.current += 1;
      return undefined;
    }

    const requestSequence = validationRequestSequenceRef.current + 1;
    validationRequestSequenceRef.current = requestSequence;
    setIsValidationPending(true);

    const timeout = window.setTimeout(() => {
      void requestXmlValidationWithWorker(currentCode, activeDocumentFlavor, xmlValidationTexts)
        .then((nextErrors) => {
          if (validationRequestSequenceRef.current !== requestSequence) {
            return;
          }
          startTransition(() => {
            setValidationErrors(nextErrors);
            setIsValidationPending(false);
          });
        })
        .catch((error) => {
          if (validationRequestSequenceRef.current !== requestSequence) {
            return;
          }
          console.error('XML validation worker request failed:', error);
          startTransition(() => {
            setValidationErrors(toWorkerValidationError(error, t));
            setIsValidationPending(false);
          });
        });
    }, getUrdfValidationDebounceMs(currentCode.length));

    return () => {
      window.clearTimeout(timeout);
      if (validationRequestSequenceRef.current === requestSequence) {
        validationRequestSequenceRef.current += 1;
      }
    };
  }, [activeDocumentFlavor, currentCode, t, validationEnabled, xmlValidationTexts]);

  useEffect(() => {
    if (
      !monacoInstance ||
      (activeDocumentFlavor !== 'urdf' &&
        activeDocumentFlavor !== 'xacro' &&
        activeDocumentFlavor !== 'sdf' &&
        activeDocumentFlavor !== 'mjcf')
    ) {
      return undefined;
    }

    const completionItemKind = monacoInstance.languages.CompletionItemKind;
    const completionKindMap = {
      tag: completionItemKind.Keyword,
      attribute: completionItemKind.Property,
      value: completionItemKind.EnumMember,
      snippet: completionItemKind.Snippet,
    } as const;

    const disposable = monacoInstance.languages.registerCompletionItemProvider('xml', {
      triggerCharacters: ['<', ' ', ':', '"'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      provideCompletionItems: async (model: any, position: any) => {
        const textBeforeCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        let entries: Awaited<ReturnType<typeof requestXmlCompletionsWithWorker>>;

        try {
          entries = await requestXmlCompletionsWithWorker(activeDocumentFlavor, textBeforeCursor);
        } catch (error) {
          console.error('XML completion worker request failed:', error);
          return { suggestions: [] };
        }

        if (entries.length === 0) {
          return { suggestions: [] };
        }

        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };

        return {
          suggestions: entries.map((entry) => {
            const resolvedEntry = resolveXmlCompletionEntryForContext(entry, textBeforeCursor);
            return {
              label: resolvedEntry.label,
              kind: completionKindMap[resolvedEntry.kind],
              insertText: resolvedEntry.insertText,
              insertTextRules: resolvedEntry.insertAsSnippet
                ? monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet
                : undefined,
              documentation: resolvedEntry.documentation,
              range,
            };
          }),
        };
      },
    });

    return () => disposable.dispose();
  }, [activeDocumentFlavor, monacoInstance]);

  useEffect(() => {
    if (!monacoInstance || !editorRef.current) {
      return;
    }

    const model = editorRef.current.getModel();
    if (!model) {
      return;
    }

    monacoInstance.editor.setModelLanguage(model, documentMeta.language);
  }, [documentMeta.language, monacoInstance]);

  useEffect(() => {
    if (!monacoInstance || !editorRef.current) {
      return;
    }

    const model = editorRef.current.getModel();
    if (!model) {
      return;
    }

    const markers = validationEnabled
      ? validationErrors.map((error) => ({
          severity: monacoInstance.MarkerSeverity.Error,
          startLineNumber: error.line,
          startColumn: error.column || 1,
          endLineNumber: error.endLine || error.line,
          endColumn: error.endColumn || error.column || 1,
          message: error.message,
          source: 'XML Validator',
        }))
      : [];

    monacoInstance.editor.setModelMarkers(model, 'urdf-validator', markers);
  }, [monacoInstance, validationEnabled, validationErrors]);

  const handleApply = useCallback(
    async (trigger: 'manual' | 'auto' = 'manual') => {
      if (isReadOnly || !editorRef.current || isApplying) {
        return false;
      }

      const value = editorRef.current.getValue();
      if (validationEnabled) {
        void requestXmlValidationWithWorker(value, activeDocumentFlavor, xmlValidationTexts)
          .then((nextErrors) => {
            startTransition(() => {
              setValidationErrors(nextErrors);
            });
          })
          .catch((error) => {
            console.error('XML validation worker request failed during apply:', error);
            startTransition(() => {
              setValidationErrors(toWorkerValidationError(error, t));
            });
          });
      }

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
      activeDocumentFlavor,
      isApplying,
      isReadOnly,
      t,
      validationEnabled,
      xmlValidationTexts,
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

    const editor = editorRef.current as MonacoEditorLike;
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

        const modelWithEdits = model as MonacoTextModelLike & {
          applyEdits?: (edits: Array<{ range: unknown; text: string }>) => void;
          getPositionAt?: (offset: number) => { lineNumber: number; column: number };
        };
        const start = modelWithEdits.getPositionAt?.(offset);
        const end = modelWithEdits.getPositionAt?.(offset + fromText.length);
        if (!start || !end || typeof modelWithEdits.applyEdits !== 'function') {
          return { ok: false, error: 'source editor edit API is unavailable' };
        }

        modelWithEdits.applyEdits([
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
    (editor: unknown, monaco: MonacoInstance) => {
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

      const model = (editor as MonacoEditorLike).getModel?.();
      contentChangeDisposableRef.current =
        model?.onDidChangeContent?.((event) => {
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

      const domNode = (editor as { getDomNode?: () => HTMLElement | null }).getDomNode?.();
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

  return (
    <DraggableWindow
      window={windowState}
      onClose={onClose}
      title={
        <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden">
          <Code className="h-4 w-4 shrink-0 text-system-blue" />
          <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight">
            <span
              className={`min-w-0 truncate font-mono ${FLOATING_WINDOW_TITLE_CLASS}`}
              title={activeDocumentPath}
            >
              {activeDocumentLabel}
            </span>
            {normalizedDocuments.length > 1 && shouldShowActiveDocumentPath ? (
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
      }
      headerActions={
        <div className="flex items-center gap-1">
          {!isReadOnly ? (
            <Tooltip content={t.sourceCodeSaveTooltip} side="bottom">
              <button
                onClick={() => {
                  void handleApply('manual');
                }}
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
              onClick={handleDownload}
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
              onClick={handleCopy}
              className={`${HEADER_ACTION_CLASS} ${
                copied ? 'bg-element-hover text-system-blue' : ''
              }`}
              type="button"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? t.sourceCodeCopied : t.sourceCodeCopy}</span>
            </button>
          </Tooltip>
        </div>
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
      {normalizedDocuments.length > 1 ? (
        shouldUseDocumentSelector ? (
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
                void handleDocumentSwitch(event.currentTarget.value);
              }}
            />
            <span className="shrink-0 text-[10px] font-medium text-text-tertiary">
              {normalizedDocuments.length} {t.sourceCodeFiles}
            </span>
          </div>
        ) : (
          <div className="source-code-editor-chrome custom-scrollbar flex h-10 shrink-0 items-stretch overflow-x-auto border-b border-border-black select-none">
            <div
              aria-label={t.sourceCodeSelectFile}
              className={SOURCE_CODE_EDITOR_TABS_CLASS}
              role="tablist"
            >
              {normalizedDocuments.map((document) => {
                const isActiveDocument = document.id === activeDocument.id;
                return (
                  <button
                    key={document.id}
                    aria-selected={isActiveDocument}
                    className={getSourceCodeEditorTabClassName(isActiveDocument)}
                    onClick={() => {
                      void handleDocumentSwitch(document.id);
                    }}
                    role="tab"
                    title={document.filePath ?? document.fileName}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className={getSourceCodeEditorTabAccentClassName(isActiveDocument)}
                    />
                    <span className="max-w-44 truncate">
                      {document.tabLabel ?? document.fileName}
                    </span>
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
        )
      ) : null}

      <div className="relative flex-1 overflow-hidden">
        {!isEditorReady ? (
          <div className="source-code-editor-panel absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
              <span>{t.sourceCodeLoading}</span>
            </div>
          </div>
        ) : null}
        {isEditorReady && isActiveDocumentContentLoading ? (
          <div className="source-code-editor-overlay absolute inset-0 z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
              <span>{t.sourceCodeLoading}</span>
            </div>
          </div>
        ) : null}

        <MonacoEditor
          key={activeDocument.id}
          height="100%"
          defaultLanguage={documentMeta.language}
          defaultValue={activeDocumentCode}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          onMount={handleEditorMount}
          onChange={handleEditorChange}
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

      <div className="source-code-editor-chrome flex h-7 shrink-0 items-center justify-between gap-3 border-t border-border-black px-3 text-[10px] select-none">
        <div className="flex min-w-0 items-center gap-3">
          {validationEnabled ? (
            validationErrors.length > 0 ? (
              <Tooltip content={t.sourceCodeJumpToProblem} side="bottom">
                <button
                  className="flex items-center gap-1.5 text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-400"
                  onClick={() => {
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
                  }}
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
              <span>
                {isReadOnly ? t.sourceCodeReadOnlyView : t.sourceCodeNoStructuralValidation}
              </span>
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
              <div
                className="flex min-w-0 items-center gap-1.5 text-danger"
                title={applyErrorMessage}
              >
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
    </DraggableWindow>
  );
};
