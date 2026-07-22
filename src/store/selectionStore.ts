/** Canonical workspace selection, hover, attention, and camera-focus state. */
import { create } from 'zustand';

import {
  areEntityRefsEqual,
  type AssemblyState,
  type EntityRef,
  type WorkspaceSelection,
} from '@/types';

export type WorkspaceSelectionValue = NonNullable<WorkspaceSelection>;
export type WorkspaceSelectionDetails = Omit<WorkspaceSelectionValue, 'entity'>;
export type LinkEntityRef = Extract<EntityRef, { type: 'link' }>;
export type JointEntityRef = Extract<EntityRef, { type: 'joint' }>;
export type TendonEntityRef = Extract<EntityRef, { type: 'tendon' }>;
export type HoverFreezeOwner = symbol;

export type SelectionGuard = (selection: WorkspaceSelectionValue) => boolean;

export interface SelectionMatchOptions {
  ignoreSubType?: boolean;
  ignoreObjectIndex?: boolean;
  ignoreHelperKind?: boolean;
  ignoreHighlightObjectId?: boolean;
}

export interface SelectionState {
  selection: WorkspaceSelection;
  interactionGuard: SelectionGuard | null;
  setInteractionGuard: (guard: SelectionGuard | null) => void;
  isInteractionAllowed: (selection: WorkspaceSelection) => boolean;
  setSelection: (selection: WorkspaceSelection) => void;
  selectAssembly: () => void;
  selectComponent: (componentId: string) => void;
  selectBridge: (bridgeId: string) => void;
  selectLink: (ref: LinkEntityRef, details?: WorkspaceSelectionDetails) => void;
  selectJoint: (ref: JointEntityRef, details?: WorkspaceSelectionDetails) => void;
  selectTendon: (ref: TendonEntityRef, details?: WorkspaceSelectionDetails) => void;
  clearSelection: () => void;

  hoveredSelection: WorkspaceSelection;
  deferredHoveredSelection: WorkspaceSelection;
  hoverFrozen: boolean;
  interactionHoverFrozen: boolean;
  interactionHoverFreezeOwners: ReadonlySet<HoverFreezeOwner>;
  hoverBlockCount: number;
  setHoverFrozen: (owner: HoverFreezeOwner, frozen: boolean) => void;
  beginHoverBlock: () => void;
  endHoverBlock: () => void;
  setHoveredSelection: (selection: WorkspaceSelection) => void;
  hoverAssembly: () => void;
  hoverComponent: (componentId: string) => void;
  hoverBridge: (bridgeId: string) => void;
  hoverLink: (ref: LinkEntityRef, details?: WorkspaceSelectionDetails) => void;
  hoverJoint: (ref: JointEntityRef, details?: WorkspaceSelectionDetails) => void;
  hoverTendon: (ref: TendonEntityRef, details?: WorkspaceSelectionDetails) => void;
  clearHover: () => void;

  attentionSelection: WorkspaceSelection;
  setAttentionSelection: (selection: WorkspaceSelection) => void;
  pulseSelection: (selection: WorkspaceSelection, durationMs?: number) => void;
  clearAttentionSelection: () => void;

  focusTarget: EntityRef | null;
  setFocusTarget: (ref: EntityRef | null) => void;
  focusOn: (ref: EntityRef, durationMs?: number) => void;
}

function createSelection(
  entity: EntityRef,
  details?: WorkspaceSelectionDetails,
): WorkspaceSelectionValue {
  return details ? { entity, ...details } : { entity };
}

export function matchesSelection(
  selection: WorkspaceSelection,
  target: WorkspaceSelection,
  options: SelectionMatchOptions = {},
): boolean {
  if (selection === null || target === null) {
    return selection === target;
  }
  if (!areEntityRefsEqual(selection.entity, target.entity)) {
    return false;
  }
  if (!options.ignoreSubType && selection.subType !== target.subType) {
    return false;
  }
  if (!options.ignoreObjectIndex && selection.objectIndex !== target.objectIndex) {
    return false;
  }
  if (!options.ignoreHelperKind && selection.helperKind !== target.helperKind) {
    return false;
  }
  if (
    !options.ignoreHighlightObjectId
    && selection.highlightObjectId !== target.highlightObjectId
  ) {
    return false;
  }
  return true;
}

function isSelectionAllowed(
  selection: WorkspaceSelection,
  guard: SelectionGuard | null,
): boolean {
  return selection === null || guard === null || guard(selection);
}

