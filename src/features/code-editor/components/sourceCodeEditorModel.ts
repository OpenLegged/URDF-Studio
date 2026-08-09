import type { CodeEditorFontFamily } from '@/store';
import type { Language } from '@/store';
import type { Theme } from '@/types';
import type { TranslationKeys } from '@/shared/i18n';
import type { SourceCodeDocumentFlavor } from '../types';
import type { SourceCodeEditorApplyRequest } from '../utils/sourceCodeEditorSession';
import {
  getDocumentLanguageId,
  isXmlLikeDocumentFlavor,
  supportsDocumentValidation,
} from '../utils/xmlLanguageSupport';

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

export interface ActiveSourceCodeDocument {
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

export interface SourceCodeDocumentMeta {
  language: ReturnType<typeof getDocumentLanguageId>;
  label: string;
  supportsValidation: boolean;
  isXmlLike: boolean;
}

const getCodeDocumentLabel = (fileName: string): string => {
  const normalizedFileName = fileName.replace(/\\/g, '/');
  const segments = normalizedFileName.split('/');
  return segments[segments.length - 1] || normalizedFileName;
};

export const normalizeSourceCodeDocuments = ({
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

export const resolveCodeEditorFontFamily = (fontFamily: CodeEditorFontFamily): string => {
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

export const formatSourceCodeContentSize = (content: string): string => {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
};

export const formatCodeEditorOpacityPercent = (opacity: number): string =>
  `${Math.round(opacity * 100)}%`;

export const getSourceCodeDocumentMeta = (
  documentFlavor: SourceCodeDocumentFlavor,
  t: TranslationKeys,
): SourceCodeDocumentMeta => {
  const language = getDocumentLanguageId(documentFlavor);
  const metadata = {
    language,
    supportsValidation: supportsDocumentValidation(documentFlavor),
    isXmlLike: isXmlLikeDocumentFlavor(documentFlavor),
  };

  switch (documentFlavor) {
    case 'mjcf':
      return { ...metadata, label: t.sourceCodeMjcfLabel };
    case 'sdf':
      return { ...metadata, label: t.sourceCodeSdfLabel };
    case 'usd':
      return { ...metadata, label: t.sourceCodeUsdLabel };
    case 'equivalent-mjcf':
      return { ...metadata, label: t.sourceCodeEquivalentMjcfLabel };
    case 'xacro':
      return { ...metadata, label: t.sourceCodeXacroLabel };
    case 'urdf':
    default:
      return { ...metadata, label: t.sourceCodeUrdfLabel };
  }
};
