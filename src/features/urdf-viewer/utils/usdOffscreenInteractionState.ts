import * as THREE from 'three';

import type { OffscreenViewerInteractionSelection } from './usdOffscreenViewerProtocol.ts';

export type UsdOffscreenMeshRole = 'visual' | 'collision';

export interface UsdOffscreenRuntimeMeshMeta {
  linkPath: string;
  meshId: string;
  objectIndex?: number;
  authoredOrder?: number;
  role: UsdOffscreenMeshRole;
}

export interface UsdOffscreenRuntimeMeshIndex {
  meshMetaByObject: Map<THREE.Object3D, UsdOffscreenRuntimeMeshMeta>;
  meshesByLinkKey: Map<string, THREE.Mesh[]>;
  pickMeshes: THREE.Mesh[];
  helperTargets: THREE.Object3D[];
}

export interface UsdOffscreenInteractionStateOptions<THighlightSnapshot> {
  restoreHighlight: (mesh: THREE.Mesh, snapshot: THighlightSnapshot) => void;
}

export interface UsdOffscreenInteractionState<THighlightSnapshot> {
  readonly selection: OffscreenViewerInteractionSelection | null;
  readonly hoveredSelection: OffscreenViewerInteractionSelection | null;
  readonly lastEmittedHover: OffscreenViewerInteractionSelection | null;
  readonly meshMetaByObject: ReadonlyMap<THREE.Object3D, UsdOffscreenRuntimeMeshMeta>;
  readonly meshesByLinkKey: ReadonlyMap<string, THREE.Mesh[]>;
  readonly pickMeshes: THREE.Mesh[];
  readonly helperTargets: THREE.Object3D[];
  readonly highlightedMeshes: readonly THREE.Mesh[];
  readonly raycaster: THREE.Raycaster;
  readonly pointer: THREE.Vector2;
  setSelection: (selection: OffscreenViewerInteractionSelection | null | undefined) => void;
  setHoveredSelection: (selection: OffscreenViewerInteractionSelection | null | undefined) => void;
  setLastEmittedHover: (selection: OffscreenViewerInteractionSelection | null | undefined) => void;
  replaceMeshIndex: (index: UsdOffscreenRuntimeMeshIndex) => void;
  replaceHelperTargets: (targets: THREE.Object3D[]) => void;
  getHighlight: (mesh: THREE.Mesh) => THighlightSnapshot | undefined;
  setHighlight: (mesh: THREE.Mesh, snapshot: THighlightSnapshot) => void;
  clearHighlights: () => void;
  resetStageResources: () => void;
  resetAll: () => void;
}

export function areUsdOffscreenSelectionsEqual(
  left: OffscreenViewerInteractionSelection | null | undefined,
  right: OffscreenViewerInteractionSelection | null | undefined,
): boolean {
  return (
    (left?.type ?? null) === (right?.type ?? null) &&
    (left?.id ?? null) === (right?.id ?? null) &&
    left?.subType === right?.subType &&
    (left?.objectIndex ?? -1) === (right?.objectIndex ?? -1) &&
    left?.helperKind === right?.helperKind
  );
}

export function cloneUsdOffscreenSelection(
  selection: OffscreenViewerInteractionSelection | null | undefined,
): OffscreenViewerInteractionSelection | null {
  if (!selection?.type || !selection.id) {
    return null;
  }

  return {
    type: selection.type,
    id: selection.id,
    subType: selection.subType,
    objectIndex: selection.objectIndex,
    helperKind: selection.helperKind,
  };
}

export function createUsdOffscreenInteractionState<THighlightSnapshot = unknown>({
  restoreHighlight,
}: UsdOffscreenInteractionStateOptions<THighlightSnapshot>): UsdOffscreenInteractionState<THighlightSnapshot> {
  let selection: OffscreenViewerInteractionSelection | null = null;
  let hoveredSelection: OffscreenViewerInteractionSelection | null = null;
  let lastEmittedHover: OffscreenViewerInteractionSelection | null = null;
  let meshMetaByObject = new Map<THREE.Object3D, UsdOffscreenRuntimeMeshMeta>();
  let meshesByLinkKey = new Map<string, THREE.Mesh[]>();
  let pickMeshes: THREE.Mesh[] = [];
  let helperTargets: THREE.Object3D[] = [];
  const highlights = new Map<THREE.Mesh, THighlightSnapshot>();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  const clearHighlights = (): void => {
    highlights.forEach((snapshot, mesh) => restoreHighlight(mesh, snapshot));
    highlights.clear();
  };

  const resetStageResources = (): void => {
    clearHighlights();
    meshMetaByObject = new Map();
    meshesByLinkKey = new Map();
    pickMeshes = [];
    helperTargets = [];
  };

  return {
    get selection() {
      return selection;
    },
    get hoveredSelection() {
      return hoveredSelection;
    },
    get lastEmittedHover() {
      return lastEmittedHover;
    },
    get meshMetaByObject() {
      return meshMetaByObject;
    },
    get meshesByLinkKey() {
      return meshesByLinkKey;
    },
    get pickMeshes() {
      return pickMeshes;
    },
    get helperTargets() {
      return helperTargets;
    },
    get highlightedMeshes() {
      return [...highlights.keys()];
    },
    raycaster,
    pointer,
    setSelection(nextSelection) {
      selection = cloneUsdOffscreenSelection(nextSelection);
    },
    setHoveredSelection(nextSelection) {
      hoveredSelection = cloneUsdOffscreenSelection(nextSelection);
    },
    setLastEmittedHover(nextSelection) {
      lastEmittedHover = cloneUsdOffscreenSelection(nextSelection);
    },
    replaceMeshIndex(index) {
      meshMetaByObject = new Map(index.meshMetaByObject);
      meshesByLinkKey = new Map(
        [...index.meshesByLinkKey].map(([key, meshes]) => [key, [...meshes]]),
      );
      pickMeshes = [...index.pickMeshes];
      helperTargets = [...index.helperTargets];
    },
    replaceHelperTargets(targets) {
      helperTargets = [...targets];
    },
    getHighlight(mesh) {
      return highlights.get(mesh);
    },
    setHighlight(mesh, snapshot) {
      highlights.set(mesh, snapshot);
    },
    clearHighlights,
    resetStageResources,
    resetAll() {
      resetStageResources();
      selection = null;
      hoveredSelection = null;
      lastEmittedHover = null;
    },
  };
}