function sanitizeSelection(
  selection: WorkspaceSelection,
  guard: SelectionGuard | null,
): WorkspaceSelection {
  return isSelectionAllowed(selection, guard) ? selection : null;
}

function resolveSelectionUpdate(
  state: Pick<SelectionState, 'selection' | 'interactionGuard'>,
  selection: WorkspaceSelection,
): Pick<SelectionState, 'selection'> | typeof state {
  if (
    !isSelectionAllowed(selection, state.interactionGuard)
    || matchesSelection(state.selection, selection)
  ) {
    return state;
  }
  return { selection };
}

function resolveHoverStateUpdate(
  state: Pick<
    SelectionState,
    | 'hoverFrozen'
    | 'hoverBlockCount'
    | 'hoveredSelection'
    | 'deferredHoveredSelection'
    | 'interactionGuard'
  >,
  selection: WorkspaceSelection,
) {
  const nextSelection = sanitizeSelection(selection, state.interactionGuard);
  if (state.hoverBlockCount > 0) {
    return selection === null && state.deferredHoveredSelection !== null
      ? { deferredHoveredSelection: null }
      : state;
  }
  if (state.hoverFrozen) {
    return matchesSelection(state.deferredHoveredSelection, nextSelection)
      ? state
      : { deferredHoveredSelection: nextSelection };
  }
  return matchesSelection(state.hoveredSelection, nextSelection)
    ? state
    : { hoveredSelection: nextSelection };
}

function resolveHoverFreezeState(
  state: Pick<
    SelectionState,
    | 'hoverFrozen'
    | 'interactionHoverFrozen'
    | 'hoverBlockCount'
    | 'hoveredSelection'
    | 'deferredHoveredSelection'
    | 'interactionGuard'
  >,
  interactionHoverFrozen: boolean,
  hoverBlockCount: number,
) {
  const nextBlockCount = Math.max(0, hoverBlockCount);
  const nextHoverFrozen = interactionHoverFrozen || nextBlockCount > 0;
  const hoveredSelection = sanitizeSelection(
    state.hoveredSelection,
    state.interactionGuard,
  );
  const deferredHoveredSelection = sanitizeSelection(
    state.deferredHoveredSelection,
    state.interactionGuard,
  );

  if (nextBlockCount > 0) {
    const enteringBlock = state.hoverBlockCount === 0;
    const nextDeferredSelection = enteringBlock && !state.interactionHoverFrozen
      ? hoveredSelection
      : deferredHoveredSelection;
    if (
      state.interactionHoverFrozen === interactionHoverFrozen
      && state.hoverBlockCount === nextBlockCount
      && state.hoverFrozen === nextHoverFrozen
      && state.hoveredSelection === null
      && matchesSelection(state.deferredHoveredSelection, nextDeferredSelection)
    ) {
      return state;
    }
    return {
      interactionHoverFrozen,
      hoverBlockCount: nextBlockCount,
      hoverFrozen: nextHoverFrozen,
      hoveredSelection: null,
      deferredHoveredSelection: nextDeferredSelection,
    };
  }

  if (interactionHoverFrozen) {
    const enteringInteractionFreeze = !state.interactionHoverFrozen;
    const nextDeferredSelection = enteringInteractionFreeze
      ? hoveredSelection
      : deferredHoveredSelection;
    if (
      state.interactionHoverFrozen === interactionHoverFrozen
      && state.hoverBlockCount === nextBlockCount
      && state.hoverFrozen === nextHoverFrozen
      && matchesSelection(state.hoveredSelection, hoveredSelection)
      && matchesSelection(state.deferredHoveredSelection, nextDeferredSelection)
    ) {
      return state;
    }
    return {
      interactionHoverFrozen,
      hoverBlockCount: nextBlockCount,
      hoverFrozen: nextHoverFrozen,
      hoveredSelection,
      deferredHoveredSelection: nextDeferredSelection,
    };
  }

  const nextHoveredSelection = state.hoverFrozen
    ? deferredHoveredSelection
    : hoveredSelection;
  if (
    state.interactionHoverFrozen === interactionHoverFrozen
    && state.hoverBlockCount === nextBlockCount
    && state.hoverFrozen === nextHoverFrozen
    && matchesSelection(state.hoveredSelection, nextHoveredSelection)
    && state.deferredHoveredSelection === null
  ) {
    return state;
  }
  return {
    interactionHoverFrozen,
    hoverBlockCount: nextBlockCount,
    hoverFrozen: nextHoverFrozen,
    hoveredSelection: nextHoveredSelection,
    deferredHoveredSelection: null,
  };
}

