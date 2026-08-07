import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocateFixed, ZoomIn, ZoomOut } from 'lucide-react';
import { Checkbox, IconButton } from '@/shared/components/ui';
import type {
  CollisionOptimizationAnalysis,
  CollisionOptimizationCandidate,
  CollisionOptimizationManualMergePair,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '../utils/collisionOptimization';
import { createCollisionOptimizationCandidateKey } from '../utils/collisionOptimization';
import { GeometryType } from '@/types';
import {
  buildCurvePath,
  buildGraphModel,
  clamp,
  createViewportForBounds,
  getMetricSummary,
  getNodeTone,
  getPrimitiveMonogram,
  MAX_SCALE,
  MIN_SCALE,
  type CollisionSelection,
  type GraphNodeModel,
  type GraphPoint,
  type GraphModel,
  type ViewportState,
} from '../utils/collision-optimization/planarGraphLayout';

interface GestureLikeEvent extends Event {
  clientX: number;
  clientY: number;
  scale: number;
}

interface PanSession {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startViewport: ViewportState;
}

export interface CollisionOptimizationPlanarGraphConnectionState {
  sourceTargetId: string;
  pointer: GraphPoint | null;
}

export interface CollisionOptimizationPlanarGraphLabels {
  autoPair: string;
  collisionIndex: string;
  component: string;
  connectionHandle: string;
  dragHint: string;
  empty: string;
  frontView: string;
  manualPair: string;
  mergeTo: string;
  mergedInto: string;
  primary: string;
  resetView: string;
  selectCandidate: string;
  unselectCandidate: string;
  zoomIn: string;
  zoomOut: string;
}

export interface CollisionOptimizationPlanarGraphProps {
  source: CollisionOptimizationSource;
  analysis: CollisionOptimizationAnalysis;
  candidates: CollisionOptimizationCandidate[];
  checkedCandidateKeys: ReadonlySet<string>;
  selection?: CollisionSelection;
  manualMergePairs: CollisionOptimizationManualMergePair[];
  manualConnection?: CollisionOptimizationPlanarGraphConnectionState | null;
  labels: CollisionOptimizationPlanarGraphLabels;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
  canCreateManualPair: (sourceTargetId: string, targetTargetId: string) => boolean;
  onToggleCandidate: (candidateKey: string) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onManualConnectionStart?: (target: CollisionTargetRef) => void;
  onManualConnectionMove?: (pointer: GraphPoint) => void;
  onManualConnectionEnd?: (target: CollisionTargetRef | null) => void;
  onManualConnectionCancel?: () => void;
}

export function CollisionOptimizationPlanarGraph({
  source,
  analysis,
  candidates,
  checkedCandidateKeys,
  selection,
  manualMergePairs,
  manualConnection = null,
  labels,
  formatGeometryType,
  canCreateManualPair,
  onToggleCandidate,
  onSelectTarget,
  onManualConnectionStart,
  onManualConnectionMove,
  onManualConnectionEnd,
  onManualConnectionCancel,
}: CollisionOptimizationPlanarGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasInitializedViewportRef = useRef(false);
  const gestureScaleRef = useRef(1);

  const model = useMemo<GraphModel>(
    () =>
      buildGraphModel(
        source,
        analysis,
        candidates,
        checkedCandidateKeys,
        selection,
        manualMergePairs,
      ),
    [analysis, candidates, checkedCandidateKeys, manualMergePairs, selection, source],
  );

  const [viewport, setViewport] = useState<ViewportState>({ x: 24, y: 24, scale: 1 });
  const [panSession, setPanSession] = useState<PanSession | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || hasInitializedViewportRef.current || model.nodes.length === 0) {
      return;
    }

    setViewport(
      createViewportForBounds(container.clientWidth, container.clientHeight, model.focusBounds),
    );
    hasInitializedViewportRef.current = true;
  }, [model.focusBounds, model.nodes.length]);

  const nodeByLinkId = useMemo(
    () => new Map(model.nodes.map((node) => [node.linkId, node] as const)),
    [model.nodes],
  );
  const nodeByTargetId = useMemo(() => {
    const map = new Map<string, GraphNodeModel>();
    model.nodes.forEach((node) => {
      if (node.summaryTarget) {
        map.set(node.summaryTarget.id, node);
      }
    });
    return map;
  }, [model.nodes]);

  const toWorldPoint = useCallback(
    (clientX: number, clientY: number): GraphPoint | null => {
      const container = containerRef.current;
      if (!container) {
        return null;
      }

      const rect = container.getBoundingClientRect();
      return {
        x: (clientX - rect.left - viewport.x) / viewport.scale,
        y: (clientY - rect.top - viewport.y) / viewport.scale,
      };
    },
    [viewport.scale, viewport.x, viewport.y],
  );

  const zoomAtClientPoint = useCallback((clientX: number, clientY: number, scaleFactor: number) => {
    const container = containerRef.current;
    if (!container || !Number.isFinite(scaleFactor) || scaleFactor <= 0) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const pointerX = clientX - rect.left;
    const pointerY = clientY - rect.top;

    setViewport((current) => {
      const worldPoint = {
        x: (pointerX - current.x) / current.scale,
        y: (pointerY - current.y) / current.scale,
      };
      const nextScale = clamp(current.scale * scaleFactor, MIN_SCALE, MAX_SCALE);

      if (Math.abs(nextScale - current.scale) <= 1e-4) {
        return current;
      }

      return {
        scale: nextScale,
        x: pointerX - worldPoint.x * nextScale,
        y: pointerY - worldPoint.y * nextScale,
      };
    });
  }, []);

  const handleResetViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    setViewport(
      createViewportForBounds(container.clientWidth, container.clientHeight, model.focusBounds),
    );
  }, [model.focusBounds]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleWheelEvent = (event: WheelEvent) => {
      event.preventDefault();
      zoomAtClientPoint(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0022));
    };

    const handleGestureStart = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      gestureScaleRef.current =
        Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0 ? gestureEvent.scale : 1;
      event.preventDefault();
    };

    const handleGestureChange = (event: Event) => {
      const gestureEvent = event as GestureLikeEvent;
      event.preventDefault();

      const nextGestureScale =
        Number.isFinite(gestureEvent.scale) && gestureEvent.scale > 0
          ? gestureEvent.scale
          : gestureScaleRef.current;
      const scaleFactor = nextGestureScale / Math.max(gestureScaleRef.current, 1e-4);
      gestureScaleRef.current = nextGestureScale;
      zoomAtClientPoint(gestureEvent.clientX, gestureEvent.clientY, scaleFactor);
    };

    const handleGestureEnd = (event: Event) => {
      gestureScaleRef.current = 1;
      event.preventDefault();
    };

    container.addEventListener('wheel', handleWheelEvent, { passive: false });
    container.addEventListener('gesturestart', handleGestureStart as EventListener, {
      passive: false,
    });
    container.addEventListener('gesturechange', handleGestureChange as EventListener, {
      passive: false,
    });
    container.addEventListener('gestureend', handleGestureEnd as EventListener, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheelEvent);
      container.removeEventListener('gesturestart', handleGestureStart as EventListener);
      container.removeEventListener('gesturechange', handleGestureChange as EventListener);
      container.removeEventListener('gestureend', handleGestureEnd as EventListener);
    };
  }, [zoomAtClientPoint]);

  const handleSurfacePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (![0, 1, 2].includes(event.button) || manualConnection) {
        return;
      }

      const target = event.target as HTMLElement;
      if (target.closest('[data-graph-node]') || target.closest('[data-graph-no-pan="true"]')) {
        return;
      }

      event.preventDefault();
      setPanSession({
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: viewport,
      });
    },
    [manualConnection, viewport],
  );

  const handleConnectionStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, target: CollisionTargetRef) => {
      event.preventDefault();
      event.stopPropagation();
      onManualConnectionStart?.(target);

      const point = toWorldPoint(event.clientX, event.clientY);
      if (point) {
        onManualConnectionMove?.(point);
      }
    },
    [onManualConnectionMove, onManualConnectionStart, toWorldPoint],
  );

  useEffect(() => {
    if (!manualConnection && !panSession) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (panSession && event.pointerId === panSession.pointerId) {
        setViewport({
          ...panSession.startViewport,
          x: panSession.startViewport.x + (event.clientX - panSession.startClientX),
          y: panSession.startViewport.y + (event.clientY - panSession.startClientY),
        });
        return;
      }

      if (manualConnection) {
        const point = toWorldPoint(event.clientX, event.clientY);
        if (point) {
          onManualConnectionMove?.(point);
        }
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (panSession && event.pointerId === panSession.pointerId) {
        setPanSession(null);
      }

      if (manualConnection) {
        const hitElement = document.elementFromPoint(
          event.clientX,
          event.clientY,
        ) as HTMLElement | null;
        const targetId =
          hitElement?.closest<HTMLElement>('[data-graph-node-target-id]')?.dataset
            .graphNodeTargetId ?? null;
        const node = targetId ? (nodeByTargetId.get(targetId) ?? null) : null;
        const target = node?.summaryTarget ?? null;
        onManualConnectionEnd?.(
          target && target.id !== manualConnection.sourceTargetId ? target : null,
        );
      }
    };

    const handlePointerCancel = () => {
      setPanSession(null);
      if (manualConnection) {
        onManualConnectionCancel?.();
      }
    };

    const handleWindowBlur = () => {
      handlePointerCancel();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        handlePointerCancel();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: false });
    window.addEventListener('pointercancel', handlePointerCancel, { once: false });
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    manualConnection,
    nodeByTargetId,
    onManualConnectionCancel,
    onManualConnectionEnd,
    onManualConnectionMove,
    panSession,
    toWorldPoint,
  ]);

  const dragSourceNode = manualConnection?.sourceTargetId
    ? (nodeByTargetId.get(manualConnection.sourceTargetId) ?? null)
    : null;

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[16rem] w-full select-none overflow-hidden rounded-lg border border-border-black bg-panel-bg"
      onPointerDown={handleSurfacePointerDown}
      onContextMenu={(event) => event.preventDefault()}
      style={{ touchAction: 'none' }}
    >
      {model.nodes.length === 0 ? (
        <div className="flex h-full min-h-[12rem] items-center justify-center px-3 text-center text-[10px] leading-relaxed text-text-secondary">
          {labels.empty}
        </div>
      ) : (
        <>
          <div className="absolute left-2.5 top-2 z-20 max-w-[min(24rem,calc(100%-7rem))] rounded-2xl border border-border-black bg-element-bg/95 px-2.5 py-2 shadow-sm">
            <div className="min-w-0 text-[9px] leading-relaxed text-text-secondary">
              {labels.dragHint}
            </div>
          </div>

          <div className="absolute right-2.5 top-2 z-20 flex items-center gap-1 rounded-full border border-border-black bg-element-bg/95 p-1 shadow-sm">
            <IconButton
              variant="toolbar"
              size="sm"
              data-graph-no-pan="true"
              aria-label={labels.zoomOut}
              title={labels.zoomOut}
              onClick={() => {
                const container = containerRef.current;
                if (!container) {
                  return;
                }
                const rect = container.getBoundingClientRect();
                zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / 1.2);
              }}
              className="h-7 w-7 rounded-full"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              variant="toolbar"
              size="sm"
              data-graph-no-pan="true"
              aria-label={labels.zoomIn}
              title={labels.zoomIn}
              onClick={() => {
                const container = containerRef.current;
                if (!container) {
                  return;
                }
                const rect = container.getBoundingClientRect();
                zoomAtClientPoint(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.2);
              }}
              className="h-7 w-7 rounded-full"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton
              variant="toolbar"
              size="sm"
              data-graph-no-pan="true"
              aria-label={labels.resetView}
              title={labels.resetView}
              onClick={handleResetViewport}
              className="h-7 w-7 rounded-full"
            >
              <LocateFixed className="h-3.5 w-3.5" />
            </IconButton>
          </div>

          <div
            className={`absolute inset-0 ${
              manualConnection ? 'cursor-crosshair' : panSession ? 'cursor-grabbing' : 'cursor-grab'
            }`}
          >
            <div
              className="absolute inset-0 opacity-35"
              style={{
                backgroundImage:
                  'radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--color-border-black) 24%, transparent) 1px, transparent 0)',
                backgroundSize: '24px 24px',
              }}
            />

            <div
              className="absolute left-0 top-0"
              style={{
                width: model.width,
                height: model.height,
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                transformOrigin: '0 0',
              }}
            >
              <svg
                className="pointer-events-none absolute inset-0"
                width={model.width}
                height={model.height}
                viewBox={`0 0 ${model.width} ${model.height}`}
                fill="none"
              >
                {model.edges.map((edge) => {
                  const from = nodeByLinkId.get(edge.fromLinkId);
                  const to = nodeByLinkId.get(edge.toLinkId);
                  if (!from || !to) {
                    return null;
                  }

                  return (
                    <path
                      key={edge.id}
                      d={buildCurvePath(
                        { x: from.center.x, y: from.center.y + from.height / 2 - 2 },
                        { x: to.center.x, y: to.center.y - to.height / 2 + 2 },
                      )}
                      className="stroke-border-black/42 dark:stroke-border-strong/45"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                    />
                  );
                })}

                {dragSourceNode && manualConnection?.pointer ? (
                  <path
                    d={buildCurvePath(dragSourceNode.handle, manualConnection.pointer)}
                    className="stroke-system-blue"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeDasharray="7 5"
                  />
                ) : null}
              </svg>

              {model.groups.map((group) => {
                const labelText = `${labels.mergeTo}: ${formatGeometryType(group.candidate.suggestedType ?? group.candidate.target.geometry.type)}`;
                const metricText = getMetricSummary(group.candidate);
                const groupToneClass = group.checked
                  ? 'border-system-blue/35 bg-system-blue/10'
                  : group.pairType === 'manual'
                    ? 'border-system-blue/28 bg-system-blue/6 border-dashed'
                    : 'border-border-black/45 bg-element-hover/55';

                return (
                  <React.Fragment key={group.id}>
                    <div
                      className={`absolute rounded-[24px] border ${groupToneClass}`}
                      style={{
                        left: group.bounds.x,
                        top: group.bounds.y,
                        width: group.bounds.width,
                        height: group.bounds.height,
                      }}
                    />

                    <div
                      className="absolute z-10"
                      style={{
                        left: group.labelAnchor.x,
                        top: group.labelAnchor.y,
                        transform: 'translate(-100%, -100%)',
                      }}
                    >
                      <button
                        type="button"
                        data-graph-no-pan="true"
                        onClick={() => {
                          if (group.candidate.eligible) {
                            onToggleCandidate(
                              createCollisionOptimizationCandidateKey(group.candidate),
                            );
                          }
                        }}
                        className={`grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-2xl border px-2.5 py-1.5 text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                          group.checked
                            ? 'border-system-blue/35 bg-panel-bg text-system-blue hover:bg-system-blue/8'
                            : 'border-border-black bg-panel-bg text-text-primary hover:bg-element-hover'
                        }`}
                      >
                        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-xl border border-system-blue/20 bg-system-blue/10 px-1.5 text-[9px] font-semibold tracking-[0.18em]">
                          {getPrimitiveMonogram(group.candidate.suggestedType)}
                        </span>

                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="rounded-full border border-border-black bg-element-bg px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.02em] text-text-tertiary">
                              {group.pairType === 'manual' ? labels.manualPair : labels.autoPair}
                            </span>
                            <span className="truncate text-[10px] font-semibold">{labelText}</span>
                          </span>
                          {metricText ? (
                            <span className="mt-0.5 block truncate text-[8px] text-text-secondary">
                              {metricText}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                  </React.Fragment>
                );
              })}

              {model.nodes.map((node) => {
                const connectable =
                  manualConnection?.sourceTargetId && node.summaryTarget
                    ? node.summaryTarget.id !== manualConnection.sourceTargetId &&
                      canCreateManualPair(manualConnection.sourceTargetId, node.summaryTarget.id)
                    : false;
                const nodeToneClass = getNodeTone(
                  node,
                  Boolean(manualConnection),
                  Boolean(connectable),
                );
                const summaryCandidate = node.summaryCandidate;
                const summaryTarget = node.summaryTarget;
                const summaryType = summaryCandidate?.suggestedType ?? summaryTarget?.geometry.type;
                const summaryMetricText =
                  summaryCandidate && !summaryCandidate.secondaryTarget
                    ? getMetricSummary(summaryCandidate)
                    : '';

                return (
                  <div
                    key={node.id}
                    data-graph-node={node.linkId}
                    data-graph-node-target-id={summaryTarget?.id ?? undefined}
                    className="absolute"
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      height: node.height,
                    }}
                  >
                    <div
                      className={`relative h-full rounded-full border shadow-sm ${nodeToneClass}`}
                    >
                      <button
                        type="button"
                        data-graph-no-pan="true"
                        onClick={() => {
                          if (summaryTarget) {
                            onSelectTarget?.(summaryTarget);
                          }
                        }}
                        className="flex h-full w-full items-center gap-1.5 rounded-full px-2.5 pr-9 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                        title={
                          node.componentName
                            ? `${node.componentName} / ${node.linkName}`
                            : node.linkName
                        }
                      >
                        <span
                          className={`h-[7px] w-[7px] shrink-0 rounded-full ${node.checked ? 'bg-system-blue' : 'bg-text-tertiary'}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-[9px] font-semibold text-text-primary">
                          {node.linkName}
                        </span>
                        {node.targetCount > 1 ? (
                          <span className="shrink-0 rounded-full border border-border-black bg-panel-bg px-1.5 py-0.5 text-[7px] font-medium text-text-tertiary">
                            {node.targetCount}
                          </span>
                        ) : null}
                      </button>

                      {summaryCandidate ? (
                        <div
                          data-graph-no-pan="true"
                          className="absolute right-1 top-1 rounded-full bg-panel-bg/90 p-0.75 shadow-sm"
                        >
                          <Checkbox
                            checked={node.checked}
                            onChange={() => {
                              if (summaryCandidate.eligible) {
                                onToggleCandidate(
                                  createCollisionOptimizationCandidateKey(summaryCandidate),
                                );
                              }
                            }}
                            disabled={!summaryCandidate.eligible}
                            ariaLabel={
                              node.checked ? labels.unselectCandidate : labels.selectCandidate
                            }
                            className="shrink-0"
                          />
                        </div>
                      ) : null}

                      {summaryTarget ? (
                        <button
                          type="button"
                          data-graph-no-pan="true"
                          aria-label={labels.connectionHandle}
                          title={labels.connectionHandle}
                          onPointerDown={(event) => handleConnectionStart(event, summaryTarget)}
                          className={`absolute -bottom-1 right-2 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                            connectable || !manualConnection
                              ? 'border-border-black bg-element-bg text-text-secondary hover:bg-element-hover hover:text-text-primary'
                              : 'border-system-blue/30 bg-system-blue/10 text-system-blue'
                          }`}
                        >
                          <span className="h-1.25 w-1.25 rounded-full bg-current" />
                        </button>
                      ) : null}
                    </div>

                    {summaryCandidate && !summaryCandidate.secondaryTarget ? (
                      <div
                        className="pointer-events-none absolute left-1/2 top-full mt-1.5 -translate-x-1/2"
                        style={{ maxWidth: Math.max(node.width + 24, 140) }}
                      >
                        <div className="rounded-full border border-border-black bg-panel-bg/96 px-2 py-1 text-center shadow-sm">
                          <div className="flex items-center justify-center gap-1">
                            <span className="rounded-full border border-system-blue/20 bg-system-blue/10 px-1.5 py-0.5 text-[7px] font-semibold tracking-[0.18em] text-system-blue">
                              {getPrimitiveMonogram(summaryType)}
                            </span>
                            <span className="truncate text-[8px] font-medium text-text-primary">
                              {formatGeometryType(summaryType)}
                            </span>
                          </div>
                          {summaryMetricText ? (
                            <div className="mt-0.5 truncate text-[7px] text-text-secondary">
                              {summaryMetricText}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default CollisionOptimizationPlanarGraph;
