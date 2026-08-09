import { useCallback, useEffect, useRef, useState } from 'react';
import type { InspectionReport, RobotState } from '@/types';
import type { Language } from '@/shared/i18n';
import { runRobotInspection } from '../services/aiService';
import { exportInspectionReportPdf } from '../utils/pdfExport';
import { recalculateReportMetrics, type RetestingItemState } from '../components/inspectionModalState';

interface UseInspectionReportOptions {
  lang: Language;
  robot: RobotState;
}

export function useInspectionReport({ robot, lang }: UseInspectionReportOptions) {
  const [inspectionReport, setInspectionReport] = useState<InspectionReport | null>(null);
  const [inspectionRobotSnapshot, setInspectionRobotSnapshot] = useState<RobotState | null>(null);
  const [isSavingReport, setIsSavingReport] = useState(false);
  const [retestingItem, setRetestingItem] = useState<RetestingItemState | null>(null);
  const isMountedRef = useRef(false);
  const retestRequestIdRef = useRef(0);
  const reportRobot = inspectionRobotSnapshot ?? robot;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      retestRequestIdRef.current += 1;
    };
  }, []);

  const resetReport = useCallback(() => {
    setInspectionReport(null);
    setInspectionRobotSnapshot(null);
    setIsSavingReport(false);
    setRetestingItem(null);
  }, []);

  const setInspectionResult = useCallback(
    (report: InspectionReport | null, robotSnapshot: RobotState) => {
      setInspectionRobotSnapshot(report ? robotSnapshot : null);
      setInspectionReport(report);
    },
    [],
  );

  const retestItem = async (profileId: string, itemId: string) => {
    const requestId = retestRequestIdRef.current + 1;
    retestRequestIdRef.current = requestId;
    const isRequestActive = () => isMountedRef.current && retestRequestIdRef.current === requestId;

    setRetestingItem({ profileId, itemId });

    try {
      const selectedItemsMap: Record<string, string[]> = {
        [profileId]: [itemId],
      };
      const report = await runRobotInspection(reportRobot, selectedItemsMap, lang);
      if (!isRequestActive() || !report || !inspectionReport) {
        return;
      }

      const updatedIssues = inspectionReport.issues.filter(
        (issue) => !(issue.profileId === profileId && issue.itemId === itemId),
      );
      const nextIssues = report.issues.filter(
        (issue) => issue.profileId === profileId && issue.itemId === itemId,
      );
      const mergedIssues = [...updatedIssues, ...nextIssues] as InspectionReport['issues'];
      const nextMetrics = recalculateReportMetrics(mergedIssues, inspectionReport.maxScore);

      setInspectionReport({
        ...inspectionReport,
        issues: mergedIssues,
        ...nextMetrics,
      });
    } catch (error) {
      if (!isRequestActive()) {
        return;
      }
      console.error('Retest Error', error);
    } finally {
      if (isRequestActive()) {
        setRetestingItem(null);
      }
    }
  };

  const downloadReport = () =>
    exportInspectionReportPdf({
      inspectionReport,
      robotName: reportRobot.name,
      lang,
      inspectionContext: reportRobot.inspectionContext,
    });

  const saveReport = async () => {
    setIsSavingReport(true);

    try {
      await downloadReport();
    } finally {
      if (isMountedRef.current) {
        setIsSavingReport(false);
      }
    }
  };

  const clearSavingReportState = useCallback(() => {
    setIsSavingReport(false);
  }, []);

  return {
    clearSavingReportState,
    downloadReport,
    inspectionReport,
    isSavingReport,
    reportRobot,
    resetReport,
    retestItem,
    retestingItem,
    saveReport,
    setInspectionResult,
  };
}