function hasOwnEntry(record: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function getComponent(
  workspace: AssemblyState,
  componentId: string,
): AssemblyState['components'][string] | null {
  return hasOwnEntry(workspace.components, componentId)
    ? workspace.components[componentId] ?? null
    : null;
}

/** Exact canonical lookup. Display names and renderer-global IDs are never considered. */
export function validateEntityRef(workspace: AssemblyState, ref: EntityRef): boolean {
  switch (ref.type) {
    case 'assembly':
      return true;
    case 'component':
      return hasOwnEntry(workspace.components, ref.componentId);
    case 'bridge':
      return hasOwnEntry(workspace.bridges, ref.bridgeId);
    case 'link': {
      const component = getComponent(workspace, ref.componentId);
      return Boolean(component && hasOwnEntry(component.robot.links, ref.entityId));
    }
    case 'joint': {
      const component = getComponent(workspace, ref.componentId);
      return Boolean(component && hasOwnEntry(component.robot.joints, ref.entityId));
    }
    case 'tendon': {
      const component = getComponent(workspace, ref.componentId);
      return Boolean(
        component?.robot.inspectionContext?.mjcf?.tendons.some(
          (tendon) => tendon.name === ref.entityId,
        ),
      );
    }
  }
}

function createFallbackComponentSelection(
  workspace: AssemblyState,
  activeComponentId: string | null | undefined,
): WorkspaceSelection {
  const componentId = activeComponentId && hasOwnEntry(workspace.components, activeComponentId)
    ? activeComponentId
    : Object.keys(workspace.components)[0];
  return componentId
    ? { entity: { type: 'component', componentId } }
    : { entity: { type: 'assembly' } };
}

/** Repair a stale committed selection without guessing entity ownership from IDs. */
export function repairWorkspaceSelection(
  workspace: AssemblyState,
  selection: WorkspaceSelection,
  activeComponentId: string | null | undefined,
): WorkspaceSelection {
  if (selection === null || validateEntityRef(workspace, selection.entity)) {
    return selection;
  }
  const ref = selection.entity;
  if (
    (ref.type === 'link' || ref.type === 'joint' || ref.type === 'tendon')
    && hasOwnEntry(workspace.components, ref.componentId)
  ) {
    return { entity: { type: 'component', componentId: ref.componentId } };
  }
  return createFallbackComponentSelection(workspace, activeComponentId);
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

export const useSelectionStore = create<SelectionState>()((set, get) => {
  let attentionTimeout: ReturnType<typeof setTimeout> | null = null;
  let focusResetTimeout: ReturnType<typeof setTimeout> | null = null;
  let focusRefocusTimeout: ReturnType<typeof setTimeout> | null = null;

  const cancelAttentionTimeout = () => {
    if (attentionTimeout !== null) {
      clearTimeout(attentionTimeout);
      attentionTimeout = null;
    }
  };
  const cancelFocusTimeouts = () => {
    if (focusResetTimeout !== null) {
      clearTimeout(focusResetTimeout);
      focusResetTimeout = null;
    }
    if (focusRefocusTimeout !== null) {
      clearTimeout(focusRefocusTimeout);
      focusRefocusTimeout = null;
    }
  };
  const scheduleFocusReset = (durationMs: number) => {
    focusResetTimeout = setTimeout(() => {
      focusResetTimeout = null;
      set({ focusTarget: null });
    }, Math.max(0, durationMs));
    unrefTimer(focusResetTimeout);
  };
  const setCanonicalSelection = (selection: WorkspaceSelection) => {
    set((state) => resolveSelectionUpdate(state, selection));
  };
  const setSelectedEntity = (entity: EntityRef, details?: WorkspaceSelectionDetails) => {
    setCanonicalSelection(createSelection(entity, details));
  };
  const setHoveredEntity = (entity: EntityRef, details?: WorkspaceSelectionDetails) => {
    set((state) => resolveHoverStateUpdate(state, createSelection(entity, details)));
  };

  return {
    selection: null,
    interactionGuard: null,
    setInteractionGuard: (guard) =>
      set((state) => {
        const hoveredSelection = sanitizeSelection(state.hoveredSelection, guard);
        const deferredHoveredSelection = sanitizeSelection(
          state.deferredHoveredSelection,
          guard,
        );
        return state.interactionGuard === guard
          && matchesSelection(state.hoveredSelection, hoveredSelection)
          && matchesSelection(state.deferredHoveredSelection, deferredHoveredSelection)
          ? state
          : { interactionGuard: guard, hoveredSelection, deferredHoveredSelection };
      }),
    isInteractionAllowed: (selection) => isSelectionAllowed(selection, get().interactionGuard),
    setSelection: setCanonicalSelection,
    selectAssembly: () => setSelectedEntity({ type: 'assembly' }),
    selectComponent: (componentId) => setSelectedEntity({ type: 'component', componentId }),
    selectBridge: (bridgeId) => setSelectedEntity({ type: 'bridge', bridgeId }),
    selectLink: (ref, details) => setSelectedEntity(ref, details),
    selectJoint: (ref, details) => setSelectedEntity(ref, details),
    selectTendon: (ref, details) => setSelectedEntity(ref, details),
    clearSelection: () => setCanonicalSelection(null),

    hoveredSelection: null,
    deferredHoveredSelection: null,
    hoverFrozen: false,
    interactionHoverFrozen: false,
    interactionHoverFreezeOwners: new Set<HoverFreezeOwner>(),
    hoverBlockCount: 0,
    setHoverFrozen: (owner, frozen) =>
      set((state) => {
        const ownerAlreadyRegistered = state.interactionHoverFreezeOwners.has(owner);
        if (ownerAlreadyRegistered === frozen) {
          return state;
        }
        const interactionHoverFreezeOwners = new Set(
          state.interactionHoverFreezeOwners,
        );
        if (frozen) {
          interactionHoverFreezeOwners.add(owner);
        } else {
          interactionHoverFreezeOwners.delete(owner);
        }
        const hoverState = resolveHoverFreezeState(
          state,
          interactionHoverFreezeOwners.size > 0,
          state.hoverBlockCount,
        );
        return hoverState === state
          ? { interactionHoverFreezeOwners }
          : { ...hoverState, interactionHoverFreezeOwners };
      }),
    beginHoverBlock: () =>
      set((state) =>
        resolveHoverFreezeState(
          state,
          state.interactionHoverFrozen,
          state.hoverBlockCount + 1,
        ),
      ),
    endHoverBlock: () =>
      set((state) =>
        resolveHoverFreezeState(
          state,
          state.interactionHoverFrozen,
          state.hoverBlockCount - 1,
        ),
      ),
    setHoveredSelection: (selection) =>
      set((state) => resolveHoverStateUpdate(state, selection)),
    hoverAssembly: () => setHoveredEntity({ type: 'assembly' }),
    hoverComponent: (componentId) => setHoveredEntity({ type: 'component', componentId }),
    hoverBridge: (bridgeId) => setHoveredEntity({ type: 'bridge', bridgeId }),
    hoverLink: (ref, details) => setHoveredEntity(ref, details),
    hoverJoint: (ref, details) => setHoveredEntity(ref, details),
    hoverTendon: (ref, details) => setHoveredEntity(ref, details),
    clearHover: () =>
      set((state) => resolveHoverStateUpdate(state, null)),

    attentionSelection: null,
    setAttentionSelection: (selection) => {
      cancelAttentionTimeout();
      set((state) =>
        matchesSelection(state.attentionSelection, selection)
          ? state
          : { attentionSelection: selection },
      );
    },
    pulseSelection: (selection, durationMs = 2600) => {
      cancelAttentionTimeout();
      if (selection === null) {
        set({ attentionSelection: null });
        return;
      }
      set({ attentionSelection: selection });
      attentionTimeout = setTimeout(() => {
        attentionTimeout = null;
        set({ attentionSelection: null });
      }, Math.max(0, durationMs));
      unrefTimer(attentionTimeout);
    },
    clearAttentionSelection: () => {
      cancelAttentionTimeout();
      set({ attentionSelection: null });
    },

    focusTarget: null,
    setFocusTarget: (ref) => {
      cancelFocusTimeouts();
      set((state) =>
        areEntityRefsEqual(state.focusTarget, ref) ? state : { focusTarget: ref },
      );
    },
    focusOn: (ref, durationMs = 1500) => {
      cancelFocusTimeouts();
      if (areEntityRefsEqual(get().focusTarget, ref)) {
        set({ focusTarget: null });
        focusRefocusTimeout = setTimeout(() => {
          focusRefocusTimeout = null;
          set({ focusTarget: ref });
          scheduleFocusReset(durationMs);
        }, 0);
        unrefTimer(focusRefocusTimeout);
        return;
      }
      set({ focusTarget: ref });
      scheduleFocusReset(durationMs);
    },
  };
});
