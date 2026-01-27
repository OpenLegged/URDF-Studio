/**
 * AI Assistant Modal Component
 * Provides AI-powered robot inspection and generation interface
 */
import React, { useState, useCallback } from 'react';
import {
  ScanSearch, X, Move, Loader2, ChevronDown, ChevronRight,
  Check, ArrowRight, Sparkles, Box, MessageCircle, Send,
  AlertTriangle, Info, AlertCircle, RefreshCw, FileText
} from 'lucide-react';
import jsPDF from 'jspdf';
import type { RobotState, MotorSpec, InspectionReport } from '@/types';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { generateRobotFromPrompt, runRobotInspection, INSPECTION_CRITERIA } from '../index';

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

  // Panel position
  const [panelPos, setPanelPos] = useState({ x: 320, y: 80 });

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

  // Drag handling
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = panelPos.x;
    const initialY = panelPos.y;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      setPanelPos({ x: initialX + dx, y: initialY + dy });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelPos]);

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

  // Download PDF report
  const handleDownloadPDF = () => {
    if (!inspectionReport) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let yPos = margin;

    // Title
    doc.setFontSize(20);
    doc.setTextColor(50, 50, 50);
    const reportTitle = lang === 'zh' ? 'URDF 机器人检查报告' : 'URDF Robot Inspection Report';
    doc.text(reportTitle, pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;

    // Robot name
    doc.setFontSize(14);
    doc.setTextColor(100, 100, 100);
    const robotNameLabel = lang === 'zh' ? '机器人名称' : 'Robot Name';
    doc.text(`${robotNameLabel}: ${robot.name}`, margin, yPos);
    yPos += 10;

    // Date
    const now = new Date();
    const dateStr = now.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    const dateLabel = lang === 'zh' ? '检查日期' : 'Inspection Date';
    doc.text(`${dateLabel}: ${dateStr}`, margin, yPos);
    yPos += 15;

    // Overall score
    const overallScore = inspectionReport.overallScore ?? 0;
    const maxScore = inspectionReport.maxScore ?? 100;
    doc.setFontSize(16);
    doc.setTextColor(50, 50, 50);
    const scoreLabel = lang === 'zh' ? '总分' : 'Overall Score';
    doc.text(`${scoreLabel}: ${overallScore.toFixed(1)}/${maxScore}`, margin, yPos);
    yPos += 10;

    // Progress bar
    const scorePercentage = (overallScore / maxScore) * 100;
    const barWidth = pageWidth - 2 * margin;
    const barHeight = 5;
    doc.setFillColor(200, 200, 200);
    doc.rect(margin, yPos, barWidth, barHeight, 'F');

    let barColor: [number, number, number] = [239, 68, 68];
    if (scorePercentage >= 90) barColor = [34, 197, 94];
    else if (scorePercentage >= 60) barColor = [234, 179, 8];
    doc.setFillColor(...barColor);
    doc.rect(margin, yPos, (barWidth * scorePercentage) / 100, barHeight, 'F');
    yPos += 15;

    // Summary
    doc.setFontSize(12);
    doc.setTextColor(50, 50, 50);
    doc.setFont(undefined, 'bold');
    const summaryLabel = lang === 'zh' ? '检查总结' : 'Inspection Summary';
    doc.text(summaryLabel, margin, yPos);
    yPos += 8;
    doc.setFont(undefined, 'normal');
    const summaryLines = doc.splitTextToSize(inspectionReport.summary, pageWidth - 2 * margin);
    doc.text(summaryLines, margin, yPos);
    yPos += summaryLines.length * 6 + 10;

    // Issues by category
    const issuesByCategory: Record<string, typeof inspectionReport.issues> = {};
    INSPECTION_CRITERIA.forEach(category => {
      issuesByCategory[category.id] = [];
    });
    inspectionReport.issues.forEach(issue => {
      const categoryId = issue.category || 'physical';
      if (!issuesByCategory[categoryId]) issuesByCategory[categoryId] = [];
      issuesByCategory[categoryId].push(issue);
    });

    INSPECTION_CRITERIA.forEach(category => {
      if (yPos > pageHeight - 40) {
        doc.addPage();
        yPos = margin;
      }

      const categoryIssues = issuesByCategory[category.id] || [];
      const categoryScore = inspectionReport.categoryScores?.[category.id] ?? 10;
      const categoryName = lang === 'zh' ? category.nameZh : category.name;

      doc.setFontSize(14);
      doc.setFont(undefined, 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text(`${categoryName} (${categoryScore.toFixed(1)}/10)`, margin, yPos);
      yPos += 10;

      if (categoryIssues.length === 0) {
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(34, 197, 94);
        doc.text(lang === 'zh' ? '✓ 该章节所有检查项均通过' : '✓ All checks passed', margin + 5, yPos);
        yPos += 8;
      } else {
        categoryIssues.forEach(issue => {
          if (yPos > pageHeight - 30) {
            doc.addPage();
            yPos = margin;
          }

          const issueScore = issue.score ?? 10;
          doc.setFontSize(10);
          doc.setFont(undefined, 'bold');

          if (issue.type === 'error') doc.setTextColor(239, 68, 68);
          else if (issue.type === 'warning') doc.setTextColor(234, 179, 8);
          else if (issue.type === 'suggestion') doc.setTextColor(59, 130, 246);
          else doc.setTextColor(50, 50, 50);

          const icon = issue.type === 'error' ? '✗' : issue.type === 'warning' ? '⚠' : 'ℹ';
          doc.text(`${icon} ${issue.title} (${issueScore.toFixed(1)}/10)`, margin + 5, yPos);
          yPos += 6;

          doc.setFont(undefined, 'normal');
          doc.setTextColor(100, 100, 100);
          const descLines = doc.splitTextToSize(issue.description, pageWidth - 2 * margin - 10);
          doc.text(descLines, margin + 5, yPos);
          yPos += descLines.length * 5 + 5;
        });
      }
      yPos += 5;
    });

    const fileName = lang === 'zh'
      ? `${robot.name}_检查报告_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`
      : `${robot.name}_inspection_report_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`;
    doc.save(fileName);
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
      <div className="space-y-4">
        {/* Score header */}
        <div className="bg-gradient-to-r from-slate-100 dark:from-slate-800/80 to-slate-200 dark:to-slate-900/80 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-500 dark:text-slate-400 uppercase font-bold">{t.overallScore}</div>
            <div className="flex items-center gap-3">
              <div className={`text-2xl font-bold ${getScoreColor(overallScore, maxScore)}`}>
                {overallScore.toFixed(1)}/{maxScore}
              </div>
              <button
                onClick={handleDownloadPDF}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm transition-colors"
              >
                <FileText className="w-4 h-4" />
                <span className="text-xs">{t.downloadReport}</span>
              </button>
            </div>
          </div>
          <div className="w-full h-2 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${getScoreBgColor(overallScore, maxScore)}`}
              style={{ width: `${scorePercentage}%` }}
            />
          </div>
        </div>

        {/* Summary */}
        <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded border border-slate-200 dark:border-slate-700">
          <div className="text-xs text-slate-500 uppercase font-bold mb-1">{t.inspectorSummary}</div>
          <div className="text-sm text-slate-700 dark:text-slate-300 font-medium">{inspectionReport.summary}</div>
        </div>

        {/* Categories */}
        <div className="space-y-2">
          {INSPECTION_CRITERIA.map(category => {
            const categoryIssues = issuesByCategory[category.id] || [];
            const categoryScore = inspectionReport.categoryScores?.[category.id] ?? 10;
            const isExpanded = expandedCategories.has(category.id);
            const categoryName = lang === 'zh' ? category.nameZh : category.name;

            return (
              <div key={category.id} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                <button
                  onClick={() => toggleCategory(category.id)}
                  className="w-full flex items-center justify-between p-3 bg-slate-100 dark:bg-slate-800/50 hover:bg-slate-200 dark:hover:bg-slate-800/70 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                    <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{categoryName}</span>
                    <span className="text-xs text-slate-500">({category.weight * 100}%)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${getScoreColor(categoryScore)}`}>{categoryScore.toFixed(1)}/10</span>
                    <div className="w-16 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className={`h-full ${getScoreBgColor(categoryScore)}`} style={{ width: `${(categoryScore / 10) * 100}%` }} />
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/30 space-y-2">
                    {categoryIssues.length === 0 ? (
                      <div className="flex items-center gap-2 p-2 bg-green-100 dark:bg-green-900/20 border border-green-300 dark:border-green-700/30 rounded text-green-600 dark:text-green-300 text-xs">
                        <Check className="w-3 h-3" />
                        <span>{lang === 'zh' ? '✓ 该章节所有检查项均通过' : 'All checks passed'}</span>
                      </div>
                    ) : (
                      categoryIssues.map((issue, idx) => {
                        const issueScore = issue.score ?? 10;
                        let colorClass = "bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700";
                        let icon = <Info className="w-4 h-4" />;
                        let titleColor = "text-slate-700 dark:text-slate-200";

                        if (issue.type === 'error') {
                          colorClass = "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/50";
                          icon = <AlertCircle className="w-4 h-4 text-red-500" />;
                          titleColor = "text-red-600 dark:text-red-300";
                        } else if (issue.type === 'warning') {
                          colorClass = "bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/50";
                          icon = <AlertTriangle className="w-4 h-4 text-amber-500" />;
                          titleColor = "text-amber-600 dark:text-amber-300";
                        } else if (issue.type === 'suggestion') {
                          colorClass = "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/50";
                          icon = <Sparkles className="w-4 h-4 text-blue-500" />;
                          titleColor = "text-blue-600 dark:text-blue-300";
                        } else if (issue.type === 'pass') {
                          colorClass = "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800/50";
                          icon = <Check className="w-4 h-4 text-green-500" />;
                          titleColor = "text-green-600 dark:text-green-300";
                        }

                        const isRetesting = retestingItem?.categoryId === issue.category && retestingItem?.itemId === issue.itemId;

                        return (
                          <div key={idx} className={`p-3 rounded border flex gap-3 ${colorClass}`}>
                            <div className="mt-0.5 shrink-0">{icon}</div>
                            <div className="flex-1">
                              <div className="flex items-center justify-between mb-1">
                                <div className={`text-sm font-bold ${titleColor}`}>{issue.title}</div>
                                <div className="flex items-center gap-2">
                                  <div className={`text-xs font-bold ${getScoreColor(issueScore)}`}>{issueScore.toFixed(1)}/10</div>
                                  {issue.category && issue.itemId && issue.type !== 'pass' && (
                                    <button
                                      onClick={() => handleRetestItem(issue.category!, issue.itemId!)}
                                      disabled={isRetesting || isGeneratingAI}
                                      className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-[10px] rounded transition-colors disabled:opacity-50 flex items-center gap-1"
                                    >
                                      {isRetesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{issue.description}</div>
                              {issue.relatedIds && issue.relatedIds.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {issue.relatedIds.map(id => {
                                    const name = robot.links[id]?.name || robot.joints[id]?.name || id;
                                    return (
                                      <span
                                        key={id}
                                        className="text-[10px] bg-slate-200 dark:bg-slate-900/50 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700/50 cursor-pointer hover:bg-slate-300 dark:hover:bg-slate-800"
                                        onClick={() => {
                                          const type = robot.links[id] ? 'link' : 'joint';
                                          onSelectItem(type, id);
                                        }}
                                      >
                                        {name}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })
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
      <div
        style={{ left: panelPos.x, top: panelPos.y }}
        className="fixed z-50 w-[720px] h-[560px] flex flex-col bg-slate-100 dark:bg-[#181c20] backdrop-blur-md shadow-2xl rounded-lg border border-slate-300 dark:border-slate-700"
      >
        {/* Header */}
        <div
          onMouseDown={handleDragStart}
          className="flex items-center justify-between p-2 border-b border-slate-200 dark:border-slate-700 shrink-0 cursor-move bg-slate-200/80 dark:bg-[#23272b] rounded-t-lg select-none"
        >
          <div className="flex items-center gap-2">
            <ScanSearch className="w-4 h-4 text-purple-600 dark:text-purple-300" />
            <h2 className="text-sm font-bold text-slate-800 dark:text-white">{t.aiTitle}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Move className="w-3 h-3 text-slate-400 dark:text-slate-500" />
            <button onClick={handleClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden bg-white dark:bg-[#181c20]">
          {/* Left sidebar - Inspection items */}
          <div className="w-52 border-r border-slate-200 dark:border-slate-700 flex flex-col bg-slate-50/30 dark:bg-[#23272b]">
            <div className="p-2 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-xs font-bold text-slate-500 dark:text-slate-300 uppercase mb-1.5">{t.inspectionItems}</h3>
              <button
                onClick={handleRunInspection}
                disabled={isGeneratingAI}
                className="w-full py-1.5 bg-slate-800 dark:bg-[#23272b] hover:bg-slate-700 dark:hover:bg-[#181c20] text-white rounded text-xs flex items-center justify-center gap-1.5 transition-colors border border-slate-700 dark:border-slate-600 disabled:opacity-50"
              >
                {isGeneratingAI ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
                {isGeneratingAI ? t.thinking : t.runInspection}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1.5">
              {INSPECTION_CRITERIA.map(category => {
                const categoryName = lang === 'zh' ? category.nameZh : category.name;
                const selectedItemIds = selectedItems[category.id] || new Set();
                const allSelected = category.items.every(item => selectedItemIds.has(item.id));
                const someSelected = category.items.some(item => selectedItemIds.has(item.id));

                return (
                  <div key={category.id} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <div className="w-full flex items-center justify-between p-2 bg-slate-100/50 dark:bg-slate-800/50 hover:bg-slate-200/50 dark:hover:bg-slate-800/70 transition-colors">
                      <div className="flex items-center gap-2 flex-1">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                          onChange={() => toggleCategorySelection(category.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-700 text-purple-600 focus:ring-purple-500"
                        />
                        <button
                          onClick={() => setExpandedCategories(prev => {
                            const newSet = new Set(prev);
                            if (newSet.has(category.id)) newSet.delete(category.id);
                            else newSet.add(category.id);
                            return newSet;
                          })}
                          className="flex-1 text-left"
                        >
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200">{categoryName}</span>
                        </button>
                      </div>
                      <button
                        onClick={() => setExpandedCategories(prev => {
                          const newSet = new Set(prev);
                          if (newSet.has(category.id)) newSet.delete(category.id);
                          else newSet.add(category.id);
                          return newSet;
                        })}
                      >
                        {expandedCategories.has(category.id) ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                      </button>
                    </div>

                    {expandedCategories.has(category.id) && (
                      <div className="p-2 space-y-1 bg-slate-50/50 dark:bg-slate-900/30">
                        {category.items.map(item => (
                          <label
                            key={item.id}
                            className="flex items-center gap-2 p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedItemIds.has(item.id)}
                              onChange={() => toggleItemSelection(category.id, item.id)}
                              className="rounded border-slate-400 dark:border-slate-600 bg-white dark:bg-slate-700 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="text-[10px] text-slate-600 dark:text-slate-300">{lang === 'zh' ? item.nameZh : item.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right panel - Results */}
          <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#181c20]">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
              {inspectionProgress ? (
                <div className="space-y-4">
                  <div className="bg-slate-100 dark:bg-[#23272b] border border-slate-300 dark:border-slate-700 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-bold text-purple-700 dark:text-purple-200">{t.runInspection}</h3>
                      <span className="text-xs text-slate-500">{inspectionProgress.completed} / {inspectionProgress.total}</span>
                    </div>
                    <div className="w-full h-2 bg-slate-300 dark:bg-slate-700 rounded-full overflow-hidden mb-3">
                      <div
                        className="h-full bg-slate-800 dark:bg-[#23272b] transition-all duration-300"
                        style={{ width: `${(inspectionProgress.completed / inspectionProgress.total) * 100}%` }}
                      />
                    </div>
                    {inspectionProgress.currentCategory && inspectionProgress.currentItem && (
                      <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                        <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                        <span>{t.checking}: <span className="font-bold text-purple-600">{inspectionProgress.currentCategory}</span> - {inspectionProgress.currentItem}</span>
                      </div>
                    )}
                    {inspectionProgress.completed === inspectionProgress.total && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                          <Check className="w-4 h-4" />
                          <span>{t.inspectionCompleted}</span>
                        </div>
                        {reportGenerationTimer !== null && (
                          <div className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-200">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>{t.generatingReport} ({reportGenerationTimer}s)</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : !aiResponse && !inspectionReport ? (
                <>
                  <div className="bg-slate-100 dark:bg-[#23272b] border border-slate-300 dark:border-slate-700 rounded p-4 mb-4">
                    <h3 className="text-sm font-bold text-purple-700 dark:text-purple-200 mb-2">{t.runInspection}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{t.aiExamples}</p>
                  </div>

                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-3 border-t border-slate-200 dark:border-slate-700 pt-4">
                    {t.aiIntro}
                  </p>

                  <textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    className="w-full h-24 bg-slate-50 dark:bg-[#23272b] border border-slate-200 dark:border-slate-700 rounded p-3 text-slate-700 dark:text-slate-200 text-sm focus:border-slate-800 dark:focus:border-slate-400 focus:outline-none resize-none"
                    placeholder={t.aiPlaceholder}
                  />
                </>
              ) : (
                <>
                  {inspectionReport && (
                    <div className="relative">
                      {renderInspectionReport()}

                      {/* Chat Dialog */}
                      {isReportChatOpen && (
                        <div className="fixed bottom-4 right-4 z-50 w-80 h-[400px] flex flex-col bg-white/95 dark:bg-slate-900/95 backdrop-blur-md shadow-2xl rounded-lg border border-slate-300 dark:border-slate-600">
                          <div className="flex items-center justify-between p-3 border-b border-slate-200 dark:border-slate-700 shrink-0 bg-slate-100/50 dark:bg-slate-800/50 rounded-t-lg">
                            <div className="flex items-center gap-2">
                              <MessageCircle className="w-4 h-4 text-blue-500" />
                              <h3 className="text-sm font-bold text-slate-800 dark:text-white">{t.chatTitle}</h3>
                            </div>
                            <button
                              onClick={() => { setIsReportChatOpen(false); setReportChatMessages([]); setReportChatInput(''); }}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                            {reportChatMessages.length === 0 ? (
                              <div className="text-sm text-slate-500 text-center py-8">{t.askAboutReport}</div>
                            ) : (
                              reportChatMessages.map((msg, idx) => (
                                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[80%] rounded-lg p-3 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}>
                                    <div className="text-xs whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                                  </div>
                                </div>
                              ))
                            )}
                            {isChatGenerating && (
                              <div className="flex justify-start">
                                <div className="bg-slate-200 dark:bg-slate-800 rounded-lg p-3">
                                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="p-3 border-t border-slate-200 dark:border-slate-700 shrink-0">
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={reportChatInput}
                                onChange={(e) => setReportChatInput(e.target.value)}
                                onKeyPress={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReportChatSend(); } }}
                                placeholder={t.chatPlaceholder}
                                className="flex-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-3 py-2 text-slate-700 dark:text-slate-200 text-sm focus:border-blue-500 focus:outline-none"
                                disabled={isChatGenerating}
                              />
                              <button
                                onClick={handleReportChatSend}
                                disabled={isChatGenerating || !reportChatInput.trim()}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white rounded transition-colors flex items-center gap-2"
                              >
                                {isChatGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Chat Button */}
                      {!isReportChatOpen && (
                        <button
                          onClick={() => setIsReportChatOpen(true)}
                          className="fixed bottom-4 right-4 z-40 w-14 h-14 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
                          title={t.chatWithAI}
                        >
                          <MessageCircle className="w-6 h-6" />
                        </button>
                      )}
                    </div>
                  )}

                  {aiResponse && (
                    <div className="space-y-4">
                      <div className="bg-slate-50 dark:bg-[#23272b] p-3 rounded border border-slate-200 dark:border-slate-700">
                        <div className="text-xs text-slate-500 uppercase font-bold mb-1">{t.yourRequest}</div>
                        <div className="text-sm text-slate-700 dark:text-slate-300">{aiPrompt}</div>
                      </div>

                      <div className="bg-slate-100 dark:bg-[#23272b] p-3 rounded border border-slate-300 dark:border-slate-700">
                        <div className="flex items-center gap-2 mb-1">
                          <Sparkles className="w-3 h-3 text-slate-800 dark:text-slate-200" />
                          <div className="text-xs text-slate-800 dark:text-slate-200 uppercase font-bold">
                            {t.aiResponse} {aiResponse.type ? `(${aiResponse.type})` : ''}
                          </div>
                        </div>
                        <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                          {aiResponse.explanation || t.processing}
                        </div>
                      </div>

                      {aiResponse.data && (
                        <div className="flex items-center gap-2 text-xs text-yellow-600 dark:text-yellow-500 bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded border border-yellow-300 dark:border-yellow-700/30">
                          <Box className="w-3 h-3" />
                          {t.actionWarning}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex justify-between gap-2 shrink-0 bg-slate-100/30 dark:bg-[#23272b] rounded-b-lg">
          {(aiResponse || inspectionReport) ? (
            <>
              <button
                onClick={() => { setAiResponse(null); setInspectionReport(null); setAiPrompt(''); setInspectionProgress(null); setReportGenerationTimer(null); }}
                className="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                {t.back}
              </button>
              {aiResponse?.data && (
                <button
                  onClick={applyAIChanges}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs rounded transition-colors flex items-center gap-2"
                >
                  <Check className="w-3 h-3" />
                  {t.applyChanges}
                </button>
              )}
            </>
          ) : (
            <>
              <button
                onClick={handleClose}
                className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-[#23272b] rounded transition-colors"
              >
                {t.cancel}
              </button>
              <button
                onClick={handleGenerateAI}
                disabled={isGeneratingAI || !aiPrompt.trim()}
                className="px-3 py-1.5 bg-slate-800 dark:bg-[#23272b] hover:bg-slate-700 dark:hover:bg-[#181c20] disabled:bg-slate-300 dark:disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs rounded transition-colors flex items-center gap-2 border border-slate-700 dark:border-slate-600"
              >
                {isGeneratingAI ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t.thinking}
                  </>
                ) : (
                  <>
                    <ArrowRight className="w-3 h-3" />
                    {t.send}
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default AIModal;
