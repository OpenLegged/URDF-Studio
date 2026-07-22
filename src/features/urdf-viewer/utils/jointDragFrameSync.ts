interface JointDragFrameSyncOptions {
  onFrame: (clientX: number, clientY: number) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}

export interface JointDragFrameSync {
  schedule: (clientX: number, clientY: number) => void;
  flush: () => void;
  cancel: () => void;
}

export function createJointDragFrameSync({
  onFrame,
  requestFrame = typeof window !== 'undefined' ? window.requestAnimationFrame.bind(window) : undefined,
  cancelFrame = typeof window !== 'undefined' ? window.cancelAnimationFrame.bind(window) : undefined,
}: JointDragFrameSyncOptions): JointDragFrameSync {
  let pendingPointer: { clientX: number; clientY: number } | null = null;
  let frameHandle: number | null = null;

  const flush = () => {
    if (frameHandle !== null && cancelFrame) {
      cancelFrame(frameHandle);
      frameHandle = null;
    }

    const nextPointer = pendingPointer;
    pendingPointer = null;

    if (!nextPointer) {
      return;
    }

    onFrame(nextPointer.clientX, nextPointer.clientY);
  };

  return {
    schedule(clientX, clientY) {
      if (frameHandle !== null) {
        pendingPointer = { clientX, clientY };
        return;
      }

      // Apply the leading pointer update in the event turn so a demand-driven
      // R3F render already sees the new joint pose. Only coalesce additional
      // events that arrive before the next browser frame.
      onFrame(clientX, clientY);

      if (!requestFrame) {
        return;
      }

      frameHandle = requestFrame(() => {
        frameHandle = null;
        const nextPointer = pendingPointer;
        pendingPointer = null;

        if (!nextPointer) {
          return;
        }

        onFrame(nextPointer.clientX, nextPointer.clientY);
      });
    },

    flush,

    cancel() {
      if (frameHandle !== null && cancelFrame) {
        cancelFrame(frameHandle);
      }

      frameHandle = null;
      pendingPointer = null;
    },
  };
}
