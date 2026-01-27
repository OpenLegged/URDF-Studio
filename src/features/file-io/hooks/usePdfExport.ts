/**
 * usePdfExport Hook
 * Handle PDF report export operations for inspection reports
 */

import { useCallback } from 'react';
import jsPDF from 'jspdf';
import { useUIStore, useRobotStore } from '@/store';
import { INSPECTION_CRITERIA } from '@/features/ai-assistant';
import type { InspectionReport } from '@/types';

interface UsePdfExportReturn {
  handleDownloadPDF: (inspectionReport: InspectionReport | null) => void;
}

export function usePdfExport(): UsePdfExportReturn {
  const lang = useUIStore((s) => s.language);
  const robotName = useRobotStore((s) => s.name);

  const handleDownloadPDF = useCallback((inspectionReport: InspectionReport | null) => {
    if (!inspectionReport) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    let yPos = margin;

    // 标题
    doc.setFontSize(20);
    doc.setTextColor(50, 50, 50);
    const reportTitle = lang === 'zh' ? 'URDF 机器人检查报告' : 'URDF Robot Inspection Report';
    doc.text(reportTitle, pageWidth / 2, yPos, { align: 'center' });
    yPos += 15;

    // 机器人名称
    doc.setFontSize(14);
    doc.setTextColor(100, 100, 100);
    const robotNameLabel = lang === 'zh' ? '机器人名称' : 'Robot Name';
    doc.text(`${robotNameLabel}: ${robotName}`, margin, yPos);
    yPos += 10;

    // 检查日期
    const now = new Date();
    const dateStr = now.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const dateLabel = lang === 'zh' ? '检查日期' : 'Inspection Date';
    doc.text(`${dateLabel}: ${dateStr}`, margin, yPos);
    yPos += 15;

    // 总分
    const overallScore = inspectionReport.overallScore ?? 0;
    const maxScore = inspectionReport.maxScore ?? 100;
    doc.setFontSize(16);
    doc.setTextColor(50, 50, 50);
    const scoreLabel = lang === 'zh' ? '总分' : 'Overall Score';
    doc.text(`${scoreLabel}: ${overallScore.toFixed(1)}/${maxScore}`, margin, yPos);
    yPos += 10;

    // 进度条
    const scorePercentage = (overallScore / maxScore) * 100;
    const barWidth = pageWidth - 2 * margin;
    const barHeight = 5;
    doc.setFillColor(200, 200, 200);
    doc.rect(margin, yPos, barWidth, barHeight, 'F');

    // 根据分数设置颜色
    let barColor: [number, number, number] = [239, 68, 68]; // 红色
    if (scorePercentage >= 90) {
      barColor = [34, 197, 94]; // 绿色
    } else if (scorePercentage >= 60) {
      barColor = [234, 179, 8]; // 黄色
    }
    doc.setFillColor(...barColor);
    doc.rect(margin, yPos, (barWidth * scorePercentage) / 100, barHeight, 'F');
    yPos += 15;

    // 总结
    doc.setFontSize(12);
    doc.setTextColor(50, 50, 50);
    doc.setFont(undefined!, 'bold');
    const summaryLabel = lang === 'zh' ? '检查总结' : 'Inspection Summary';
    doc.text(summaryLabel, margin, yPos);
    yPos += 8;
    doc.setFont(undefined!, 'normal');
    const summaryLines = doc.splitTextToSize(inspectionReport.summary, pageWidth - 2 * margin);
    doc.text(summaryLines, margin, yPos);
    yPos += summaryLines.length * 6 + 10;

    // 按章节分组展示
    const issuesByCategory: Record<string, typeof inspectionReport.issues> = {};
    INSPECTION_CRITERIA.forEach((category) => {
      issuesByCategory[category.id] = [];
    });

    inspectionReport.issues.forEach((issue) => {
      const categoryId = issue.category || 'physical';
      if (!issuesByCategory[categoryId]) {
        issuesByCategory[categoryId] = [];
      }
      issuesByCategory[categoryId].push(issue);
    });

    INSPECTION_CRITERIA.forEach((category) => {
      // 检查是否需要新页面
      if (yPos > pageHeight - 40) {
        doc.addPage();
        yPos = margin;
      }

      const categoryIssues = issuesByCategory[category.id] || [];
      const categoryScore = inspectionReport.categoryScores?.[category.id] ?? 10;
      const categoryName = lang === 'zh' ? category.nameZh : category.name;

      // 章节标题
      doc.setFontSize(14);
      doc.setFont(undefined!, 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text(`${categoryName} (${categoryScore.toFixed(1)}/10)`, margin, yPos);
      yPos += 10;

      if (categoryIssues.length === 0) {
        doc.setFontSize(10);
        doc.setFont(undefined!, 'normal');
        doc.setTextColor(34, 197, 94);
        const allPassedText =
          lang === 'zh' ? '✓ 该章节所有检查项均通过' : '✓ All checks passed for this category';
        doc.text(allPassedText, margin + 5, yPos);
        yPos += 8;
      } else {
        categoryIssues.forEach((issue) => {
          // 检查是否需要新页面
          if (yPos > pageHeight - 30) {
            doc.addPage();
            yPos = margin;
          }

          const issueScore = issue.score ?? 10;
          doc.setFontSize(10);
          doc.setFont(undefined!, 'bold');

          // 根据问题类型设置颜色
          if (issue.type === 'error') {
            doc.setTextColor(239, 68, 68);
          } else if (issue.type === 'warning') {
            doc.setTextColor(234, 179, 8);
          } else if (issue.type === 'suggestion') {
            doc.setTextColor(59, 130, 246);
          } else {
            doc.setTextColor(50, 50, 50);
          }

          const issueTitle = `${issue.type === 'error' ? '✗' : issue.type === 'warning' ? '⚠' : 'ℹ'} ${issue.title} (${issueScore.toFixed(1)}/10)`;
          doc.text(issueTitle, margin + 5, yPos);
          yPos += 6;

          doc.setFont(undefined!, 'normal');
          doc.setTextColor(100, 100, 100);
          const descLines = doc.splitTextToSize(issue.description, pageWidth - 2 * margin - 10);
          doc.text(descLines, margin + 5, yPos);
          yPos += descLines.length * 5 + 5;
        });
      }
      yPos += 5;
    });

    // 保存PDF
    const fileName =
      lang === 'zh'
        ? `${robotName}_检查报告_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`
        : `${robotName}_inspection_report_${dateStr.replace(/[\/\s:]/g, '_')}.pdf`;
    doc.save(fileName);
  }, [lang, robotName]);

  return {
    handleDownloadPDF,
  };
}
