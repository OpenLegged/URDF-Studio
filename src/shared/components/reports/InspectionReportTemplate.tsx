/**
 * Inspection report template component.
 * Used for generating PDF reports with proper Chinese/English support
 */

import type { InspectionReport, RobotInspectionContext } from '@/types';
import { translations } from '@/shared/i18n';
import { buildInspectionEvidenceSummary } from '@/shared/utils/inspectionEvidenceSummary';

interface ReportTemplateProps {
  inspectionReport: InspectionReport;
  robotName: string;
  lang: 'zh' | 'en';
  inspectionContext?: RobotInspectionContext;
  profileLabels?: Record<string, string>;
}

export function InspectionReportTemplate({
  inspectionReport,
  robotName,
  lang,
  inspectionContext,
  profileLabels = {},
}: ReportTemplateProps) {
  const t = translations[lang];
  const overallScore = inspectionReport.overallScore ?? 0;
  const maxScore = inspectionReport.maxScore ?? 100;
  const scorePercentage = (overallScore / maxScore) * 100;
  const evidenceSummary = buildInspectionEvidenceSummary(inspectionContext, lang);

  // Color based on score
  const getScoreColor = (score: number, max: number) => {
    const pct = (score / max) * 100;
    if (pct >= 90) return PDF_COLORS.success;
    if (pct >= 60) return PDF_COLORS.warning;
    return PDF_COLORS.danger;
  };

  const scoreColor = getScoreColor(overallScore, maxScore);

  const issuesByProfile: Record<string, typeof inspectionReport.issues> = {};
  inspectionReport.issues.forEach((issue) => {
    const profileId = issue.profileId || 'unmapped';
    if (!issuesByProfile[profileId]) issuesByProfile[profileId] = [];
    issuesByProfile[profileId].push(issue);
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

  return (
    <div id="inspection-report-pdf" style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerBrand}>
          <img src="/logos/logo.png" alt="URDF Studio" style={styles.logo} />
          <h1 style={styles.title}>{t.inspectionReportTitle}</h1>
        </div>
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
      <div data-pdf-keep-together style={styles.scoreSection}>
        <div style={styles.scoreRow}>
          <span style={styles.scoreLabel}>{t.overallScore}:</span>
          <span style={styles.scoreValue}>
            {overallScore.toFixed(1)}/{maxScore}
          </span>
        </div>
        <div style={styles.progressBar}>
          <div style={styles.progressBg}>
            <div
              style={{
                ...styles.progressFill,
                width: `${scorePercentage}%`,
                backgroundColor: scoreColor,
              }}
            />
          </div>
          <div style={styles.scorePercent}>{scorePercentage.toFixed(1)}%</div>
        </div>
      </div>

      {/* Summary */}
      <div data-pdf-keep-together style={styles.section}>
        <h2 style={styles.sectionTitle}>{t.inspectionSummary}</h2>
        <p style={styles.summaryText}>{inspectionReport.summary}</p>

        {evidenceSummary ? (
          <div style={styles.evidenceSection}>
            <div style={styles.evidenceTitle}>{evidenceSummary.title}</div>
            <div style={styles.evidenceMetrics}>
              {evidenceSummary.metrics.map((metric) => (
                <div key={`${metric.label}:${metric.value}`} style={styles.evidenceMetric}>
                  <span style={styles.evidenceMetricLabel}>{metric.label}</span>
                  <span style={styles.evidenceMetricValue}>{metric.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Profiles */}
      {Object.entries(issuesByProfile).map(([profileId, profileIssues]) => {
        const profileScore = inspectionReport.profileScores?.[profileId] ?? 10;
        const profileName = profileLabels[profileId] || profileId;

        return (
          <div key={profileId} data-pdf-keep-together style={styles.section}>
            <h2 style={styles.sectionTitle}>
              {profileName} ({profileScore.toFixed(1)}/10)
            </h2>

            <div style={styles.profileMeta}>{profileId}</div>

            <div style={styles.issuesContainer}>
              {profileIssues.map((issue, idx) => {
                const issueScore = issue.score ?? 10;
                const icon = issue.type === 'error' ? '✗' : issue.type === 'warning' ? '⚠' : 'ℹ';

                return (
                  <div key={idx} data-pdf-keep-together style={styles.issueCard}>
                    <div style={styles.issueHeader}>
                      <span style={{ ...styles.issueIcon, color: getScoreColor(issueScore, 10) }}>
                        {icon}
                      </span>
                      <span style={styles.issueTitle}>{issue.title}</span>
                      <span style={styles.issueScore}>{issueScore.toFixed(1)}/10</span>
                    </div>
                    <div style={styles.issueProfile}>
                      {issue.profileId}.{issue.itemId}
                    </div>
                    <p style={styles.issueDescription}>{issue.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Footer */}
      <div style={styles.footer}>
        <p style={styles.footerText}>{t.reportGeneratedByUrdfStudio}</p>
        <p style={styles.footerText}>{dateStr}</p>
      </div>
    </div>
  );
}

const PDF_COLORS = {
  textPrimary: '#1f2937',
  textSecondary: '#374151',
  textMuted: '#6b7280',
  textLight: '#9ca3af',
  borderLight: '#e5e7eb',
  borderMedium: '#d1d5db',
  bgLight: '#f9fafb',
  success: '#22c55e',
  successSoft: '#f0fdf4',
  successBorder: '#bbf7d0',
  warning: '#eab308',
  danger: '#ef4444',
};

// Styles for PDF template - inline styles for proper print rendering
const styles: Record<string, React.CSSProperties> = {
  container: {
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
    padding: '40px 50px',
    maxWidth: '210mm',
    margin: '0 auto',
    color: PDF_COLORS.textPrimary,
    lineHeight: 1.6,
    fontSize: '14px',
  },

  header: {
    marginBottom: '30px',
    borderBottom: `2px solid ${PDF_COLORS.borderLight}`,
    paddingBottom: '20px',
  },

  title: {
    fontSize: '24px',
    fontWeight: '700',
    lineHeight: 1,
    color: PDF_COLORS.textPrimary,
    margin: 0,
  },

  headerBrand: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    marginBottom: '18px',
  },

  logo: {
    width: '36px',
    height: '36px',
    objectFit: 'contain' as const,
    transform: 'translateY(4px)',
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
    color: PDF_COLORS.textMuted,
    minWidth: '100px',
  },

  infoValue: {
    color: PDF_COLORS.textSecondary,
    overflowWrap: 'anywhere' as const,
  },

  scoreSection: {
    backgroundColor: PDF_COLORS.bgLight,
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
    color: PDF_COLORS.textSecondary,
  },

  scoreValue: {
    fontSize: '20px',
    fontWeight: '700',
    color: PDF_COLORS.textSecondary,
  },

  progressBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '15px',
  },

  progressBg: {
    flex: 1,
    height: '12px',
    backgroundColor: PDF_COLORS.borderLight,
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
    color: PDF_COLORS.textPrimary,
    margin: '0 0 12px 0',
    paddingBottom: '8px',
    borderBottom: `1px solid ${PDF_COLORS.borderLight}`,
  },

  summaryText: {
    color: '#4b5563', // gray-600
    fontSize: '14px',
    margin: '0',
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
  },

  evidenceSection: {
    marginTop: '16px',
    padding: '14px',
    borderRadius: '8px',
    border: `1px solid ${PDF_COLORS.borderMedium}`,
    backgroundColor: PDF_COLORS.bgLight,
  },

  evidenceTitle: {
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: PDF_COLORS.textMuted,
    marginBottom: '10px',
  },

  evidenceMetrics: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },

  evidenceMetric: {
    display: 'flex',
    gap: '8px',
    lineHeight: 1.6,
  },

  evidenceMetricLabel: {
    fontSize: '11px',
    fontWeight: '600',
    color: PDF_COLORS.textMuted,
    minWidth: '110px',
  },

  evidenceMetricValue: {
    fontSize: '11px',
    fontWeight: '700',
    color: '#111827', // gray-900
  },

  profileMeta: {
    marginTop: '4px',
    marginBottom: '12px',
    fontSize: '11px',
    color: PDF_COLORS.textMuted,
    overflowWrap: 'anywhere' as const,
  },

  passedMessage: {
    color: PDF_COLORS.success,
    fontSize: '13px',
    fontWeight: '500',
    padding: '12px',
    backgroundColor: PDF_COLORS.successSoft,
    borderRadius: '6px',
    border: `1px solid ${PDF_COLORS.successBorder}`,
  },

  issuesContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },

  issueCard: {
    padding: '15px',
    backgroundColor: PDF_COLORS.bgLight,
    borderRadius: '8px',
    border: `1px solid ${PDF_COLORS.borderLight}`,
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
    color: PDF_COLORS.textSecondary,
    overflowWrap: 'anywhere' as const,
  },

  issueScore: {
    fontSize: '12px',
    fontWeight: '700',
    color: PDF_COLORS.textMuted,
  },

  issueDescription: {
    margin: '0',
    color: PDF_COLORS.textMuted,
    fontSize: '13px',
    whiteSpace: 'pre-wrap' as const,
    overflowWrap: 'anywhere' as const,
  },

  issueProfile: {
    margin: '0 0 8px 0',
    fontSize: '11px',
    color: PDF_COLORS.textMuted,
    overflowWrap: 'anywhere' as const,
  },

  footer: {
    marginTop: '40px',
    paddingTop: '20px',
    borderTop: `1px solid ${PDF_COLORS.borderLight}`,
    textAlign: 'center' as const,
    color: PDF_COLORS.textLight,
    fontSize: '12px',
  },

  footerText: {
    margin: '5px 0',
  },
};
