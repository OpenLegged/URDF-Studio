import { useCallback, useEffect, useRef, useState } from 'react';
import type { RobotState } from '@/types';
import type { Language, TranslationKeys } from '@/shared/i18n';
import { runRobotInspection } from '../services/aiService';
import {
  buildInspectionRunContext,
  type InspectionRunContext,
} from '../utils/inspectionRunContext';
import {
  countSelectedInspectionProfileItems,
  toSelectedInspectionProfileMap,
  type SelectedInspectionProfiles,
} from '../utils/inspectionProfileSelection';
import type { InspectionProgressState } from '../components/InspectionProgress';
import { useInspectionReport } from './useInspectionReport';

interface UseInspectionExecutionOptions {
  lang: Language;
  robot: RobotState;
  t: TranslationKeys;
}

const cloneInspectionRobotSnapshot = (robot: RobotState): RobotState => {
  if (typeof structuredClone === 'function') {
    return structuredClone(robot);
  }

  return JSON.parse(JSON.stringify(robot)) as RobotState;
};

export function useInspectionExecution({ robot, lang, t }: UseInspectionExecutionOptions) {
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionProgress, setInspectionProgress] = useState<InspectionProgressState | null>(
    null,
  );
  const [inspectionCancellationNotice, setInspectionCancellationNotice] = useState<string | null>(
    null,
  );
  const [inspectionElapsedSeconds, setInspectionElapsedSeconds] = useState(0);
  const [inspectionRunContext, setInspectionRunContext] = useState<InspectionRunContext | null>(
    null,
  );
  const {
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
  } = useInspectionReport({ robot, lang });

  const isMountedRef = useRef(false);
  const inspectionRunIdRef = useRef(0);
  const inspectionAbortControllerRef = useRef<AbortController | null>(null);
  const inspectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearInspectionTimer = useCallback(() => {
    if (inspectionTimerRef.current !== null) {
      clearInterval(inspectionTimerRef.current);
      inspectionTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      inspectionRunIdRef.current += 1;
      inspectionAbortControllerRef.current?.abort();
      inspectionAbortControllerRef.current = null;
      clearInspectionTimer();
    };
  }, [clearInspectionTimer]);

  const runInspection = async (selectedProfiles: SelectedInspectionProfiles) => {
    if (isInspecting) {
      return;
    }

    inspectionRunIdRef.current += 1;
    const runId = inspectionRunIdRef.current;
    const isRunActive = () => isMountedRef.current && inspectionRunIdRef.current === runId;
    const robotSnapshot = cloneInspectionRobotSnapshot(robot);
    const abortController = new AbortController();
    inspectionAbortControllerRef.current = abortController;

    clearInspectionTimer();
    setIsInspecting(true);
    setInspectionCancellationNotice(null);
    resetReport();
    setInspectionElapsedSeconds(0);

    const totalItems = countSelectedInspectionProfileItems(selectedProfiles);
    const selectedItemsMap = toSelectedInspectionProfileMap(selectedProfiles);

    if (totalItems === 0) {
      if (inspectionAbortControllerRef.current === abortController) {
        inspectionAbortControllerRef.current = null;
      }
      setInspectionProgress(null);
      setInspectionRunContext(null);
      setIsInspecting(false);
      return;
    }

    setInspectionRunContext(
      buildInspectionRunContext(robotSnapshot, selectedProfiles, lang, t.inspectionNormalizedModel),
    );
    setInspectionProgress({
      stage: 'preparing-context',
      selectedCount: totalItems,
    });
    inspectionTimerRef.current = setInterval(() => {
      if (!isRunActive()) {
        clearInspectionTimer();
        return;
      }

      setInspectionElapsedSeconds((current) => current + 1);
    }, 1000);

    try {
      const report = await runRobotInspection(robotSnapshot, selectedItemsMap, lang, {
        signal: abortController.signal,
        onStageChange: (stage) => {
          if (!isRunActive()) {
            return;
          }

          setInspectionProgress({
            stage,
            selectedCount: totalItems,
          });
        },
      });

      if (!isRunActive()) {
        return;
      }

      setInspectionResult(report, robotSnapshot);
    } catch (error) {
      console.error('Inspection Error', error);
    } finally {
      if (isRunActive()) {
        if (inspectionAbortControllerRef.current === abortController) {
          inspectionAbortControllerRef.current = null;
        }
        clearInspectionTimer();
        setInspectionProgress(null);
        setInspectionElapsedSeconds(0);
        setIsInspecting(false);
      }
    }
  };

  const stopInspection = useCallback(() => {
    inspectionRunIdRef.current += 1;
    inspectionAbortControllerRef.current?.abort();
    inspectionAbortControllerRef.current = null;
    clearInspectionTimer();
    setInspectionProgress(null);
    setInspectionRunContext(null);
    setInspectionElapsedSeconds(0);
    resetReport();
    setIsInspecting(false);
    setInspectionCancellationNotice(t.inspectionCancelledNoReport);
  }, [clearInspectionTimer, resetReport, t.inspectionCancelledNoReport]);

  const dismissInspectionCancellationNotice = useCallback(() => {
    setInspectionCancellationNotice(null);
  }, []);

  const resetInspection = useCallback(() => {
    inspectionAbortControllerRef.current?.abort();
    inspectionAbortControllerRef.current = null;
    inspectionRunIdRef.current += 1;
    clearInspectionTimer();
    setInspectionProgress(null);
    setInspectionRunContext(null);
    setInspectionElapsedSeconds(0);
    resetReport();
    setIsInspecting(false);
    setInspectionCancellationNotice(null);
  }, [clearInspectionTimer, resetReport]);

  return {
    clearSavingReportState,
    dismissInspectionCancellationNotice,
    downloadReport,
    inspectionCancellationNotice,
    inspectionElapsedSeconds,
    inspectionProgress,
    inspectionReport,
    inspectionRunContext,
    isInspecting,
    isSavingReport,
    reportRobot,
    resetInspection,
    retestItem,
    retestingItem,
    runInspection,
    saveReport,
    stopInspection,
  };
}
