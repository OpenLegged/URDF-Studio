/**
 * Selection Store - Manages selection state for robot elements
 * Handles link/joint selection and hover state for synchronized highlighting
 */
import { create } from 'zustand';

// Selection type matching RobotState['selection']
export interface Selection {
  type: 'link' | 'joint' | null;
  id: string | null;
  subType?: 'visual' | 'collision';
}

interface SelectionState {
  // Current selection
  selection: Selection;
  setSelection: (selection: Selection) => void;
  selectLink: (id: string, subType?: 'visual' | 'collision') => void;
  selectJoint: (id: string) => void;
  clearSelection: () => void;

  // Hover state for synchronized highlighting across components
  hoveredSelection: Selection;
  setHoveredSelection: (selection: Selection) => void;
  hoverLink: (id: string) => void;
  hoverJoint: (id: string) => void;
  clearHover: () => void;

  // Focus target for camera focusing
  focusTarget: string | null;
  setFocusTarget: (id: string | null) => void;
  focusOn: (id: string) => void;
}

const emptySelection: Selection = { type: null, id: null };

export const useSelectionStore = create<SelectionState>()((set) => ({
  // Current selection
  selection: emptySelection,
  setSelection: (selection) => set({ selection }),
  selectLink: (id, subType) => set({ selection: { type: 'link', id, subType } }),
  selectJoint: (id) => set({ selection: { type: 'joint', id } }),
  clearSelection: () => set({ selection: emptySelection }),

  // Hover state
  hoveredSelection: emptySelection,
  setHoveredSelection: (selection) => set({ hoveredSelection: selection }),
  hoverLink: (id) => set({ hoveredSelection: { type: 'link', id: id } }),
  hoverJoint: (id) => set({ hoveredSelection: { type: 'joint', id: id } }),
  clearHover: () => set({ hoveredSelection: emptySelection }),

  // Focus target
  focusTarget: null,
  setFocusTarget: (id) => set({ focusTarget: id }),
  focusOn: (id) => {
    set({ focusTarget: id });
    // Clear focus target after a short delay to allow re-triggering
    setTimeout(() => set({ focusTarget: null }), 100);
  },
}));

// Helper to check if selection exists in data
export function validateSelection(
  selection: Selection,
  links: Record<string, unknown>,
  joints: Record<string, unknown>
): boolean {
  if (!selection.id || !selection.type) return true; // Empty selection is valid

  if (selection.type === 'link') {
    return !!links[selection.id];
  }
  if (selection.type === 'joint') {
    return !!joints[selection.id];
  }
  return false;
}
