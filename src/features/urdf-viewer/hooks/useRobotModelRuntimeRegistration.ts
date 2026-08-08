import { useEffect, useRef } from 'react';
import type { RuntimeRobotObject } from '@/shared/components/3d/runtimeRobotTypes';
import {
  setRegressionPrimaryRuntimeRobot,
  setRegressionRuntimeRobot,
} from '@/shared/debug/regressionState';
import type { ViewerDocumentLoadEvent } from '../types';

const VIEWER_READY_DOCUMENT_LOAD_EVENT = {
  status: 'ready',
  phase: 'ready',
  progressMode: null,
  progressPercent: 100,
  loadedCount: null,
  totalCount: null,
  message: null,
  error: null,
} satisfies ViewerDocumentLoadEvent;

interface UseRobotModelRuntimeRegistrationOptions {
  initialRobotPresent: boolean;
  regressionRuntimeScopeKey: string | null;
  robot: RuntimeRobotObject | null;
  isLoading: boolean;
  onDocumentLoadEvent: ((event: ViewerDocumentLoadEvent) => void) | undefined;
}

/** Publishes the mounted runtime and reports its ready transition. */
export function useRobotModelRuntimeRegistration({
  initialRobotPresent,
  regressionRuntimeScopeKey,
  robot,
  isLoading,
  onDocumentLoadEvent,
}: UseRobotModelRuntimeRegistrationOptions) {
  const hasRenderedRobotRef = useRef(initialRobotPresent);

  useEffect(() => {
    if (!regressionRuntimeScopeKey) {
      return;
    }

    return () => {
      setRegressionPrimaryRuntimeRobot(null);
      setRegressionRuntimeRobot(null);
    };
  }, [regressionRuntimeScopeKey]);

  useEffect(() => {
    if (!regressionRuntimeScopeKey || !robot) {
      return;
    }

    setRegressionPrimaryRuntimeRobot(robot);
    setRegressionRuntimeRobot(robot);
  }, [regressionRuntimeScopeKey, robot]);

  useEffect(() => {
    if (!robot || isLoading) {
      return;
    }

    onDocumentLoadEvent?.(VIEWER_READY_DOCUMENT_LOAD_EVENT);
  }, [isLoading, onDocumentLoadEvent, robot]);

  useEffect(() => {
    if (robot) {
      hasRenderedRobotRef.current = true;
    }
  }, [robot]);

  return hasRenderedRobotRef;
}
