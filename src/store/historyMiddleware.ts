/**
 * History Middleware for Zustand
 * Provides undo/redo functionality for state management
 *
 * NOTE: This is a simplified helper. For production use with complex stores,
 * consider using the temporal middleware from 'zundo' package.
 *
 * Current implementation in robotStore uses inline history management.
 */

// History state structure
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

// Actions added by history management
export interface HistoryActions {
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

// Configuration options
export interface HistoryOptions {
  // Maximum history entries (default: 50)
  limit?: number;
}

/**
 * Creates a history manager for use within Zustand stores
 *
 * Usage in a store:
 * ```typescript
 * const useMyStore = create((set, get) => {
 *   const history = createHistoryManager<MyData>(initialData);
 *
 *   return {
 *     ...history.state,
 *     undo: () => {
 *       const result = history.undo();
 *       if (result) set(result);
 *     },
 *     // ...
 *   };
 * });
 * ```
 */
export function createHistoryManager<T>(
  initialState: T,
  options: HistoryOptions = {}
) {
  const { limit = 50 } = options;

  let history: HistoryState<T> = {
    past: [],
    present: initialState,
    future: [],
  };

  return {
    get state() {
      return history.present;
    },

    get history() {
      return history;
    },

    /**
     * Push current state to history and update to new state
     */
    push(newState: T): void {
      if (newState === history.present) return;

      history = {
        past: [...history.past, history.present].slice(-limit),
        present: newState,
        future: [],
      };
    },

    /**
     * Undo to previous state
     * Returns the previous state if available, null otherwise
     */
    undo(): T | null {
      if (history.past.length === 0) return null;

      const previous = history.past[history.past.length - 1];
      history = {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      };

      return previous;
    },

    /**
     * Redo to next state
     * Returns the next state if available, null otherwise
     */
    redo(): T | null {
      if (history.future.length === 0) return null;

      const next = history.future[0];
      history = {
        past: [...history.past, history.present],
        present: next,
        future: history.future.slice(1),
      };

      return next;
    },

    /**
     * Clear all history
     */
    clear(): void {
      history = {
        past: [],
        present: history.present,
        future: [],
      };
    },

    /**
     * Reset with new state and clear history
     */
    reset(newState: T): void {
      history = {
        past: [],
        present: newState,
        future: [],
      };
    },

    canUndo(): boolean {
      return history.past.length > 0;
    },

    canRedo(): boolean {
      return history.future.length > 0;
    },
  };
}
