/**
 * SourceCodeEditor - Monaco-based URDF/XML code editor
 * Features: syntax highlighting, URDF validation, auto-completion, resizable window
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { loader } from '@monaco-editor/react';
import { X, Save, Code, Loader2, Maximize, Minimize, AlertCircle, CheckCircle } from 'lucide-react';
import type { Theme } from '@/types';
import type { Language } from '@/store';

// Configure Monaco to use local resources instead of CDN
loader.config({
  paths: {
    vs: '/monaco-editor/min/vs'
  }
});

export interface SourceCodeEditorProps {
  code: string;
  onCodeChange: (newCode: string) => void;
  onClose: () => void;
  theme: Theme;
  fileName?: string;
  lang?: Language;
}

interface ValidationError {
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  message: string;
}

// i18n texts for source code editor
const editorTexts = {
  en: {
    save: 'Save',
    saveTooltip: 'Save (Ctrl+S)',
    modified: 'Modified',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
    maximized: 'Maximized',
    noErrors: 'No errors',
    problems: 'problems',
    loading: 'Loading...',
    // Validation messages
    xmlParseError: 'XML parsing error',
    missingRobotRoot: 'Missing <robot> root element',
    robotMissingName: '<robot> element missing name attribute',
    linkMissingName: 'Link #{0} missing name attribute',
    jointMissingName: 'Joint #{0} missing name attribute',
    jointMissingType: 'Joint "{0}" missing type attribute',
    jointMissingParent: 'Joint "{0}" missing <parent> element',
    jointMissingChild: 'Joint "{0}" missing <child> element',
    cannotParseXml: 'Cannot parse XML',
  },
  zh: {
    save: '保存',
    saveTooltip: '保存 (Ctrl+S)',
    modified: '已修改',
    maximize: '最大化',
    restore: '还原',
    close: '关闭',
    maximized: '最大化',
    noErrors: '无错误',
    problems: '个问题',
    loading: '加载中...',
    // Validation messages
    xmlParseError: 'XML 解析错误',
    missingRobotRoot: '缺少 <robot> 根元素',
    robotMissingName: '<robot> 元素缺少 name 属性',
    linkMissingName: '第 {0} 个 <link> 缺少 name 属性',
    jointMissingName: '第 {0} 个 <joint> 缺少 name 属性',
    jointMissingType: '关节 "{0}" 缺少 type 属性',
    jointMissingParent: '关节 "{0}" 缺少 <parent> 元素',
    jointMissingChild: '关节 "{0}" 缺少 <child> 元素',
    cannotParseXml: '无法解析 XML',
  }
};

// Helper to format message with parameters
const formatMsg = (msg: string, ...args: (string | number)[]): string => {
  let result = msg;
  args.forEach((arg, i) => {
    result = result.replace(`{${i}}`, String(arg));
  });
  return result;
};

const URDF_TAGS = [
  'robot', 'link', 'joint', 'type', 'name',
  'visual', 'geometry', 'box', 'cylinder', 'sphere', 'mesh',
  'collision', 'inertial', 'mass', 'inertia',
  'origin', 'xyz', 'rpy',
  'parent', 'child', 'axis', 'limit', 'lower', 'upper', 'effort', 'velocity',
  'dynamics', 'damping', 'friction',
  'material', 'color', 'texture', 'rgba'
];

const URDF_SNIPPETS = {
  link: '<link name="${1:link_name}">\n\t<visual>\n\t\t<geometry>\n\t\t\t<box size="${2:0.1 0.1 0.1}"/>\n\t\t</geometry>\n\t</visual>\n</link>',
  joint: '<joint name="${1:joint_name}" type="${2:revolute}">\n\t<parent link="${3:parent_link}"/>\n\t<child link="${4:child_link}"/>\n\t<origin xyz="0 0 0" rpy="0 0 0"/>\n\t<axis xyz="0 0 1"/>\n\t<limit lower="-1.57" upper="1.57" effort="100" velocity="1"/>\n</joint>'
};

const MIN_WIDTH = 400;
const MIN_HEIGHT = 300;

// Find line number of an element in XML string
const findElementLine = (xmlString: string, tagName: string, index: number): number => {
  const lines = xmlString.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const regex = new RegExp(`<${tagName}[\\s>]`, 'g');
    const matches = lines[i].match(regex);
    if (matches) {
      count += matches.length;
      if (count > index) {
        return i + 1; // 1-indexed
      }
    }
  }
  return 1;
};

// Validate URDF XML structure
const validateURDF = (xmlString: string, t: typeof editorTexts['en']): ValidationError[] => {
  const errors: ValidationError[] = [];

  // Check for basic XML validity
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      const errorText = parseError.textContent || 'XML parsing error';
      // Try to extract line number from error message
      const lineMatch = errorText.match(/line\s*(\d+)/i);
      const line = lineMatch ? parseInt(lineMatch[1]) : 1;
      const colMatch = errorText.match(/column\s*(\d+)/i);
      const column = colMatch ? parseInt(colMatch[1]) : 1;
      errors.push({ line, column, message: t.xmlParseError + ': ' + errorText.split('\n')[0].substring(0, 100) });
      return errors;
    }

    // Check for robot root element
    const robot = doc.querySelector('robot');
    if (!robot) {
      errors.push({ line: 1, column: 1, message: t.missingRobotRoot });
      return errors;
    }

    // Check robot name
    if (!robot.getAttribute('name')) {
      const line = findElementLine(xmlString, 'robot', 0);
      errors.push({ line, column: 1, message: t.robotMissingName });
    }

    // Check links have names
    const links = doc.querySelectorAll('link');
    links.forEach((link, idx) => {
      if (!link.getAttribute('name')) {
        const line = findElementLine(xmlString, 'link', idx);
        errors.push({ line, column: 1, message: formatMsg(t.linkMissingName, idx + 1) });
      }
    });

    // Check joints have required attributes
    const joints = doc.querySelectorAll('joint');
    joints.forEach((joint, idx) => {
      const name = joint.getAttribute('name');
      const type = joint.getAttribute('type');
      const line = findElementLine(xmlString, 'joint', idx);

      if (!name) {
        errors.push({ line, column: 1, message: formatMsg(t.jointMissingName, idx + 1) });
      }
      if (!type) {
        errors.push({ line, column: 1, message: formatMsg(t.jointMissingType, name || String(idx + 1)) });
      }
      if (!joint.querySelector('parent')) {
        errors.push({ line, column: 1, message: formatMsg(t.jointMissingParent, name || String(idx + 1)) });
      }
      if (!joint.querySelector('child')) {
        errors.push({ line, column: 1, message: formatMsg(t.jointMissingChild, name || String(idx + 1)) });
      }
    });

  } catch (e) {
    errors.push({ line: 1, column: 1, message: t.cannotParseXml });
  }

  return errors;
};

export const SourceCodeEditor: React.FC<SourceCodeEditorProps> = ({
  code,
  onCodeChange,
  onClose,
  theme,
  fileName = 'robot.urdf',
  lang = 'en'
}) => {
  const t = editorTexts[lang];
  const [isDirty, setIsDirty] = useState(false);
  const [isEditorReady, setIsEditorReady] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [currentCode, setCurrentCode] = useState(code);

  // Sync editor content when code prop changes (e.g., different file selected)
  useEffect(() => {
    if (editorRef.current && code !== currentCode && !isDirty) {
      editorRef.current.setValue(code);
      setCurrentCode(code);
      setValidationErrors(validateURDF(code, t));
    }
  }, [code]);

  // Window State
  const [isMaximized, setIsMaximized] = useState(false);
  const [rect, setRect] = useState({ x: 100, y: 100, width: 800, height: 600 });
  const [preMaximizeRect, setPreMaximizeRect] = useState({ x: 100, y: 100, width: 800, height: 600 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [monacoInstance, setMonacoInstance] = useState<any>(null);

  // Interaction Refs
  const dragStartRef = useRef({ x: 0, y: 0, initialRect: { ...rect } });
  const isDraggingRef = useRef(false);
  const resizeDirectionRef = useRef('');

  // Initialize Monaco (avoid unhandled cancellation errors)
  useEffect(() => {
    let isMounted = true;
    loader
      .init()
      .then((monaco) => {
        if (isMounted) {
          setMonacoInstance(monaco);
        }
      })
      .catch((error) => {
        if (error?.type !== 'cancelation') {
          console.error('Monaco init failed:', error);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Setup URDF completion
  useEffect(() => {
    if (monacoInstance) {
      const disposable = monacoInstance.languages.registerCompletionItemProvider('xml', {
        triggerCharacters: ['<'],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions = [
            ...URDF_TAGS.map(tag => ({
              label: tag,
              kind: monacoInstance.languages.CompletionItemKind.Keyword,
              insertText: tag,
              range,
            })),
            {
              label: 'link-snippet',
              kind: monacoInstance.languages.CompletionItemKind.Snippet,
              insertText: URDF_SNIPPETS.link,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Basic URDF Link structure',
              range,
            },
            {
              label: 'joint-snippet',
              kind: monacoInstance.languages.CompletionItemKind.Snippet,
              insertText: URDF_SNIPPETS.joint,
              insertTextRules: monacoInstance.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Basic URDF Joint structure',
              range,
            }
          ];

          return { suggestions };
        }
      });

      return () => disposable.dispose();
    }
  }, [monacoInstance]);

  // Update Monaco markers when validation errors change
  useEffect(() => {
    if (monacoInstance && editorRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const markers = validationErrors.map(err => ({
          severity: monacoInstance.MarkerSeverity.Error,
          startLineNumber: err.line,
          startColumn: err.column || 1,
          endLineNumber: err.endLine || err.line,
          endColumn: err.endColumn || err.column || 1,
          message: err.message,
          source: 'URDF Validator'
        }));
        monacoInstance.editor.setModelMarkers(model, 'urdf-validator', markers);
      }
    }
  }, [monacoInstance, validationErrors]);

  // Handle Dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return; // Ignore drag if maximized
    if ((e.target as HTMLElement).closest('button')) return; // Ignore buttons

    e.preventDefault();
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialRect: { ...rect }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

      let newX = dragStartRef.current.initialRect.x + dx;
      let newY = dragStartRef.current.initialRect.y + dy;

      // Constrain to viewport bounds - all four sides
      const { width } = dragStartRef.current.initialRect;
      const minVisible = 100; // Keep at least 100px visible on each side
      const minX = -width + minVisible;
      const maxX = window.innerWidth - minVisible;
      const minY = 0;
      const maxY = window.innerHeight - 50;
      newX = Math.max(minX, Math.min(maxX, newX));
      newY = Math.max(minY, Math.min(maxY, newY));

      if (containerRef.current) {
        containerRef.current.style.transform = `translate(${newX}px, ${newY}px)`;
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;

        let newX = dragStartRef.current.initialRect.x + dx;
        let newY = dragStartRef.current.initialRect.y + dy;

        // Constrain to viewport bounds - all four sides
        const { width } = dragStartRef.current.initialRect;
        const minVisible = 100;
        const minX = -width + minVisible;
        const maxX = window.innerWidth - minVisible;
        const minY = 0;
        const maxY = window.innerHeight - 50;
        newX = Math.max(minX, Math.min(maxX, newX));
        newY = Math.max(minY, Math.min(maxY, newY));

        setRect(prev => ({
          ...prev,
          x: newX,
          y: newY
        }));
      }
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [rect, isMaximized]);

  // Handle Resizing - supports 'e' (east/right), 's' (south/bottom), 'se' (corner)
  const handleResizeStart = useCallback((direction: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeDirectionRef.current = direction;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialRect: { ...rect }
    };

    // Set cursor based on direction
    const cursorMap: Record<string, string> = { e: 'ew-resize', s: 'ns-resize', se: 'nwse-resize' };
    const cursor = cursorMap[direction] || 'nwse-resize';

    // Add overlay to prevent iframe interaction
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:${cursor};`;
    document.body.appendChild(overlay);

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeDirectionRef.current || !containerRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      const { width, height } = dragStartRef.current.initialRect;
      const dir = resizeDirectionRef.current;

      // Calculate new dimensions based on direction
      const newWidth = dir.includes('e') ? Math.max(MIN_WIDTH, width + dx) : width;
      const newHeight = dir.includes('s') ? Math.max(MIN_HEIGHT, height + dy) : height;

      containerRef.current.style.width = `${newWidth}px`;
      containerRef.current.style.height = `${newHeight}px`;

      // Request layout update for smooth resizing
      requestAnimationFrame(() => editorRef.current?.layout());
    };

    const handleMouseUp = (e: MouseEvent) => {
      if (resizeDirectionRef.current) {
        const dx = e.clientX - dragStartRef.current.x;
        const dy = e.clientY - dragStartRef.current.y;
        const { width, height } = dragStartRef.current.initialRect;
        const dir = resizeDirectionRef.current;

        setRect(prev => ({
          ...prev,
          width: dir.includes('e') ? Math.max(MIN_WIDTH, width + dx) : prev.width,
          height: dir.includes('s') ? Math.max(MIN_HEIGHT, height + dy) : prev.height
        }));
      }
      resizeDirectionRef.current = '';
      document.body.removeChild(overlay);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Final layout update
      setTimeout(() => editorRef.current?.layout(), 50);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [rect]);

  const toggleMaximize = () => {
    if (isMaximized) {
      setRect(preMaximizeRect);
      // Restore style
      if (containerRef.current) {
        containerRef.current.style.width = `${preMaximizeRect.width}px`;
        containerRef.current.style.height = `${preMaximizeRect.height}px`;
        containerRef.current.style.transform = `translate(${preMaximizeRect.x}px, ${preMaximizeRect.y}px)`;
        containerRef.current.style.top = '0';
        containerRef.current.style.left = '0';
      }
    } else {
      setPreMaximizeRect(rect);
    }
    setIsMaximized(!isMaximized);
    // Layout update after transition
    setTimeout(() => editorRef.current?.layout(), 100);
  };

  const handleApply = useCallback(() => {
    if (editorRef.current) {
      const value = editorRef.current.getValue();
      // Validate before applying
      const errors = validateURDF(value, t);
      if (errors.length > 0) {
        // Still allow saving but show warning
        setValidationErrors(errors);
      }
      onCodeChange(value);
      setIsDirty(false);
    }
  }, [onCodeChange, t]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setCurrentCode(value);
      setIsDirty(value !== code);
      // Debounced validation
      const errors = validateURDF(value, t);
      setValidationErrors(errors);
    }
  }, [code, t]);

  // Ctrl+S handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty) {
          handleApply();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDirty, handleApply]);

  return (
    <div
      ref={containerRef}
      className={`fixed z-50 flex flex-col bg-white dark:bg-panel-bg rounded-lg shadow-2xl border border-slate-300 dark:border-border-black overflow-hidden ${isMaximized ? 'inset-0 !transform-none !w-full !h-full rounded-none' : ''}`}
      style={!isMaximized ? {
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.x}px, ${rect.y}px)`,
        top: 0,
        left: 0,
      } : undefined}
    >
      {/* Header */}
      <div
        className={`h-10 bg-slate-100 dark:bg-element-active border-b border-slate-200 dark:border-border-black flex items-center justify-between px-3 select-none ${isMaximized ? '' : 'cursor-move'}`}
        onMouseDown={handleMouseDown}
        onDoubleClick={toggleMaximize}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 opacity-80">
            <Code className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="font-semibold text-xs text-slate-700 dark:text-slate-200 font-mono tracking-tight">{fileName}</span>
          </div>
          {isDirty && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-[9px] font-bold text-amber-600 dark:text-amber-400 rounded uppercase tracking-wider">
              {t.modified}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
          <button
            onClick={handleApply}
            disabled={!isDirty}
            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wide rounded transition-all mr-2 ${isDirty
              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
              : 'text-slate-400 bg-transparent cursor-not-allowed'
            }`}
            title={t.saveTooltip}
          >
            <Save className="w-3 h-3" />
            <span>{t.save}</span>
          </button>

          <button
            onClick={toggleMaximize}
            className="p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-element-hover rounded transition-colors"
            title={isMaximized ? t.restore : t.maximize}
          >
            {isMaximized ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:bg-red-500 hover:text-white dark:text-slate-400 dark:hover:bg-red-600 dark:hover:text-white rounded transition-colors"
            title={t.close}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 overflow-hidden relative">
        {!isEditorReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-panel-bg z-10">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        )}
        <Editor
          height="100%"
          defaultLanguage="xml"
          defaultValue={code}
          theme={theme === 'dark' ? 'vs-dark' : 'light'}
          onMount={(editor) => {
            editorRef.current = editor;
            setIsEditorReady(true);
            // Force layout after mount to fix initial blank screen
            requestAnimationFrame(() => {
              editor.layout();
            });
          }}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: false, // Performance optimization
            tabSize: 2,
            formatOnPaste: true,
            formatOnType: true,
            lineNumbersMinChars: 3,
            padding: { top: 8, bottom: 8 },
            renderLineHighlight: 'all',
          }}
        />
      </div>

      {/* Status Bar */}
      <div className="h-7 bg-slate-50 dark:bg-element-active border-t border-slate-200 dark:border-border-black flex items-center px-3 justify-between shrink-0 text-[10px] select-none">
        <div className="flex items-center gap-3">
          {validationErrors.length > 0 ? (
            <button
              className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
              onClick={() => {
                // Jump to first error line
                if (editorRef.current && validationErrors[0]) {
                  editorRef.current.revealLineInCenter(validationErrors[0].line);
                  editorRef.current.setPosition({ lineNumber: validationErrors[0].line, column: 1 });
                  editorRef.current.focus();
                }
              }}
              title={validationErrors.map(e => `Line ${e.line}: ${e.message}`).join('\n')}
            >
              <AlertCircle className="w-3 h-3" />
              <span>{validationErrors.length} {t.problems}</span>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
              <CheckCircle className="w-3 h-3" />
              <span>{t.noErrors}</span>
            </div>
          )}
          <div className="w-px h-3 bg-slate-300 dark:bg-slate-600" />
          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <span>URDF/XML</span>
          </div>
        </div>
        <div className="text-slate-400 dark:text-slate-500 font-mono">
          {isMaximized ? t.maximized : `${Math.round(rect.width)} × ${Math.round(rect.height)}`}
        </div>
      </div>

      {/* Resize Handles (Only when not maximized) */}
      {!isMaximized && (
        <>
          {/* Right edge */}
          <div
            className="absolute top-10 right-0 w-1.5 bottom-7 cursor-ew-resize z-40 hover:bg-blue-500/30 transition-colors"
            onMouseDown={handleResizeStart('e')}
          />
          {/* Bottom edge */}
          <div
            className="absolute bottom-0 left-0 h-1.5 right-0 cursor-ns-resize z-40 hover:bg-blue-500/30 transition-colors"
            onMouseDown={handleResizeStart('s')}
          />
          {/* Bottom-right corner */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-50 hover:bg-blue-500/40 transition-colors"
            onMouseDown={handleResizeStart('se')}
          />
        </>
      )}
    </div>
  );
};
