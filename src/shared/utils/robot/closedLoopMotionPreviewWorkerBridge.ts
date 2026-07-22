import type {
  ClosedLoopDrivenJointMotionResult,
  ClosedLoopMotionCompensation,
} from '@/core/robot/closedLoops';
import { resolveDefaultWorkerCount } from '@/core/workers/workerPoolClient';
import type { RobotState } from '@/types';
import type {
  ClosedLoopMotionPreviewState,
  ClosedLoopMotionPreviewWorkerRequest,
  ClosedLoopMotionPreviewWorkerResponse,
  ClosedLoopMotionPreviewWorkerSetBaseRobotRequest,
  ClosedLoopMotionPreviewWorkerSolveOptions,
} from './closedLoopMotionPreviewContract';

interface PendingRequest {
  resolve: (value: ClosedLoopDrivenJointMotionResult) => void;
  reject: (error: unknown) => void;
  workerEntry: ClosedLoopMotionPreviewWorkerPoolEntry;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface ClosedLoopMotionPreviewWorkerPoolEntry {
  worker: Worker;
  pendingCount: number;
  baseRobot:
    | Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>
    | null;
}

const pendingRequests = new Map<number, PendingRequest>();
const DEFAULT_CLOSED_LOOP_PREVIEW_REQUEST_TIMEOUT_MS = 30 * 1000;
let requestIdCounter = 0;
const workerPool: ClosedLoopMotionPreviewWorkerPoolEntry[] = [];
let workerUnavailable = false;

function createWorkerTimeoutError(requestId: number): Error {
  return new Error(
    `Closed-loop motion preview worker did not respond within ${DEFAULT_CLOSED_LOOP_PREVIEW_REQUEST_TIMEOUT_MS} ms. Request id: ${requestId}.`,
  );
}

function clearPendingRequest(requestId: number): PendingRequest | null {
  const pendingRequest = pendingRequests.get(requestId) ?? null;
  if (!pendingRequest) {
    return null;
  }

  pendingRequests.delete(requestId);
  if (pendingRequest.timeoutId !== undefined) {
    clearTimeout(pendingRequest.timeoutId);
    pendingRequest.timeoutId = undefined;
  }
  pendingRequest.workerEntry.pendingCount = Math.max(0, pendingRequest.workerEntry.pendingCount - 1);
  return pendingRequest;
}

function disposeWorkerPool(rejectPendingWith?: unknown): void {
  const rejectionReason =
    rejectPendingWith ?? new Error('Closed-loop motion preview worker disposed');

  workerPool.forEach((entry) => {
    entry.worker.removeEventListener('message', handleWorkerMessage);
    entry.worker.removeEventListener('error', handleWorkerError);
    entry.worker.removeEventListener('messageerror', handleWorkerMessageError);
    entry.worker.terminate();
    entry.pendingCount = 0;
  });
  workerPool.length = 0;

  Array.from(pendingRequests.entries()).forEach(([requestId, request]) => {
    clearPendingRequest(requestId);
    request.reject(rejectionReason);
  });
}

function handleWorkerMessage(event: MessageEvent<ClosedLoopMotionPreviewWorkerResponse>): void {
  const message = event.data;
  if (!message) {
    return;
  }

  const pendingRequest = clearPendingRequest(message.requestId);
  if (!pendingRequest) {
    return;
  }

  if (message.type === 'resolve-motion-preview-error') {
    pendingRequest.reject(new Error(message.error || 'Closed-loop motion preview worker failed'));
    return;
  }

  pendingRequest.resolve(message.solution);
}

function handleWorkerError(event: ErrorEvent): void {
  workerUnavailable = true;
  const error =
    event.error ?? new Error(event.message || 'Closed-loop motion preview worker failed');
  disposeWorkerPool(error);
}

function handleWorkerMessageError(): void {
  workerUnavailable = true;
  disposeWorkerPool(new Error('Closed-loop motion preview worker message transfer failed'));
}

function createPreviewWorker(): Worker {
  const worker = new Worker(
    new URL('../../workers/closedLoopMotionPreview.worker.ts', import.meta.url),
    { type: 'module' },
  );
  worker.addEventListener('message', handleWorkerMessage);
  worker.addEventListener('error', handleWorkerError);
  worker.addEventListener('messageerror', handleWorkerMessageError);
  return worker;
}

function resolveClosedLoopPreviewWorkerCount(): number {
  return Math.max(1, Math.min(4, resolveDefaultWorkerCount()));
}

function ensureWorkerPool(): ClosedLoopMotionPreviewWorkerPoolEntry {
  if (workerPool.length === 0) {
    const workerCount = resolveClosedLoopPreviewWorkerCount();
    for (let index = 0; index < workerCount; index += 1) {
      workerPool.push({
        worker: createPreviewWorker(),
        pendingCount: 0,
        baseRobot: null,
      });
    }
    workerUnavailable = false;
  }

  let bestEntry = workerPool[0];
  for (let index = 1; index < workerPool.length; index += 1) {
    if (workerPool[index].pendingCount < bestEntry.pendingCount) {
      bestEntry = workerPool[index];
    }
  }

  return bestEntry;
}

function registerRequestTimeout(requestId: number, pendingRequest: PendingRequest): void {
  pendingRequest.timeoutId = setTimeout(() => {
    workerUnavailable = true;
    disposeWorkerPool(createWorkerTimeoutError(requestId));
  }, DEFAULT_CLOSED_LOOP_PREVIEW_REQUEST_TIMEOUT_MS);
}

export async function resolveClosedLoopDrivenJointMotionWithWorker(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  jointId: string,
  angle: number,
  options: ClosedLoopMotionPreviewWorkerSolveOptions = {},
  previewState?: ClosedLoopMotionPreviewState,
): Promise<ClosedLoopDrivenJointMotionResult> {
  if (workerUnavailable && workerPool.length > 0) {
    throw new Error('Closed-loop motion preview worker is unavailable');
  }

  if (typeof Worker === 'undefined') {
    throw new Error('Web Worker is not available in this environment');
  }

  return new Promise<ClosedLoopDrivenJointMotionResult>((resolve, reject) => {
    const requestId = ++requestIdCounter;
    let workerEntry: ClosedLoopMotionPreviewWorkerPoolEntry;

    try {
      workerEntry = ensureWorkerPool();
    } catch (error) {
      workerUnavailable = true;
      disposeWorkerPool(error);
      reject(error);
      return;
    }

    try {
      if (workerEntry.baseRobot !== robot) {
        const setBaseRequest: ClosedLoopMotionPreviewWorkerSetBaseRobotRequest = {
          type: 'set-base-robot',
          robot,
        };
        workerEntry.worker.postMessage(setBaseRequest);
        workerEntry.baseRobot = robot;
      }
    } catch (error) {
      workerUnavailable = true;
      disposeWorkerPool(error);
      reject(error);
      return;
    }

    const request: Extract<
      ClosedLoopMotionPreviewWorkerRequest,
      { type: 'resolve-motion-preview' }
    > = {
      type: 'resolve-motion-preview',
      requestId,
      jointId,
      angle,
      options,
      previewState,
    };

    const pendingRequest: PendingRequest = { resolve, reject, workerEntry };
    pendingRequests.set(requestId, pendingRequest);
    workerEntry.pendingCount += 1;
    registerRequestTimeout(requestId, pendingRequest);

    try {
      workerEntry.worker.postMessage(request);
    } catch (error) {
      workerUnavailable = true;
      clearPendingRequest(requestId);
      disposeWorkerPool(error);
      reject(error);
    }
  });
}

export async function resolveClosedLoopJointMotionCompensationWithWorker(
  robot: Pick<RobotState, 'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'>,
  jointId: string,
  angle: number,
): Promise<ClosedLoopMotionCompensation> {
  const solution = await resolveClosedLoopDrivenJointMotionWithWorker(robot, jointId, angle);
  return {
    angles: solution.angles,
    quaternions: solution.quaternions,
  };
}

export function disposeClosedLoopMotionPreviewWorker(rejectPendingWith?: unknown): void {
  disposeWorkerPool(rejectPendingWith);
  workerUnavailable = false;
}
