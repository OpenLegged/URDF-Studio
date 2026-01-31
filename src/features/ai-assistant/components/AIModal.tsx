/**
 * AI Assistant Modal Component
 * Provides AI-powered robot inspection and generation interface
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  ScanSearch, X, Move, Loader2, ChevronDown, ChevronRight,
  Check, ArrowRight, Sparkles, Box, MessageCircle, Send,
  AlertTriangle, Info, AlertCircle, RefreshCw, FileText,
  Minimize2, Maximize2, Minus, LayoutGrid, Search, Download, Star, Clock, Globe
} from 'lucide-react';
import { createRoot } from 'react-dom/client';
import type { RobotState, MotorSpec, InspectionReport } from '@/types';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { generateRobotFromPrompt, runRobotInspection, INSPECTION_CRITERIA } from '../index';
import { InspectionReportTemplate } from '@/features/file-io/components/InspectionReportTemplate';

interface AIModalProps {
  isOpen: boolean;
  onClose: () => void;
  robot: RobotState;
  motorLibrary: Record<string, MotorSpec[]>;
  lang: Language;
  onApplyChanges: (data: { name?: string; links?: any; joints?: any; rootLinkId?: string }) => void;
  onSelectItem: (type: 'link' | 'joint', id: string) => void;
}

export function AIModal({
  isOpen,
  onClose,
  robot,
  motorLibrary,
  lang,
  onApplyChanges,
  onSelectItem,
}: AIModalProps) {
  const t = translations[lang];

  // Window state
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 100, y: 100 });
  const [dragTransform, setDragTransform] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ width: 900, height: 650 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Resize state
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDirection, setResizeDirection] = useState<'right' | 'bottom' | 'corner' | null>(null);
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Center the window on mount
  useEffect(() => {
    if (isOpen) {
      const centerX = (window.innerWidth - size.width) / 2;
      const centerY = (window.innerHeight - size.height) / 2;
      setPosition({ x: Math.max(0, centerX), y: Math.max(0, centerY) });
    }
  }, [isOpen]);

  // Handle mouse down on header for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isMaximized) return;
    setIsDragging(true);
    setDragOffset({
      x: e.clientX,
      y: e.clientY
    });
    setDragTransform({ x: 0, y: 0 });
  }, [isMaximized]);

  // Handle mouse move for dragging - use transform for smoother performance
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragOffset.x;
      const deltaY = e.clientY - dragOffset.y;
      setDragTransform({ x: deltaX, y: deltaY });
    };

    const handleMouseUp = () => {
      if (isDragging && (dragTransform.x !== 0 || dragTransform.y !== 0)) {
        // Commit the drag position
        setPosition(prev => ({
          x: Math.max(0, Math.min(window.innerWidth - size.width, prev.x + dragTransform.x)),
          y: Math.max(0, Math.min(window.innerHeight - 48, prev.y + dragTransform.y))
        }));
        setDragTransform({ x: 0, y: 0 });
      }
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, dragTransform, size.width, size.height]);

  // Handle resize start
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: 'right' | 'bottom' | 'corner') => {
    if (isMaximized || isMinimized) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    setResizeDirection(direction);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height
    };
  }, [isMaximized, isMinimized, size]);

  // Handle mouse move for resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing || !resizeDirection) return;
      
      const deltaX = e.clientX - resizeStartRef.current.x;
      const deltaY = e.clientY - resizeStartRef.current.y;
      const minWidth = 600;
      const minHeight = 400;
      const maxWidth = window.innerWidth - position.x;
      const maxHeight = window.innerHeight - position.y;
      
      if (resizeDirection === 'right' || resizeDirection === 'corner') {
        const newWidth = Math.max(minWidth, Math.min(maxWidth, resizeStartRef.current.width + deltaX));
        setSize(prev => ({ ...prev, width: newWidth }));
      }
      
      if (resizeDirection === 'bottom' || resizeDirection === 'corner') {
        const newHeight = Math.max(minHeight, Math.min(maxHeight, resizeStartRef.current.height + deltaY));
        setSize(prev => ({ ...prev, height: newHeight }));
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setResizeDirection(null);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, resizeDirection, position.x, position.y]);

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
    setIsMinimized(false);
  };

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized);
  };

  // Get window style based on state
  const getWindowStyle = (): React.CSSProperties => {
    if (isMaximized) {
      return {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        height: '100%',
        transform: 'none',
      };
    }
    if (isMinimized) {
      return {
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: size.width,
        height: 48,
        transform: 'none',
      };
    }
    // Use transform for dragging to avoid layout reflow
    return {
      position: 'fixed',
      left: position.x,
      top: position.y,
      width: size.width,
      height: size.height,
      transform: isDragging ? `translate(${dragTransform.x}px, ${dragTransform.y}px)` : 'none',
    };
  };

  // AI states
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiResponse, setAiResponse] = useState<{ explanation: string; type: string; data?: any } | null>(null);
  const [inspectionReport, setInspectionReport] = useState<InspectionReport | null>(null);

  // Category expansion state
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(INSPECTION_CRITERIA.map(c => c.id))
  );

  // Selected inspection items
  const [selectedItems, setSelectedItems] = useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    INSPECTION_CRITERIA.forEach(category => {
      initial[category.id] = new Set(category.items.map(item => item.id));
    });
    return initial;
  });

  // Inspection progress
  const [inspectionProgress, setInspectionProgress] = useState<{
    currentCategory?: string;
    currentItem?: string;
    completed: number;
    total: number;
  } | null>(null);

  // Report generation timer
  const [reportGenerationTimer, setReportGenerationTimer] = useState<number | null>(null);

  // Chat state
  const [isReportChatOpen, setIsReportChatOpen] = useState(false);
  const [reportChatMessages, setReportChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [reportChatInput, setReportChatInput] = useState('');
  const [isChatGenerating, setIsChatGenerating] = useState(false);

  // Single item retest state
  const [retestingItem, setRetestingItem] = useState<{ categoryId: string; itemId: string } | null>(null);

  // Close handler
  const handleClose = useCallback(() => {
    setInspectionProgress(null);
    setReportGenerationTimer(null);
    onClose();
  }, [onClose]);

  // Generate AI response
  const handleGenerateAI = async () => {
    if (!aiPrompt.trim()) return;

    setIsGeneratingAI(true);
    setAiResponse(null);
    setInspectionReport(null);

    try {
      const response = await generateRobotFromPrompt(aiPrompt, robot, motorLibrary);
      if (response) {
        setAiResponse({
          explanation: response.explanation || 'No valid response received',
          type: response.actionType || 'advice',
          data: response.robotData
        });
      } else {
        setAiResponse({
          explanation: 'AI service did not return a response, please try again.',
          type: 'advice',
          data: undefined
        });
      }
    } catch (e: any) {
      console.error("AI Generation Error", e);
      setAiResponse({
        explanation: `Generation failed: ${e?.message || 'Unknown error'}`,
        type: 'advice',
        data: undefined
      });
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // Run inspection
  const handleRunInspection = async () => {
    setIsGeneratingAI(true);
    setAiResponse(null);
    setInspectionReport(null);
    setReportGenerationTimer(null);

    // Calculate total items and list
    let totalItems = 0;
    const selectedItemsList: Array<{ categoryId: string; itemId: string; categoryName: string; itemName: string }> = [];

    Object.keys(selectedItems).forEach(categoryId => {
      const category = INSPECTION_CRITERIA.find(c => c.id === categoryId);
      if (!category) return;
      const categoryName = lang === 'zh' ? category.nameZh : category.name;
      const items = Array.from(selectedItems[categoryId]);
      items.forEach(itemId => {
        const item = category.items.find(i => i.id === itemId);
        if (item) {
          const itemName = lang === 'zh' ? item.nameZh : item.name;
          selectedItemsList.push({ categoryId, itemId, categoryName, itemName });
          totalItems++;
        }
      });
    });

    // Convert selected items to map format
    const selectedItemsMap: Record<string, string[]> = {};
    Object.keys(selectedItems).forEach(categoryId => {
      const items = Array.from(selectedItems[categoryId]);
      if (items.length > 0) {
        selectedItemsMap[categoryId] = items;
      }
    });

    // Initialize progress
    setInspectionProgress({ completed: 0, total: totalItems });

    try {
      let currentIndex = 0;
      let reportReady = false;
      let generatedReport: InspectionReport | null = null;
      let timerInterval: NodeJS.Timeout | null = null;

      const progressInterval = setInterval(() => {
        currentIndex++;
        if (currentIndex <= totalItems) {
          const currentItem = selectedItemsList[currentIndex - 1];
          setInspectionProgress({
            currentCategory: currentItem?.categoryName,
            currentItem: currentItem?.itemName,
            completed: currentIndex,
            total: totalItems
          });
        } else {
          clearInterval(progressInterval);

          setInspectionProgress({
            currentCategory: undefined,
            currentItem: undefined,
            completed: totalItems,
            total: totalItems
          });

          // Start report generation timer
          setReportGenerationTimer(1);
          let timerCount = 1;

          const showReport = () => {
            if (timerInterval) {
              clearInterval(timerInterval);
              timerInterval = null;
            }
            setInspectionProgress(null);
            setReportGenerationTimer(null);
            if (generatedReport) {
              setInspectionReport(generatedReport);
            }
          };

          timerInterval = setInterval(() => {
            timerCount++;
            setReportGenerationTimer(timerCount);

            if (timerCount >= 30) {
              clearInterval(timerInterval!);
              timerInterval = null;
              if (reportReady) {
                showReport();
              } else {
                setReportGenerationTimer(null);
                const checkReport = setInterval(() => {
                  if (reportReady) {
                    clearInterval(checkReport);
                    showReport();
                  }
                }, 100);
              }
            }
          }, 1000);

          // Generate report in background
          runRobotInspection(robot, selectedItemsMap, lang).then(report => {
            generatedReport = report;
            reportReady = true;
            if (timerCount < 30 && timerInterval) {
              clearInterval(timerInterval);
              timerInterval = null;
              showReport();
            } else if (timerCount >= 30) {
              showReport();
            }
          }).catch(e => {
            console.error("Inspection Error", e);
            if (timerInterval) {
              clearInterval(timerInterval);
            }
            setInspectionProgress(null);
            setReportGenerationTimer(null);
          });
        }
      }, 300);
    } catch (e: any) {
      console.error("Inspection Error", e);
      setInspectionProgress(null);
      setReportGenerationTimer(null);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  // Toggle category selection
  const toggleCategorySelection = (categoryId: string) => {
    setSelectedItems(prev => {
      const newItems = { ...prev };
      const category = INSPECTION_CRITERIA.find(c => c.id === categoryId);
      if (!category) return prev;

      const allSelected = category.items.every(item => newItems[categoryId]?.has(item.id));
      if (allSelected) {
        newItems[categoryId] = new Set();
      } else {
        newItems[categoryId] = new Set(category.items.map(item => item.id));
      }
      return newItems;
    });
  };

  // Toggle item selection
  const toggleItemSelection = (categoryId: string, itemId: string) => {
    setSelectedItems(prev => {
      const newItems = { ...prev };
      if (!newItems[categoryId]) {
        newItems[categoryId] = new Set();
      }
      const itemSet = new Set(newItems[categoryId]);
      if (itemSet.has(itemId)) {
        itemSet.delete(itemId);
      } else {
        itemSet.add(itemId);
      }
      newItems[categoryId] = itemSet;
      return newItems;
    });
  };

  // Handle single item retest
  const handleRetestItem = async (categoryId: string, itemId: string) => {
    setRetestingItem({ categoryId, itemId });
    try {
      const selectedItemsMap: Record<string, string[]> = {
        [categoryId]: [itemId]
      };

      const report = await runRobotInspection(robot, selectedItemsMap, lang);
      if (report && inspectionReport) {
        const updatedIssues = inspectionReport.issues.filter(issue =>
          !(issue.category === categoryId && issue.itemId === itemId)
        );
        const newIssues = report.issues.filter(issue =>
          issue.category === categoryId && issue.itemId === itemId
        );
        const allIssues = [...updatedIssues, ...newIssues];

        const categoryScores: Record<string, number> = { ...inspectionReport.categoryScores };
        const categoryIssues = allIssues.filter(i => i.category === categoryId);
        if (categoryIssues.length > 0) {
          const scores = categoryIssues.map(i => i.score ?? 10);
          categoryScores[categoryId] = scores.reduce((a, b) => a + b, 0) / scores.length;
        }

        const allScores = allIssues.map(i => i.score ?? 10);
        const overallScore = allScores.reduce((a, b) => a + b, 0);

        setInspectionReport({
          ...inspectionReport,
          issues: allIssues,
          categoryScores,
          overallScore,
          maxScore: inspectionReport.maxScore || 100
        });
      }
    } catch (e) {
      console.error("Retest Error", e);
    } finally {
      setRetestingItem(null);
    }
  };

  // Handle chat message
  const handleReportChatSend = async () => {
    if (!reportChatInput.trim() || isChatGenerating || !inspectionReport) return;

    const userMessage = reportChatInput.trim();
    setReportChatInput('');
    setReportChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsChatGenerating(true);

    try {
      const contextPrompt = lang === 'zh'
        ? `当前机器人结构：\n${JSON.stringify(robot, null, 2)}\n\n检测报告摘要：\n${inspectionReport.summary}\n\n检测报告中的问题列表：\n${inspectionReport.issues.map(i => `- ${i.title} (${i.type}): ${i.description}`).join('\n')}\n\n用户问题：${userMessage}`
        : `Current robot structure:\n${JSON.stringify(robot, null, 2)}\n\nInspection report summary:\n${inspectionReport.summary}\n\nIssues:\n${inspectionReport.issues.map(i => `- ${i.title} (${i.type}): ${i.description}`).join('\n')}\n\nUser question: ${userMessage}`;

      const response = await generateRobotFromPrompt(contextPrompt, robot, motorLibrary);
      const assistantMessage = response?.explanation || (lang === 'zh' ? '抱歉，无法生成回复。' : 'Sorry, unable to generate response.');
      setReportChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);
    } catch (e) {
      console.error("Chat Error", e);
      setReportChatMessages(prev => [...prev, {
        role: 'assistant',
        content: lang === 'zh' ? '发送消息时出错，请重试。' : 'Error sending message, please try again.'
      }]);
    } finally {
      setIsChatGenerating(false);
    }
  };

  // Apply AI changes
  const applyAIChanges = () => {
    if (aiResponse?.data) {
      const generated = aiResponse.data;
      if (!generated.links || Object.keys(generated.links).length === 0) {
        alert(lang === 'zh' ? '生成的机器人数据中没有链接，无法应用更改。' : 'No links in generated data, cannot apply changes.');
        return;
      }

      onApplyChanges({
        name: generated.name,
        links: generated.links,
        joints: generated.joints,
        rootLinkId: generated.rootLinkId
      });

      handleClose();
      setAiPrompt('');
      setAiResponse(null);
    } else {
      alert(lang === 'zh' ? '没有可应用的数据。' : 'No data to apply.');
    }
  };

  // Download PDF report using HTML template approach for Chinese support
  const handleDownloadPDF = () => {
    if (!inspectionReport) return;

    // Create a hidden container for the report template
    const container = document.createElement('div');
    container.id = 'pdf-report-container-modal';
    container.style.cssText = `
      position: fixed;
      left: -9999px;
      top: 0;
      width: 210mm;
      padding: 0;
      margin: 0;
    `;
    document.body.appendChild(container);

    // Render the report template
    const root = createRoot(container);
    root.render(
      <InspectionReportTemplate
        inspectionReport={inspectionReport}
        robotName={robot.name}
        lang={lang as 'zh' | 'en'}
      />
    );

    // Wait for rendering to complete
    setTimeout(() => {
      // Generate filename
      const now = new Date();
      const dateStr = now.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const fileName =
        lang === 'zh'
          ? `${robot.name}_检查报告_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`
          : `${robot.name}_inspection_report_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`;

      // Create a clean printable version
      const element = document.getElementById('pdf-report-container-modal')?.firstElementChild;
      if (element) {
        // Store original body content
        const originalContent = document.body.innerHTML;

        // Replace body with report content for printing
        const reportClone = element.cloneNode(true) as HTMLElement;
        reportClone.style.cssText = `
          width: 100%;
          max-width: 210mm;
          margin: 0 auto;
          padding: 20mm;
        `;

        document.body.innerHTML = '';
        document.body.appendChild(reportClone);

        // Store original title
        const originalTitle = document.title;
        document.title = fileName;

        // Inject print styles
        const styleElement = document.createElement('style');
        styleElement.textContent = `
          @page {
            size: A4;
            margin: 10mm;
          }
          @media print {
            body {
              margin: 0;
              padding: 0;
            }
          }
        `;
        document.head.appendChild(styleElement);

        // Small delay before opening print dialog
        setTimeout(() => {
          window.print();

          // Restore original content after print
          window.addEventListener('afterprint', () => {
            document.body.innerHTML = originalContent;
            document.title = originalTitle;
            styleElement.remove();
          }, { once: true });

          // Also restore after a timeout in case user cancels
          setTimeout(() => {
            if (document.body.contains(reportClone)) {
              document.body.innerHTML = originalContent;
              document.title = originalTitle;
            }
          }, 5000);
        }, 100);
      }

      // Cleanup
      setTimeout(() => {
        root.unmount();
        const containerToRemove = document.getElementById('pdf-report-container-modal');
        if (containerToRemove && containerToRemove.parentElement) {
          containerToRemove.parentElement.removeChild(containerToRemove);
        }
      }, 6000);
    }, 200);
  };

  // Score color helpers
  const getScoreColor = (score: number, maxScoreForItem: number = 10) => {
    const normalizedScore = (score / maxScoreForItem) * 10;
    if (normalizedScore >= 9) return 'text-green-600 dark:text-green-400';
    if (normalizedScore >= 6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const getScoreBgColor = (score: number, maxScoreForItem: number = 10) => {
    const normalizedScore = (score / maxScoreForItem) * 10;
    if (normalizedScore >= 9) return 'bg-green-500';
    if (normalizedScore >= 6) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // Render inspection report
  const renderInspectionReport = () => {
    if (!inspectionReport) return null;

    const overallScore = inspectionReport.overallScore ?? 0;
    const maxScore = inspectionReport.maxScore ?? 100;
    const scorePercentage = (overallScore / maxScore) * 100;

    const issuesByCategory: Record<string, typeof inspectionReport.issues> = {};
    INSPECTION_CRITERIA.forEach(category => {
      issuesByCategory[category.id] = [];
    });
    inspectionReport.issues.forEach(issue => {
      const categoryId = issue.category || 'physical';
      if (!issuesByCategory[categoryId]) issuesByCategory[categoryId] = [];
      issuesByCategory[categoryId].push(issue);
    });

    const toggleCategory = (categoryId: string) => {
      setExpandedCategories(prev => {
        const newSet = new Set(prev);
        if (newSet.has(categoryId)) newSet.delete(categoryId);
        else newSet.add(categoryId);
        return newSet;
      });
    };

    return (
      <div className="space-y-6">
        {/* Score header - Dashboard Style */}
        <div className="relative overflow-hidden bg-slate-900 dark:bg-[#1C1C1E] rounded-2xl p-6 text-white shadow-xl border border-transparent dark:border-white/10">
          <div className="absolute top-0 right-0 p-8 opacity-10 rotate-12">
            <Sparkles className="w-32 h-32" />
          </div>
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-blue-400">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em]">{t.inspectorSummary}</span>
              </div>
              <h2 className="text-3xl font-black tracking-tight leading-tight">
                {lang === 'zh' ? 'URDF 模型健康度' : 'URDF Model Health'}
              </h2>
              <p className="text-sm text-slate-400 max-w-md font-medium leading-relaxed">
                {inspectionReport.summary}
              </p>
            </div>

            <div className="flex items-center gap-6 shrink-0">
              <div className="text-right">
                <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">{t.overallScore}</div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-5xl font-black tracking-tighter ${getScoreColor(overallScore, maxScore)}`}>
                    {Math.round(scorePercentage)}
                  </span>
                  <span className="text-xl text-slate-600 font-bold">%</span>
                </div>
              </div>
              <button
                onClick={handleDownloadPDF}
                className="p-3 bg-black dark:bg-[#48484A] hover:bg-slate-700 text-white rounded-xl transition-all border border-white/10 group shadow-lg"
                title={t.downloadReport}
              >
                <FileText className="w-6 h-6 group-hover:scale-110 transition-transform" />
              </button>
            </div>
          </div>

          <div className="mt-8 relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className={`absolute top-0 left-0 h-full transition-all duration-1000 ease-out rounded-full ${getScoreBgColor(overallScore, maxScore)}`}
              style={{ width: `${scorePercentage}%` }}
            />
          </div>
        </div>

        {/* Categories Grid */}
        <div className="grid grid-cols-1 gap-4">
          {INSPECTION_CRITERIA.map(category => {
            const categoryIssues = issuesByCategory[category.id] || [];
            const categoryScore = inspectionReport.categoryScores?.[category.id] ?? 10;
            const isExpanded = expandedCategories.has(category.id);
            const categoryName = lang === 'zh' ? category.nameZh : category.name;
            const hasProblems = categoryIssues.some(i => i.type !== 'pass');

            return (
              <div 
                key={category.id} 
                className={`group border rounded-2xl overflow-hidden transition-all duration-300 ${
                  isExpanded 
                    ? 'bg-white dark:bg-[#1C1C1E] border-slate-200 dark:border-white/10 shadow-xl shadow-slate-200/50 dark:shadow-black/50' 
                    : 'bg-slate-50 dark:bg-[#1C1C1E]/50 border-transparent hover:border-slate-200 dark:hover:border-white/10'
                }`}
              >
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center justify-between p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                      hasProblems ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600'
                    }`}>
                      {category.id === 'physical' ? <Box className="w-5 h-5" /> : 
                       category.id === 'kinematics' ? <RefreshCw className="w-5 h-5" /> : 
                       category.id === 'naming' ? <FileText className="w-5 h-5" /> : 
                       category.id === 'symmetry' ? <LayoutGrid className="w-5 h-5" /> : 
                       <Sparkles className="w-5 h-5" />}
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-slate-800 dark:text-slate-100 tracking-tight">{categoryName}</span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{category.weight * 100}%</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-medium">{categoryIssues.length} {lang === 'zh' ? '项检查' : 'checks'}</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6">
                    <div className="hidden sm:flex flex-col items-end gap-1">
                      <div className={`text-sm font-black ${getScoreColor(categoryScore)}`}>{categoryScore.toFixed(1)}/10</div>
                      <div className="w-24 h-1 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full ${getScoreBgColor(categoryScore)}`} style={{ width: `${(categoryScore / 10) * 100}%` }} />
                      </div>
                    </div>
                    <div className={`p-1.5 rounded-lg transition-colors ${isExpanded ? 'bg-slate-100 dark:bg-slate-700 text-slate-600' : 'text-slate-400 group-hover:text-slate-600'}`}>
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="p-4 pt-0 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                    {categoryIssues.length === 0 ? (
                      <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/10 border border-green-100 dark:border-green-800/30 rounded-xl text-green-600 dark:text-green-400">
                        <div className="p-2 bg-green-100 dark:bg-green-900/30 rounded-lg">
                           <Check className="w-4 h-4" />
                        </div>
                        <div className="text-xs font-bold">{lang === 'zh' ? '该章节所有检查项均通过' : 'All checks in this category passed'}</div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3">
                        {categoryIssues.map((issue, idx) => {
                          const issueScore = issue.score ?? 10;
                          const isRetesting = retestingItem?.categoryId === issue.category && retestingItem?.itemId === issue.itemId;
                          
                          let bgClass = "bg-white dark:bg-[#2C2C2E] border-slate-100 dark:border-white/5";
                          let iconColor = "text-slate-400";
                          let Icon = Info;

                          if (issue.type === 'error') {
                            bgClass = "bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30";
                            iconColor = "text-red-500";
                            Icon = AlertCircle;
                          } else if (issue.type === 'warning') {
                            bgClass = "bg-amber-50/50 dark:bg-amber-900/10 border-amber-100 dark:border-amber-900/30";
                            iconColor = "text-amber-500";
                            Icon = AlertTriangle;
                          } else if (issue.type === 'suggestion') {
                            bgClass = "bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30";
                            iconColor = "text-blue-500";
                            Icon = Sparkles;
                          } else if (issue.type === 'pass') {
                            bgClass = "bg-green-50/50 dark:bg-green-900/10 border-green-100 dark:border-green-900/30";
                            iconColor = "text-green-500";
                            Icon = Check;
                          }

                          return (
                            <div key={idx} className={`p-4 rounded-xl border transition-all hover:shadow-md ${bgClass} group/issue`}>
                              <div className="flex gap-4">
                                <div className={`shrink-0 p-2 rounded-lg bg-white dark:bg-[#000000] shadow-sm ${iconColor}`}>
                                  <Icon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between mb-1 gap-4">
                                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{issue.title}</h4>
                                    <div className="flex items-center gap-3 shrink-0">
                                      <div className={`text-xs font-black font-mono ${getScoreColor(issueScore)}`}>
                                        {issueScore.toFixed(1)}
                                      </div>
                                      {issue.category && issue.itemId && issue.type !== 'pass' && (
                                        <button
                                          onClick={() => handleRetestItem(issue.category!, issue.itemId!)}
                                          disabled={isRetesting || isGeneratingAI}
                                          className="p-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-[#0060FA] hover:text-white rounded-lg transition-all disabled:opacity-30"
                                          title={lang === 'zh' ? '重新检查该项' : 'Retest this item'}
                                        >
                                          {isRetesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium mb-3">
                                    {issue.description}
                                  </p>
                                  
                                  {issue.relatedIds && issue.relatedIds.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5">
                                      {issue.relatedIds.map(id => {
                                        const name = robot.links[id]?.name || robot.joints[id]?.name || id;
                                        return (
                                          <button
                                            key={id}
                                            onClick={() => {
                                              const type = robot.links[id] ? 'link' : 'joint';
                                              onSelectItem(type, id);
                                            }}
                                            className="text-[9px] font-bold bg-slate-100 dark:bg-[#000000] hover:bg-[#0060FA] hover:text-white px-2 py-1 rounded-md text-slate-500 dark:text-slate-400 transition-all border border-transparent hover:border-[#0060FA]"
                                          >
                                            {name}
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop - No blur, no pointer blocking */}
      <div className="fixed inset-0 z-[90] pointer-events-none" />
      
      {/* Floating Window */}
      <div
        ref={containerRef}
        style={getWindowStyle()}
        className={`z-[100] bg-white dark:bg-[#1C1C1E] flex flex-col text-slate-900 dark:text-slate-100 overflow-hidden rounded-xl shadow-2xl dark:shadow-black border border-slate-200 dark:border-white/10 select-none`}
      >
        {/* Resize handles - Larger hit areas */}
        {!isMaximized && !isMinimized && (
          <>
            <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-[#0060FA]/20 active:bg-[#0060FA]/30 transition-colors z-20" onMouseDown={(e) => handleResizeStart(e, 'right')} />
            <div className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-[#0060FA]/20 active:bg-[#0060FA]/30 transition-colors z-20" onMouseDown={(e) => handleResizeStart(e, 'bottom')} />
            <div className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize hover:bg-[#0060FA]/30 active:bg-[#0060FA]/40 transition-colors z-30 flex items-center justify-center" onMouseDown={(e) => handleResizeStart(e, 'corner')}>
              <div className="w-2 h-2 border-r-2 border-b-2 border-slate-400" />
            </div>
          </>
        )}

        {/* Window Header */}
        <div
          className={`h-12 border-b border-slate-200 dark:border-white/10 flex items-center justify-between px-4 bg-slate-50 dark:bg-[#1C1C1E] shrink-0 ${
            isMaximized ? '' : 'cursor-grab'
          } ${isDragging ? '!cursor-grabbing' : ''}`}
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-[#0060FA] rounded-lg text-white shadow-lg shadow-black/20">
                <ScanSearch className="w-4 h-4" />
              </div>
              <h1 className="text-sm font-bold tracking-tight">
                {t.aiTitle}
              </h1>
            </div>
            
            {inspectionReport && !isMinimized && (
              <div className="hidden md:flex ml-4 items-center gap-2 px-2 py-1 bg-white dark:bg-element-bg/50 border border-slate-200 dark:border-element-hover rounded-lg">
                <div className={`w-2 h-2 rounded-full ${getScoreBgColor(inspectionReport.overallScore || 0, inspectionReport.maxScore || 100)} animation-pulse`} />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t.overallScore}: {inspectionReport.overallScore?.toFixed(1)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1">
            <button onClick={toggleMinimize} className="p-1.5 hover:bg-slate-200 dark:hover:bg-element-hover rounded-md transition-colors" title={t.minimize}>
              <Minus className="w-4 h-4 text-slate-500" />
            </button>
            <button onClick={toggleMaximize} className="p-1.5 hover:bg-slate-200 dark:hover:bg-element-hover rounded-md transition-colors" title={isMaximized ? t.restore : t.maximize}>
              {isMaximized ? <Minimize2 className="w-4 h-4 text-slate-500" /> : <Maximize2 className="w-4 h-4 text-slate-500" />}
            </button>
            <button onClick={handleClose} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-md transition-colors group" title={t.close}>
              <X className="w-4 h-4 text-slate-500 group-hover:text-red-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        {!isMinimized && (
          <div className="flex-1 flex overflow-hidden relative">
            {/* Sidebar - Inspection Items */}
            <div className="w-56 border-r border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#1C1C1E] flex flex-col shrink-0">
              <div className="p-3 border-b border-slate-200 dark:border-white/10">
                <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 px-1">
                  {t.inspectionItems}
                </h3>
                <button
                  onClick={handleRunInspection}
                  disabled={isGeneratingAI}
                  className="w-full py-2 bg-[#0060FA] hover:bg-[#0050D0] text-white rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-lg shadow-black/20 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
                >
                  {isGeneratingAI ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  {isGeneratingAI ? t.thinking : t.runInspection}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {INSPECTION_CRITERIA.map(category => {
                  const categoryName = lang === 'zh' ? category.nameZh : category.name;
                  const selectedItemIds = selectedItems[category.id] || new Set();
                  const allSelected = category.items.every(item => selectedItemIds.has(item.id));
                  const someSelected = category.items.some(item => selectedItemIds.has(item.id));
                  const isExpanded = expandedCategories.has(category.id);

                  return (
                    <div key={category.id} className={`rounded-lg transition-colors ${isExpanded ? 'bg-white dark:bg-element-bg shadow-sm border border-slate-200 dark:border-white/10' : 'hover:bg-slate-200/50 dark:hover:bg-element-bg'}`}>
                      <div className="flex items-center p-2 group">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div 
                            className={`w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer ${allSelected ? 'bg-[#0060FA] border-[#0060FA]' : someSelected ? 'bg-[#0060FA]/70 border-[#0060FA]/70' : 'border-slate-300 dark:border-slate-600 hover:border-[#0060FA]'}`}
                            onClick={() => toggleCategorySelection(category.id)}
                          >
                            {allSelected ? <Check className="w-3 h-3 text-white" /> : someSelected ? <Minus className="w-2.5 h-2.5 text-white" /> : null}
                          </div>
                          <button 
                            className="flex-1 text-left truncate text-xs font-bold text-slate-700 dark:text-slate-200"
                            onClick={() => setExpandedCategories(prev => {
                              const next = new Set(prev);
                              if (next.has(category.id)) next.delete(category.id);
                              else next.add(category.id);
                              return next;
                            })}
                          >
                            {categoryName}
                          </button>
                        </div>
                        <button 
                          className="p-1 hover:bg-slate-200 dark:hover:bg-element-hover rounded transition-colors"
                          onClick={() => setExpandedCategories(prev => {
                            const next = new Set(prev);
                            if (next.has(category.id)) next.delete(category.id);
                            else next.add(category.id);
                            return next;
                          })}
                        >
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                        </button>
                      </div>

                      {isExpanded && (
                        <div className="px-2 pb-2 space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-200">
                          {category.items.map(item => (
                            <div 
                              key={item.id}
                              className="flex items-center gap-2 p-1.5 hover:bg-slate-100 dark:hover:bg-element-hover rounded-md cursor-pointer group/item"
                              onClick={() => toggleItemSelection(category.id, item.id)}
                            >
                              <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${selectedItemIds.has(item.id) ? 'bg-[#0060FA] border-[#0060FA]' : 'border-slate-300 dark:border-slate-600 group-hover/item:border-[#0060FA]'}`}>
                                {selectedItemIds.has(item.id) && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <span className="text-[10px] text-slate-600 dark:text-slate-400 font-medium truncate">{lang === 'zh' ? item.nameZh : item.name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Main Content - Results */}
            <div className="flex-1 overflow-y-auto bg-white dark:bg-app-bg flex flex-col min-w-0">
              <div className="flex-1 p-6">
                {inspectionProgress ? (
                  <div className="h-full flex flex-col items-center justify-center max-w-md mx-auto text-center space-y-6">
                    <div className="relative">
                      <div className="w-24 h-24 rounded-full border-4 border-slate-100 dark:border-border-black flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-[#0060FA] animate-spin" />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs font-bold font-mono">
                          {Math.round((inspectionProgress.completed / inspectionProgress.total) * 100)}%
                        </span>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <h3 className="text-lg font-bold text-slate-800 dark:text-white">{t.runInspection}</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {inspectionProgress.currentCategory ? (
                          <>
                            {t.checking}: <span className="text-[#0060FA] font-bold">{inspectionProgress.currentCategory}</span>
                            <br />
                            <span className="opacity-60">{inspectionProgress.currentItem}</span>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-center gap-2">
                              <Sparkles className="w-4 h-4 text-[#0060FA]" />
                              <span className="text-[#0060FA] font-semibold">{t.generatingReport}</span>
                            </div>
                            <span className="text-xs text-slate-400 mt-1 block">{lang === 'zh' ? '这可能需要 30 秒...' : 'This may take up to 30 seconds...'}</span>
                          </>
                        )}
                      </p>
                    </div>

                    {/* Progress bar - always visible, changes style based on state */}
                    <div className="w-full bg-slate-100 dark:bg-black rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          inspectionProgress.currentCategory
                            ? 'bg-[#0060FA]'
                            : 'bg-[#0060FA] animate-pulse'
                        }`}
                        style={{ width: `${(inspectionProgress.completed / inspectionProgress.total) * 100}%` }}
                      />
                    </div>

                    {/* Report generation sub-progress when in generating phase */}
                    {!inspectionProgress.currentCategory && reportGenerationTimer && (
                      <div className="w-full space-y-2 pt-2">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>{lang === 'zh' ? 'AI 分析中' : 'AI Analyzing'}</span>
                          <span>{reportGenerationTimer}s</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-black rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-1000"
                            style={{ width: `${Math.min((reportGenerationTimer / 30) * 100, 95)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : !aiResponse && !inspectionReport ? (
                  <div className="h-full flex flex-col">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <div className="p-4 bg-blue-50 dark:bg-blue-900/10 rounded-xl border border-blue-100 dark:border-white/10">
                        <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 mb-2">
                          <Sparkles className="w-4 h-4" />
                          <h3 className="text-sm font-bold uppercase tracking-tight">{lang === 'zh' ? '智能分析' : 'AI Analysis'}</h3>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed italic">
                          "{t.aiIntro}"
                        </p>
                      </div>
                      <div className="p-4 bg-slate-50 dark:bg-element-active/50 rounded-xl border border-slate-100 dark:border-white/10">
                        <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 mb-2">
                          <Info className="w-4 h-4" />
                          <h3 className="text-sm font-bold uppercase tracking-tight">{lang === 'zh' ? '常用示例' : 'Examples'}</h3>
                        </div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          {t.aiExamples}
                        </p>
                      </div>
                    </div>

                    <div className="flex-1 flex flex-col bg-white dark:bg-black rounded-xl border border-slate-200 dark:border-white/10 shadow-sm p-4">
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        className="flex-1 bg-transparent border-none p-0 text-slate-900 dark:text-slate-200 text-sm focus:ring-0 focus:outline-none resize-none custom-scrollbar placeholder:text-slate-400"
                        placeholder={t.aiPlaceholder}
                      />
                      <div className="mt-4 flex justify-between items-center">
                        <span className="text-[10px] text-slate-400 font-medium">
                          {lang === 'zh' ? '按 Enter 发送，Shift+Enter 换行' : 'Press Enter to send, Shift+Enter for newline'}
                        </span>
                        <button
                          onClick={handleGenerateAI}
                          disabled={isGeneratingAI || !aiPrompt.trim()}
                          className="px-4 py-1.5 bg-black dark:bg-white dark:text-slate-900 text-white rounded-lg text-xs font-bold flex items-center gap-2 hover:opacity-90 transition-all shadow-lg dark:shadow-black active:scale-95 disabled:opacity-30 disabled:active:scale-100"
                        >
                          {isGeneratingAI ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          {t.send}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {inspectionReport && (
                      <div className="space-y-6 pb-20">
                        {renderInspectionReport()}
                        
                        {/* Discussion Button */}
                        <div className="flex justify-center">
                          <button
                            onClick={() => setIsReportChatOpen(true)}
                            className="flex items-center gap-2 px-6 py-2 bg-[#0060FA] hover:bg-blue-600 text-white rounded-full text-xs font-bold transition-all shadow-lg shadow-black/20 hover:scale-105 active:scale-95"
                          >
                            <MessageCircle className="w-4 h-4" />
                            {lang === 'zh' ? '针对报告进行对话' : 'Discuss Report with AI'}
                          </button>
                        </div>
                      </div>
                    )}

                    {aiResponse && (
                      <div className="space-y-6">
                        <div className="p-4 bg-slate-50 dark:bg-[#1C1C1E] rounded-xl border border-slate-200 dark:border-white/10">
                          <div className="flex items-center gap-2 mb-3">
                            <div className="w-1 h-3 bg-[#0060FA] rounded-full" />
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.yourRequest}</span>
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300 font-medium italic">{aiPrompt}</p>
                        </div>

                        <div className="p-5 bg-white dark:bg-[#1C1C1E] rounded-xl border border-slate-200 dark:border-white/10 shadow-xl shadow-slate-200/50 dark:shadow-black/50 relative overflow-hidden group">
                          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#0060FA] to-blue-400" />
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-[#0060FA]" />
                              <h3 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-tight">
                                {t.aiResponse} <span className="text-blue-400 font-normal ml-1">[{aiResponse.type}]</span>
                              </h3>
                            </div>
                            {aiResponse.data && (
                               <div className="flex items-center gap-1.5 px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-md text-[10px] font-bold">
                                 <Check className="w-3 h-3" />
                                 {lang === 'zh' ? '建议可应用' : 'Actionable'}
                               </div>
                            )}
                          </div>
                          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                            {aiResponse.explanation}
                          </p>
                        </div>

                        {aiResponse.data && (
                          <div className="p-4 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl flex gap-3 items-start">
                            <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-lg shrink-0">
                               <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                            </div>
                            <div className="space-y-1">
                               <p className="text-xs font-bold text-amber-800 dark:text-amber-200">{lang === 'zh' ? '应用更改提示' : 'Apply Changes'}</p>
                               <p className="text-[11px] text-amber-700/80 dark:text-amber-300/80 leading-relaxed">{t.actionWarning}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Chat Overlay for Inspection Report */}
            {isReportChatOpen && inspectionReport && (
              <div className="absolute inset-0 bg-white/95 dark:bg-app-bg/95 z-40 flex flex-col animate-in slide-in-from-right-4 duration-300">
                <div className="h-12 px-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50 dark:bg-[#1C1C1E] shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="p-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded">
                      <MessageCircle className="w-3.5 h-3.5" />
                    </div>
                    <span className="text-xs font-bold">{t.chatTitle}</span>
                  </div>
                  <button onClick={() => { setIsReportChatOpen(false); setReportChatMessages([]); }} className="p-1 hover:bg-slate-200 dark:hover:bg-element-hover rounded transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                   {reportChatMessages.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3 px-10 text-center">
                        <div className="p-4 bg-slate-100 dark:bg-black rounded-full">
                           <MessageCircle className="w-8 h-8 opacity-20" />
                        </div>
                        <p className="text-xs italic leading-relaxed">{t.askAboutReport}</p>
                     </div>
                   ) : (
                     reportChatMessages.map((msg, idx) => (
                       <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                         <div className={`max-w-[85%] px-4 py-2.5 rounded-2xl shadow-sm text-sm ${
                           msg.role === 'user' 
                             ? 'bg-[#0060FA] text-white rounded-tr-none' 
                             : 'bg-slate-100 dark:bg-element-active text-slate-700 dark:text-slate-200 rounded-tl-none border border-slate-200 dark:border-border-black'
                         }`}>
                           {msg.content}
                         </div>
                       </div>
                     ))
                   )}
                   {isChatGenerating && (
                     <div className="flex justify-start">
                        <div className="bg-slate-100 dark:bg-element-active rounded-2xl rounded-tl-none border border-slate-200 dark:border-border-black px-4 py-2.5">
                           <Loader2 className="w-4 h-4 animate-spin text-[#0060FA]" />
                        </div>
                     </div>
                   )}
                </div>

                <div className="p-4 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-[#1C1C1E]">
                  <div className="relative group">
                    <input 
                      type="text"
                      value={reportChatInput}
                      onChange={(e) => setReportChatInput(e.target.value)}
                      onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReportChatSend(); } }}
                      placeholder={t.chatPlaceholder}
                      className="w-full bg-slate-100 dark:bg-black border border-slate-200 dark:border-element-hover rounded-xl py-3 pl-4 pr-12 text-xs focus:ring-2 focus:ring-[#0060FA] transition-all"
                    />
                    <button 
                      onClick={handleReportChatSend}
                      disabled={isChatGenerating || !reportChatInput.trim()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-[#0060FA] text-white rounded-lg shadow-md hover:opacity-90 active:scale-90 transition-all disabled:opacity-30 disabled:scale-100"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="h-14 px-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0 bg-slate-50 dark:bg-[#1C1C1E]">
          <div className="flex items-center gap-2">
            {(aiResponse || inspectionReport) && !inspectionProgress && (
              <button
                onClick={() => { setAiResponse(null); setInspectionReport(null); setAiPrompt(''); setInspectionProgress(null); setReportGenerationTimer(null); }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-element-hover rounded-lg transition-colors"
              >
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                {t.back}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!(aiResponse || inspectionReport) ? (
              <>
                <button onClick={handleClose} className="px-4 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white rounded-lg transition-colors">
                  {t.cancel}
                </button>
                <button
                  onClick={handleGenerateAI}
                  disabled={isGeneratingAI || !aiPrompt.trim()}
                  className="px-6 py-1.5 bg-black dark:bg-white dark:text-slate-900 text-white rounded-lg text-xs font-bold transition-all shadow-lg dark:shadow-black hover:opacity-90 active:scale-95 disabled:opacity-30"
                >
                  {isGeneratingAI ? t.thinking : t.send}
                </button>
              </>
            ) : aiResponse?.data ? (
              <button
                onClick={applyAIChanges}
                className="px-6 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-green-500/20 active:scale-95 flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                {t.applyChanges}
              </button>
            ) : null}
          </div>
        </div>

        {/* Resize Indicator */}
        {isResizing && (
          <div className="absolute bottom-2 right-12 z-50 px-2 py-1 bg-[#0060FA] text-white text-[10px] rounded font-mono shadow-lg">
            {size.width} × {size.height}
          </div>
        )}
      </div>
    </>
  );
}

export default AIModal;
