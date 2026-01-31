/**
 * Inspection Report Template Component
 * Used for generating PDF reports with proper Chinese/English support
 */

import type { InspectionReport } from '@/types';
import { INSPECTION_CRITERIA } from '@/features/ai-assistant';

interface ReportTemplateProps {
  inspectionReport: InspectionReport;
  robotName: string;
  lang: 'zh' | 'en';
}

export function InspectionReportTemplate({ inspectionReport, robotName, lang }: ReportTemplateProps) {
  const overallScore = inspectionReport.overallScore ?? 0;
  const maxScore = inspectionReport.maxScore ?? 100;
  const scorePercentage = (overallScore / maxScore) * 100;

  // Color based on score
  const getScoreColor = (score: number, max: number) => {
    const pct = (score / max) * 100;
    if (pct >= 90) return '#22c55e'; // green
    if (pct >= 60) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  const scoreColor = getScoreColor(overallScore, maxScore);

  // Group issues by category
  const issuesByCategory: Record<string, typeof inspectionReport.issues> = {};
  INSPECTION_CRITERIA.forEach((category) => {
    issuesByCategory[category.id] = [];
  });
  inspectionReport.issues.forEach((issue) => {
    const categoryId = issue.category || 'physical';
    if (!issuesByCategory[categoryId]) issuesByCategory[categoryId] = [];
    issuesByCategory[categoryId].push(issue);
  });

  // Date string
  const now = new Date();
  const dateStr = now.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Text translations
  const t = {
    title: lang === 'zh' ? 'URDF 机器人检查报告' : 'URDF Robot Inspection Report',
    robotName: lang === 'zh' ? '机器人名称' : 'Robot Name',
    inspectionDate: lang === 'zh' ? '检查日期' : 'Inspection Date',
    overallScore: lang === 'zh' ? '总分' : 'Overall Score',
    summary: lang === 'zh' ? '检查总结' : 'Inspection Summary',
    allPassed: lang === 'zh' ? '该章节所有检查项均通过' : 'All checks passed for this category',
    error: 'Error',
    warning: 'Warning',
    suggestion: 'Suggestion',
  };

  return (
    <div id="inspection-report-pdf" style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>{t.title}</h1>
        <div style={styles.headerInfo}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>{t.robotName}:</span>
            <span style={styles.infoValue}>{robotName}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>{t.inspectionDate}:</span>
            <span style={styles.infoValue}>{dateStr}</span>
          </div>
        </div>
      </div>

      {/* Score Section */}
      <div style={styles.scoreSection}>
        <div style={styles.scoreRow}>
          <span style={styles.scoreLabel}>{t.overallScore}:</span>
          <span style={styles.scoreValue}>{overallScore.toFixed(1)}/{maxScore}</span>
        </div>
        <div style={styles.progressBar}>
          <div style={styles.progressBg}>
            <div style={{ ...styles.progressFill, width: `${scorePercentage}%`, backgroundColor: scoreColor }} />
          </div>
          <div style={styles.scorePercent}>{scorePercentage.toFixed(1)}%</div>
        </div>
      </div>

      {/* Summary */}
      <div style={styles.section}>
        <h2 style={styles.sectionTitle}>{t.summary}</h2>
        <p style={styles.summaryText}>{inspectionReport.summary}</p>
      </div>

      {/* Categories */}
      {INSPECTION_CRITERIA.map((category) => {
        const categoryIssues = issuesByCategory[category.id] || [];
        const categoryScore = inspectionReport.categoryScores?.[category.id] ?? 10;
        const categoryName = lang === 'zh' ? category.nameZh : category.name;

        return (
          <div key={category.id} style={styles.section}>
            <h2 style={styles.sectionTitle}>
              {categoryName} ({categoryScore.toFixed(1)}/10)
            </h2>

            {categoryIssues.length === 0 ? (
              <div style={styles.passedMessage}>
                {t.allPassed}
              </div>
            ) : (
              <div style={styles.issuesContainer}>
                {categoryIssues.map((issue, idx) => {
                  const issueScore = issue.score ?? 10;
                  let issueTypeLabel: string = issue.type;
                  if (issue.type === 'error') issueTypeLabel = t.error;
                  if (issue.type === 'warning') issueTypeLabel = t.warning;
                  if (issue.type === 'suggestion') issueTypeLabel = t.suggestion;

                  const icon = issue.type === 'error' ? '✗' : issue.type === 'warning' ? '⚠' : 'ℹ';

                  return (
                    <div key={idx} style={styles.issueCard}>
                      <div style={styles.issueHeader}>
                        <span style={{ ...styles.issueIcon, color: getScoreColor(issueScore, 10) }}>
                          {icon}
                        </span>
                        <span style={styles.issueTitle}>{issue.title}</span>
                        <span style={styles.issueScore}>{issueScore.toFixed(1)}/10</span>
                      </div>
                      <p style={styles.issueDescription}>{issue.description}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Footer */}
      <div style={styles.footer}>
        <p style={styles.footerText}>
          {lang === 'zh' ? '本报告由 URDF Studio 自动生成' : 'This report was generated by URDF Studio'}
        </p>
        <p style={styles.footerText}>
          {dateStr}
        </p>
      </div>
    </div>
  );
}

// Styles for PDF template - inline styles for proper print rendering
const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    padding: '40px 50px',
    maxWidth: '210mm',
    margin: '0 auto',
    color: '#1f2937',
    lineHeight: 1.6,
    fontSize: '14px',
  },

  header: {
    marginBottom: '30px',
    borderBottom: '2px solid #e5e7eb',
    paddingBottom: '20px',
  },

  title: {
    fontSize: '24px',
    fontWeight: '700',
    color: '#1f2937',
    margin: '0 0 15px 0',
    textAlign: 'center' as const,
  },

  headerInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },

  infoRow: {
    display: 'flex',
    gap: '10px',
    fontSize: '14px',
  },

  infoLabel: {
    fontWeight: '600',
    color: '#6b7280',
    minWidth: '100px',
  },

  infoValue: {
    color: '#374151',
  },

  scoreSection: {
    backgroundColor: '#f9fafb',
    padding: '20px',
    borderRadius: '8px',
    marginBottom: '30px',
  },

  scoreRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },

  scoreLabel: {
    fontSize: '16px',
    fontWeight: '600',
    color: '#374151',
  },

  scoreValue: {
    fontSize: '20px',
    fontWeight: '700',
    color: '#374151',
  },

  progressBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },

  progressBg: {
    flex: 1,
    height: '12px',
    backgroundColor: '#e5e7eb',
    borderRadius: '6px',
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    borderRadius: '6px',
    transition: 'width 0.3s ease',
  },

  scorePercent: {
    fontSize: '18px',
    fontWeight: '700',
    minWidth: '60px',
    textAlign: 'right' as const,
  },

  section: {
    marginBottom: '25px',
    pageBreakInside: 'avoid' as const,
  },

  sectionTitle: {
    fontSize: '18px',
    fontWeight: '600',
    color: '#1f2937',
    margin: '0 0 12px 0',
    paddingBottom: '8px',
    borderBottom: '1px solid #e5e7eb',
  },

  summaryText: {
    color: '#4b5563',
    fontSize: '14px',
    margin: '0',
    whiteSpace: 'pre-wrap' as const,
  },

  passedMessage: {
    color: '#22c55e',
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    backgroundColor: '#f0fdf4',
    borderRadius: '6px',
    border: '1px solid #bbf7d0',
  },

  issuesContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },

  issueCard: {
    padding: '15px',
    backgroundColor: '#f9fafb',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
  },

  issueHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '8px',
  },

  issueIcon: {
    fontSize: '16px',
    fontWeight: '700',
  },

  issueTitle: {
    flex: 1,
    fontSize: '14px',
    fontWeight: '600',
    color: '#374151',
  },

  issueScore: {
    fontSize: '12px',
    fontWeight: '700',
    color: '#6b7280',
  },

  issueDescription: {
    margin: '0',
    color: '#6b7280',
    fontSize: '13px',
    whiteSpace: 'pre-wrap' as const,
  },

  footer: {
    marginTop: '40px',
    paddingTop: '20px',
    borderTop: '1px solid #e5e7eb',
    textAlign: 'center' as const,
    color: '#9ca3af',
    fontSize: '12px',
  },

  footerText: {
    margin: '5px 0',
  },
};
