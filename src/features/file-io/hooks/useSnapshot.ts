/**
 * useSnapshot Hook
 * Handle snapshot capture operations
 * Works with SnapshotManager component from shared/components/3d
 */

import { useCallback, useRef } from 'react';
import { useUIStore } from '@/store';

interface UseSnapshotOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  showToast?: (message: string, type: 'info' | 'success' | 'error') => void;
}

interface UseSnapshotReturn {
  snapshotActionRef: React.RefObject<(() => void) | null>;
  handleSnapshot: () => void;
}

export function useSnapshot(options: UseSnapshotOptions = {}): UseSnapshotReturn {
  const { onSuccess, onError, showToast } = options;
  const lang = useUIStore((s) => s.language);
  const snapshotActionRef = useRef<(() => void) | null>(null);

  const handleSnapshot = useCallback(() => {
    if (snapshotActionRef.current) {
      try {
        // Trigger the snapshot logic inside the Three.js context
        snapshotActionRef.current();
        // Show progress toast
        showToast?.(
          lang === 'zh' ? '正在生成高清快照...' : 'Generating High-Res Snapshot...',
          'info'
        );
        onSuccess?.();
      } catch (e) {
        console.error('Snapshot failed:', e);
        showToast?.(
          lang === 'zh' ? '快照失败' : 'Snapshot failed',
          'error'
        );
        onError?.(e as Error);
      }
    } else {
      console.warn('Snapshot action not bound');
    }
  }, [lang, onSuccess, onError, showToast]);

  return {
    snapshotActionRef,
    handleSnapshot,
  };
}
