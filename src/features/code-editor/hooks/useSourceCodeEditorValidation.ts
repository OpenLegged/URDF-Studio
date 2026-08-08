import { startTransition, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type * as Monaco from 'monaco-editor';
import type { TranslationKeys } from '@/shared/i18n';
import type { SourceCodeDocumentFlavor, SourceCodeEditorLanguageId } from '../types';
import { getUrdfValidationDebounceMs } from '../utils/editorPerformance';
import type { MonacoInstance } from '../utils/monacoLoader';
import type { XmlDocumentValidationTexts } from '../utils/xmlDocumentValidation';
import {
  requestXmlCompletionsWithWorker,
  requestXmlValidationWithWorker,
} from '../utils/xmlEditorWorkerBridge';
import { resolveXmlCompletionEntryForContext } from '../utils/xmlLanguageSupport';
import type { ValidationError } from '../utils/urdfValidation';

interface UseSourceCodeEditorValidationOptions {
  currentCode: string;
  documentFlavor: SourceCodeDocumentFlavor;
  documentLanguage: SourceCodeEditorLanguageId;
  editorRef: RefObject<Monaco.editor.IStandaloneCodeEditor | null>;
  monacoInstance: MonacoInstance | null;
  t: TranslationKeys;
  validationEnabled: boolean;
  validationTexts: XmlDocumentValidationTexts;
}

const toWorkerValidationError = (
  error: unknown,
  t: TranslationKeys,
): ValidationError[] => [
  {
    line: 1,
    column: 1,
    message: `${t.sourceCodeCannotParseXml}: ${error instanceof Error ? error.message : String(error)}`,
  },
];

export function useSourceCodeEditorValidation({
  currentCode,
  documentFlavor,
  documentLanguage,
  editorRef,
  monacoInstance,
  t,
  validationEnabled,
  validationTexts,
}: UseSourceCodeEditorValidationOptions) {
  const [isValidationPending, setIsValidationPending] = useState(validationEnabled);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const validationRequestSequenceRef = useRef(0);

  useEffect(() => {
    return () => {
      validationRequestSequenceRef.current += 1;
    };
  }, []);

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
      void requestXmlValidationWithWorker(currentCode, documentFlavor, validationTexts)
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
  }, [currentCode, documentFlavor, t, validationEnabled, validationTexts]);

  useEffect(() => {
    if (
      !monacoInstance ||
      (documentFlavor !== 'urdf' &&
        documentFlavor !== 'xacro' &&
        documentFlavor !== 'sdf' &&
        documentFlavor !== 'mjcf')
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
      provideCompletionItems: async (model, position) => {
        const textBeforeCursor = model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        let entries: Awaited<ReturnType<typeof requestXmlCompletionsWithWorker>>;

        try {
          entries = await requestXmlCompletionsWithWorker(documentFlavor, textBeforeCursor);
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
  }, [documentFlavor, monacoInstance]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!monacoInstance || !model) {
      return;
    }

    monacoInstance.editor.setModelLanguage(model, documentLanguage);
  }, [documentLanguage, editorRef, monacoInstance]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!monacoInstance || !model) {
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
  }, [editorRef, monacoInstance, validationEnabled, validationErrors]);

  const resetValidation = useCallback(() => {
    validationRequestSequenceRef.current += 1;
    setValidationErrors([]);
    setIsValidationPending(validationEnabled);
  }, [validationEnabled]);

  const validateImmediately = useCallback(
    (value: string) => {
      if (!validationEnabled) {
        return;
      }

      void requestXmlValidationWithWorker(value, documentFlavor, validationTexts)
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
    },
    [documentFlavor, t, validationEnabled, validationTexts],
  );

  return {
    isValidationPending,
    resetValidation,
    validateImmediately,
    validationErrors,
  };
}
