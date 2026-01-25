/**
 * SourceCodeViewer - Read-only code viewer with syntax highlighting
 * Features: syntax highlighting, copy to clipboard, download
 */
import React, { useState } from 'react';
import { X, Copy, Check, FileCode, Download } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { Theme } from '@/types';
import type { Language } from '@/store';

// i18n texts for viewer
const viewerTexts = {
  en: {
    copy: 'Copy',
    copied: 'Copied',
    copyToClipboard: 'Copy to Clipboard',
  },
  zh: {
    copy: '复制',
    copied: '已复制',
    copyToClipboard: '复制到剪贴板',
  }
};

export interface SourceCodeViewerProps {
  code: string;
  onClose: () => void;
  theme: Theme;
  fileName?: string;
  lang?: Language;
}

export const SourceCodeViewer: React.FC<SourceCodeViewerProps> = ({
  code,
  onClose,
  theme,
  fileName = 'robot.urdf',
  lang = 'en'
}) => {
  const [copied, setCopied] = useState(false);
  const t = viewerTexts[lang];

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl h-[80vh] bg-white dark:bg-[#1e1e1e] rounded-lg shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700 animate-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-[#333333] bg-slate-50 dark:bg-[#252526]">
          <div className="flex items-center gap-2">
            <FileCode className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span className="font-mono text-sm font-bold text-slate-700 dark:text-slate-200">{fileName}</span>
            <span className="text-xs text-slate-400 dark:text-slate-500 ml-2">({(code.length / 1024).toFixed(1)} KB)</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#333333] rounded transition-colors"
              title="Download File"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Download</span>
            </button>

            <button
              onClick={handleCopy}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                copied
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#333333]'
              }`}
              title={t.copyToClipboard}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">{copied ? t.copied : t.copy}</span>
            </button>

            <div className="w-px h-4 bg-slate-300 dark:bg-[#444444] mx-1" />

            <button
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-red-500 dark:text-slate-400 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Editor Content */}
        <div className="flex-1 overflow-hidden relative group">
          <SyntaxHighlighter
            language="xml"
            style={theme === 'dark' ? vscDarkPlus : vs}
            showLineNumbers={true}
            wrapLines={true}
            customStyle={{
              margin: 0,
              padding: '1.5rem',
              height: '100%',
              fontSize: '13px',
              lineHeight: '1.5',
              backgroundColor: theme === 'dark' ? '#1e1e1e' : '#ffffff',
            }}
            codeTagProps={{
                style: { fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace" }
            }}
          >
            {code}
          </SyntaxHighlighter>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 bg-slate-50 dark:bg-blue-600 border-t border-slate-200 dark:border-blue-700 flex justify-between items-center">
             <div className="text-[10px] text-slate-500 dark:text-blue-100">
                 Read-only View
             </div>
             <div className="text-[10px] text-slate-500 dark:text-blue-100 font-mono">
                 XML / URDF
             </div>
        </div>
      </div>
    </div>
  );
};
