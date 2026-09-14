import type { ToolMode } from '@/shared/components/3d/robot/types';

export interface ResolveIkGeometrySelectionStateOptions {
  toolMode: ToolMode;
  hitType: 'link' | 'joint' | 'tendon' | null;
  hitSubType?: 'visual' | 'collision';
  linkId?: string | null;
  fallbackId?: string | null;
  resolveDirectIkHandleLink?: (linkId: string) => string | null;
}

export interface IkGeometrySelectionState {
  geometryIkSelectionActive: boolean;
  preferredIkHandleLinkId: string | null;
}

export function resolveIkGeometrySelectionState({
  toolMode,
  hitType,
  hitSubType,
  linkId,
  fallbackId,
  resolveDirectIkHandleLink,
}: ResolveIkGeometrySelectionStateOptions): IkGeometrySelectionState {
  const geometryIkSelectionActive =
    toolMode !== 'measure' &&
    hitType === 'link' &&
    Boolean(hitSubType) &&
    typeof resolveDirectIkHandleLink === 'function';

  if (!geometryIkSelectionActive) {
    return {
      geometryIkSelectionActive: false,
      preferredIkHandleLinkId: null,
    };
  }

  const resolvedLinkId =
    typeof linkId === 'string' && linkId.length > 0
      ? linkId
      : typeof fallbackId === 'string' && fallbackId.length > 0
        ? fallbackId
        : null;

  return {
    geometryIkSelectionActive: true,
    preferredIkHandleLinkId: resolvedLinkId
      ? (resolveDirectIkHandleLink(resolvedLinkId) ?? null)
      : null,
  };
}
