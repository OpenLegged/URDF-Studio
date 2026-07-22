#!/usr/bin/env node

/**
 * Format-agnostic base helpers for browser regression tests.
 * Extracted from mjcf-helpers.mjs to support URDF, SDF, USD, Xacro, etc.
 *
 * This module provides: session management, state queries, store operations,
 * report output, and assertion re-exports. Format-specific importModel() is
 * provided by each format helper (urdf-helpers, sdf-helpers, usd-helpers, etc.).
 */

import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  ensureSite, launchBrowser, createPage, writeJsonAtomic,
  ensureDir, DEFAULT_SITE_URL, DEFAULT_OPERATION_TIMEOUT_MS,
  isTransientPageContextError,
} from '../../helpers/browser-helpers.mjs';

import {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
} from '../../helpers/assertions.mjs';

export {
  createTestSuite, assert, assertEqual, assertGreaterThan, assertNonNull, printSummary,
  DEFAULT_OPERATION_TIMEOUT_MS,
};

// ── Session ──────────────────────────────────────────────────────────

export async function createSession(options = {}) {
  // Allow `--headed` from the unified runner (run-all.mjs) to flow through env.
  const headed = options.headed ?? (process.env.URDF_E2E_HEADED === '1');
  let siteUrl = options.siteUrl ?? DEFAULT_SITE_URL;
  // Append regressionDebug=1 if not already present
  const url = new URL(siteUrl);
  if (!url.searchParams.has('regressionDebug')) url.searchParams.set('regressionDebug', '1');
  siteUrl = url.toString();

  const site = await ensureSite(siteUrl, {
    siteTimeoutMs: 120_000, timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    noStart: false, headed, startCommand: null,
  });
  let browser = null;
  try {
    browser = await launchBrowser({
      headed, siteUrl, timeoutMs: DEFAULT_OPERATION_TIMEOUT_MS,
    });
    const { page, consoleMessages, pageErrors } = await createPage(
      browser,
      siteUrl,
      DEFAULT_OPERATION_TIMEOUT_MS,
      { beforeNavigate: options.beforeNavigate },
    );
    await page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.setBeforeUnloadPromptEnabled?.(false));
    return {
      page, browser,
      async cleanup() {
        try {
          await browser.close();
        } catch (error) {
          if (!isTransientPageContextError(error)) throw error;
        }
        await site.stop();
      },
      errors() {
        return {
          console: consoleMessages.snapshot().filter((e) => !e.includes('favicon') && !e.includes('DevTools') && e.length > 0),
          page: pageErrors.snapshot(),
        };
      },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await site.stop().catch(() => undefined);
    throw error;
  }
}

// ── Wait ─────────────────────────────────────────────────────────────

export async function waitForReady(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  const cacheCurrentComponentRobot = () => page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const selectedFile = api?.__assetsStore__?.getState?.()?.selectedFile ?? null;
    const workspace = api?.__workspaceStore__?.getState?.()?.workspace ?? null;
    const component = selectedFile
      ? Object.values(workspace?.components ?? {}).find(
          (candidate) => candidate?.sourceFile === selectedFile.name,
        )
      : null;
    if (!selectedFile || !component?.robot) return false;
    api.__browserRobotDataBySource__ ??= {};
    api.__browserRobotDataBySource__[selectedFile.name] = structuredClone(component.robot);
    return true;
  });
  while (Date.now() < deadline) {
    try {
      const probe = await page.evaluate(() => {
        const api = window.__URDF_STUDIO_DEBUG__;
        const snap = api?.getRegressionSnapshot?.();
        const st = api?.getDocumentLoadState?.() ?? null;
        const runtime = snap?.primaryRuntime ?? snap?.runtime ?? null;
        const selectedFile = api?.__assetsStore__?.getState?.()?.selectedFile ?? null;
        const workspace = api?.__workspaceStore__?.getState?.()?.workspace ?? null;
        const selectedComponent = selectedFile
          ? Object.values(workspace?.components ?? {}).find(
              (component) => component?.sourceFile === selectedFile.name,
            )
          : null;
        const countEntries = (value) =>
          Array.isArray(value)
            ? value.length
            : value && typeof value === 'object'
              ? Object.keys(value).length
              : 0;
        return {
          status: st?.status ?? null,
          error: st?.error ?? null,
          fileName: st?.fileName ?? null,
          hasRuntime: Boolean(runtime),
          runtimeLinkCount:
            Number(runtime?.linkCount ?? Number.NaN) ||
            countEntries(runtime?.links) ||
            countEntries(runtime?.visualMeshes),
          linkCount: countEntries(snap?.store?.links),
          workspaceMatchesSelected: Boolean(selectedComponent),
          workspaceLinkCount: countEntries(selectedComponent?.robot?.links),
        };
      });
      last = probe;
      if (probe.status === 'error') {
        throw new Error(`Document load failed: ${probe.error ?? 'unknown'} (file: ${probe.fileName ?? '?'})`);
      }
      // USD reaches 'ready'/'hydrating'; the standard editor keeps status at
      // 'loading' even after the runtime robot is fully built, so a built runtime
      // with links is the authoritative "loaded" signal (matches the menagerie
      // regression's snapshotWithDebug check).
      const canonicalReady = probe.workspaceMatchesSelected && probe.workspaceLinkCount > 0;
      if (
        canonicalReady
        && (
          probe.status === 'ready'
          || probe.status === 'hydrating'
          || (probe.hasRuntime && (probe.linkCount > 0 || probe.runtimeLinkCount > 0))
          || (probe.status === 'loading' && probe.fileName)
        )
      ) {
        await cacheCurrentComponentRobot();
        return;
      }
    } catch (error) {
      // An import can trigger a one-off SPA navigation that destroys the
      // execution context mid-poll. Treat that as "not ready yet" and retry;
      // rethrow anything that is not a known transient navigation error.
      if (!isTransientPageContextError(error)) throw error;
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for robot ready (last: ${JSON.stringify(last)})`);
}

// ── State queries ────────────────────────────────────────────────────

export async function getTopology(page) {
  return page.evaluate(() => {
    const vector = (value, keys) => {
      if (Array.isArray(value)) return value;
      return keys.map((key) => Number(value?.[key] ?? 0));
    };
    const s = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
    const store = s?.store;
    const links = store?.links ? Object.entries(store.links) : [];
    const joints = store?.joints ? Object.entries(store.joints) : [];
    return {
      name: store?.name, rootLinkId: store?.rootLinkId,
      linkCount: links.length, jointCount: joints.length,
      links: links.map(([id, l]) => ({
        id: l?.id ?? id, name: l?.name, visible: l?.visible,
        visualCount: (l?.visualBodies?.length ?? 0) > 0 ? l.visualBodies.length : (l?.visual ? 1 : 0),
        collisionCount: (l?.collisionBodies?.length ?? 0) > 0 ? l.collisionBodies.length : (l?.collision ? 1 : 0),
        inertial: l?.inertial ? { mass: l.inertial.mass } : (Number.isFinite(l?.mass) ? { mass: l.mass } : null),
      })),
      joints: joints.map(([id, j]) => ({
        id: j?.id ?? id, name: j?.name, type: j?.type,
        parentLinkId: j?.parentLinkId, childLinkId: j?.childLinkId,
        originXyz: vector(j?.origin?.xyz, ['x', 'y', 'z']),
        originRpy: vector(j?.origin?.rpy, ['r', 'p', 'y']),
        axis: j?.axis ? vector(j.axis, ['x', 'y', 'z']) : null,
        limit: j?.limit,
        damping: j?.dynamics?.damping ?? j?.damping,
        friction: j?.dynamics?.friction ?? j?.friction,
        hardware: j?.hardware,
        angle: j?.angle,
      })),
    };
  });
}

export async function getAssemblyState(page) {
  return page.evaluate(() => {
    const a = window.__URDF_STUDIO_DEBUG__?.__workspaceStore__?.getState?.()?.workspace;
    if (!a) return { exists: false };
    return {
      exists: true, name: a.name,
      componentCount: Object.keys(a.components ?? {}).length,
      bridgeCount: Object.keys(a.bridges ?? {}).length,
      components: Object.entries(a.components ?? {}).map(([id, c]) => ({
        id,
        name: c.name,
        sourceFile: c.sourceFile,
        rootLinkId: c.robot?.rootLinkId ?? null,
        linkCount: Object.keys(c.robot?.links ?? {}).length,
        transform: c.transform ?? null,
      })),
      bridges: Object.entries(a.bridges ?? {}).map(([id, b]) => ({
        id, name: b.name, jointType: b.joint?.type,
        parentComponentId: b.parentComponentId, childComponentId: b.childComponentId,
        origin: b.joint?.origin ?? null,
      })),
    };
  });
}

export async function getRuntimeTransforms(page) {
  return page.evaluate(() => {
    const rt = window.__URDF_STUDIO_DEBUG__?.getRuntimeSceneTransforms?.();
    return rt ? Object.values(rt.links ?? {}).map((l) => ({ name: l?.name, position: l?.position })) : [];
  });
}

export async function getRegressionSnapshot(page) {
  return page.evaluate(() => window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.() ?? null);
}

export async function getProjectedInteractionTargets(page, filters = {}) {
  const targets = await page.evaluate(() =>
    window.__URDF_STUDIO_DEBUG__?.getProjectedInteractionTargets?.() ?? []);
  return targets
    .filter((target) => !filters.type || target.type === filters.type)
    .filter((target) => !filters.subType || target.subType === filters.subType)
    .filter((target) => !filters.targetKind || target.targetKind === filters.targetKind)
    .filter((target) => !filters.helperKind || target.helperKind === filters.helperKind)
    .filter((target) => filters.id == null || target.id === filters.id)
    .filter((target) => Number.isFinite(target.clientX) && Number.isFinite(target.clientY))
    .sort((left, right) => {
      const areaDelta = Number(right.projectedArea ?? 0) - Number(left.projectedArea ?? 0);
      if (areaDelta !== 0) return areaDelta;
      return Number(left.averageDepth ?? 0) - Number(right.averageDepth ?? 0);
    });
}

export async function getBestProjectedInteractionTarget(page, filters = {}) {
  const targets = await getProjectedInteractionTargets(page, filters);
  return targets[0] ?? null;
}

export async function getCanvasDiagnostics(page) {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas')].map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return {
        width: canvas.width,
        height: canvas.height,
        clientWidth: rect.width,
        clientHeight: rect.height,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    const primary = canvases.find((canvas) => canvas.visible) ?? canvases[0] ?? null;
    return {
      canvasCount: canvases.length,
      primary,
      usable: Boolean(primary && primary.clientWidth >= 200 && primary.clientHeight >= 200),
      canvases,
    };
  });
}

async function resolveCanvasPoint(page, point) {
  if (point && Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) {
    return { x: point.clientX, y: point.clientY };
  }

  const center = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  });
  if (!center) throw new Error('Could not resolve a usable canvas point.');
  return center;
}

export async function clickCanvasTarget(page, target) {
  const point = await resolveCanvasPoint(page, target);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.up();
  return point;
}

export async function dragCanvasByDelta(page, target, delta, options = {}) {
  const point = await resolveCanvasPoint(page, target);
  const steps = options.steps ?? 12;
  const end = {
    x: point.x + Number(delta?.x ?? 0),
    y: point.y + Number(delta?.y ?? 0),
  };
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps });
  await page.mouse.up();
  return { start: point, end, steps };
}

async function startFrameProbe(page, durationMs) {
  return page.evaluate((probeDurationMs) =>
    new Promise((resolve) => {
      const frames = [];
      const start = performance.now();
      let last = start;
      const step = (now) => {
        frames.push(now - last);
        last = now;
        if (now - start >= probeDurationMs) {
          const sorted = [...frames].sort((left, right) => left - right);
          const sum = frames.reduce((total, value) => total + value, 0);
          const percentile = (ratio) =>
            sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
          resolve({
            durationMs: now - start,
            frameCount: frames.length,
            averageFrameMs: frames.length > 0 ? sum / frames.length : 0,
            maxFrameMs: frames.length > 0 ? Math.max(...frames) : 0,
            p95FrameMs: percentile(0.95),
            longFrameCount: frames.filter((value) => value > 50).length,
          });
          return;
        }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), durationMs);
}

export async function measureCanvasDrag(page, target, delta, options = {}) {
  const durationMs = options.durationMs ?? 900;
  const probePromise = startFrameProbe(page, durationMs);
  await delay(50);
  const drag = await dragCanvasByDelta(page, target, delta, options);
  const metrics = await probePromise;
  return { drag, metrics };
}

export async function measureInteractionFrames(page, action, options = {}) {
  const durationMs = options.durationMs ?? 900;
  const probePromise = startFrameProbe(page, durationMs);
  await delay(50);
  const actionResult = await action();
  const metrics = await probePromise;
  return { actionResult, metrics };
}

export async function measureCanvasContinuityDuring(page, action, options = {}) {
  const durationMs = options.durationMs ?? 1_500;
  const sampleSize = options.sampleSize ?? 48;
  const samplerPromise = page.evaluate(
    ({ durationMs: nextDurationMs, sampleSize: nextSampleSize }) =>
      new Promise((resolve) => {
        const samples = [];
        const start = performance.now();

        const readSample = () => {
          const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.() ?? null;
          const runtime = snapshot?.primaryRuntime ?? snapshot?.runtime ?? null;
          const runtimeLinkCount = Number(runtime?.linkCount ?? 0);
          const runtimeVisualMeshes = Array.isArray(runtime?.visualMeshes)
            ? runtime.visualMeshes
            : [];
          const visibleRuntimeMeshCount = runtimeVisualMeshes.filter(
            (mesh) => mesh?.visible !== false && mesh?.effectiveVisible !== false,
          ).length;
          const hasRenderableRuntime =
            Boolean(runtime) && runtimeLinkCount > 0 && visibleRuntimeMeshCount > 0;
          const canvases = [...document.querySelectorAll('canvas')].filter((canvas) => {
            if (!(canvas instanceof HTMLCanvasElement)) {
              return false;
            }
            const rect = canvas.getBoundingClientRect();
            const style = window.getComputedStyle(canvas);
            return (
              rect.width >= 120 &&
              rect.height >= 120 &&
              style.visibility !== 'hidden' &&
              style.display !== 'none'
            );
          });
          const canvas = canvases[0] ?? null;
          if (!canvas) {
	            return {
	              hasCanvas: false,
	              hasRuntime: Boolean(runtime),
	              hasRenderableRuntime,
	              runtimeLinkCount,
              visibleRuntimeMeshCount,
              lumaStdDev: 0,
              lumaRange: 0,
              nonBlank: false,
            };
          }

          const sampleCanvas = document.createElement('canvas');
          sampleCanvas.width = nextSampleSize;
          sampleCanvas.height = nextSampleSize;
          const context = sampleCanvas.getContext('2d', { willReadFrequently: true });
          if (!context) {
	            return {
	              hasCanvas: true,
	              hasRuntime: Boolean(runtime),
	              hasRenderableRuntime,
	              runtimeLinkCount,
	              visibleRuntimeMeshCount,
	              lumaStdDev: null,
	              lumaRange: null,
	              nonBlank: false,
	            };
          }

          try {
            context.drawImage(canvas, 0, 0, nextSampleSize, nextSampleSize);
            const imageData = context.getImageData(0, 0, nextSampleSize, nextSampleSize);
            let sum = 0;
            let min = 255;
            let max = 0;
            const lumas = [];
            for (let index = 0; index < imageData.data.length; index += 4) {
              const r = imageData.data[index] ?? 0;
              const g = imageData.data[index + 1] ?? 0;
              const b = imageData.data[index + 2] ?? 0;
              const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
              lumas.push(luma);
              sum += luma;
              min = Math.min(min, luma);
              max = Math.max(max, luma);
            }
            const mean = sum / Math.max(1, lumas.length);
            const variance =
              lumas.reduce((acc, value) => acc + (value - mean) ** 2, 0) /
              Math.max(1, lumas.length);
            const lumaStdDev = Math.sqrt(variance);
            const lumaRange = max - min;
            return {
	              hasCanvas: true,
	              hasRuntime: Boolean(runtime),
	              hasRenderableRuntime,
	              runtimeLinkCount,
	              visibleRuntimeMeshCount,
	              lumaStdDev,
	              lumaRange,
              // WebGL's default drawing buffer can be cleared immediately
              // after presentation, so a 2D readback may look blank while the
              // mounted runtime is still rendering. Treat a renderable runtime
              // as authoritative and keep luma as an additional signal.
              nonBlank:
                hasRenderableRuntime || lumaStdDev > 0.8 || lumaRange > 8,
	            };
          } catch (error) {
            return {
	              hasCanvas: true,
	              hasRuntime: Boolean(runtime),
	              hasRenderableRuntime,
	              runtimeLinkCount,
	              visibleRuntimeMeshCount,
	              lumaStdDev: null,
	              lumaRange: null,
	              nonBlank: false,
	              readError: error instanceof Error ? error.message : String(error),
            };
          }
        };

        const step = () => {
          samples.push(readSample());
          if (performance.now() - start >= nextDurationMs) {
            const blankSamples = samples.filter((sample) => !sample.nonBlank);
            const missingRuntimeSamples = samples.filter((sample) => !sample.hasRuntime);
            resolve({
              sampleCount: samples.length,
              blankFrameCount: blankSamples.length,
              missingRuntimeFrameCount: missingRuntimeSamples.length,
              worstLumaStdDev: Math.min(
                ...samples
                  .map((sample) => sample.lumaStdDev)
                  .filter((value) => Number.isFinite(value)),
              ),
              samples,
            });
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    { durationMs, sampleSize },
  );

  await delay(50);
  const actionResult = await action();
  const metrics = await samplerPromise;
  return { actionResult, metrics };
}

export async function getSemanticSnapshot(page) {
  return page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const snapshot = api?.getRegressionSnapshot?.() ?? null;
    const assemblyState = api?.__workspaceStore__?.getState?.()?.workspace ?? null;
    const assetsState = api?.getAssetDebugState?.() ?? null;
    const usdScene = api?.getSelectedUsdSceneSummary?.() ?? null;

    const links = snapshot?.store?.links ?? [];
    const joints = snapshot?.store?.joints ?? [];
    const geometrySummary = (geometry) => ({
      name: geometry?.name ?? null,
      type: geometry?.type ?? null,
      meshPath: geometry?.meshPath ?? null,
      visible: geometry?.visible !== false,
      color: geometry?.color ?? null,
      materialSource: geometry?.materialSource ?? null,
      authoredMaterialCount: Array.isArray(geometry?.authoredMaterials)
        ? geometry.authoredMaterials.length
        : 0,
      meshMaterialGroupCount: Array.isArray(geometry?.meshMaterialGroups)
        ? geometry.meshMaterialGroups.length
        : 0,
      origin: geometry?.origin ?? null,
    });

    return {
      selectedFile: snapshot?.selectedFile ?? null,
      robot: snapshot?.store
        ? {
            name: snapshot.store.name,
            rootLinkId: snapshot.store.rootLinkId,
            linkCount: snapshot.store.linkCount,
            jointCount: snapshot.store.jointCount,
            totalMass: snapshot.store.totalMass,
          }
        : null,
      links: links
        .map((link) => ({
          id: link.id,
          name: link.name,
          visible: link.visible !== false,
          visual: geometrySummary(link.visual),
          visualBodyCount: Array.isArray(link.visualBodies) ? link.visualBodies.length : 0,
          collision: geometrySummary(link.collision),
          collisionBodyCount: Array.isArray(link.collisionBodies) ? link.collisionBodies.length : 0,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      joints: joints
        .map((joint) => ({
          id: joint.id,
          name: joint.name,
          type: joint.type,
          parentLinkId: joint.parentLinkId,
          childLinkId: joint.childLinkId,
          axis: joint.axis,
          origin: joint.origin,
          limit: joint.limit,
          dynamics: joint.dynamics,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      runtime: snapshot?.runtime
        ? {
            linkCount: snapshot.runtime.linkCount,
            jointCount: snapshot.runtime.jointCount,
            visualMeshCount: snapshot.runtime.visualMeshCount,
            collisionMeshCount: snapshot.runtime.collisionMeshCount,
            texturedVisualMeshCount: snapshot.runtime.texturedVisualMeshCount,
            visiblePlaceholderMeshCount: snapshot.runtime.visiblePlaceholderMeshCount,
            hiddenPlaceholderMeshCount: snapshot.runtime.hiddenPlaceholderMeshCount,
          }
        : null,
      assembly: assemblyState
        ? {
            name: assemblyState.name,
            componentCount: Object.keys(assemblyState.components ?? {}).length,
            bridgeCount: Object.keys(assemblyState.bridges ?? {}).length,
            components: Object.entries(assemblyState.components ?? {})
              .map(([id, component]) => ({
                id,
                name: component.name,
                sourceFile: component.sourceFile,
                rootLinkId: component.robot?.rootLinkId ?? null,
                linkCount: Object.keys(component.robot?.links ?? {}).length,
                transform: component.transform ?? null,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
            bridges: Object.entries(assemblyState.bridges ?? {})
              .map(([id, bridge]) => ({
                id,
                name: bridge.name,
                jointType: bridge.joint?.type ?? null,
                parentComponentId: bridge.parentComponentId,
                childComponentId: bridge.childComponentId,
                origin: bridge.joint?.origin ?? null,
              }))
              .sort((left, right) => left.id.localeCompare(right.id)),
          }
        : null,
      assets: assetsState,
      usdScene,
      interaction: snapshot?.interaction ?? null,
      viewer: snapshot?.viewer ?? null,
    };
  });
}

export async function getMaterialSnapshot(page) {
  return page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const snapshot = api?.getRegressionSnapshot?.() ?? null;
    const usdMaterials = api?.getSelectedUsdVisualMaterialSummary?.() ?? null;
    const links = snapshot?.store?.links ?? [];
    const storeMaterials = [];

    const collectGeometry = (link, role, geometry, bodyIndex = 0) => {
      const authoredMaterials = Array.isArray(geometry?.authoredMaterials)
        ? geometry.authoredMaterials
        : [];
      if (geometry?.color || geometry?.materialSource || authoredMaterials.length > 0) {
        storeMaterials.push({
          linkId: link.id,
          linkName: link.name,
          role,
          bodyIndex,
          color: geometry?.color ?? null,
          materialSource: geometry?.materialSource ?? null,
          meshPath: geometry?.meshPath ?? null,
          materialCount: authoredMaterials.length,
          textureCount: authoredMaterials.filter((material) => Boolean(material?.texture)).length,
          materialNames: authoredMaterials
            .map((material) => material?.name)
            .filter(Boolean)
            .sort(),
          meshMaterialGroupCount: Array.isArray(geometry?.meshMaterialGroups)
            ? geometry.meshMaterialGroups.length
            : 0,
        });
      }
    };

    links.forEach((link) => {
      collectGeometry(link, 'visual', link.visual, 0);
      (link.visualBodies ?? []).forEach((entry, index) =>
        collectGeometry(link, 'visual', entry.geometry, index + 1));
      collectGeometry(link, 'collision', link.collision, 0);
      (link.collisionBodies ?? []).forEach((entry, index) =>
        collectGeometry(link, 'collision', entry.geometry, index + 1));
    });

    const runtimeVisualMeshes = snapshot?.runtime?.visualMeshes ?? [];
    const runtimeMaterialCount = runtimeVisualMeshes.reduce(
      (sum, mesh) => sum + (Array.isArray(mesh.materials) ? mesh.materials.length : 0),
      0,
    );
    const runtimeTextureCount = runtimeVisualMeshes.reduce(
      (sum, mesh) =>
        sum + (Array.isArray(mesh.materials) ? mesh.materials.filter((m) => m.hasTexture).length : 0),
      0,
    );

    return {
      selectedFile: snapshot?.selectedFile ?? null,
      storeMaterialCount: storeMaterials.length,
      storeTextureCount: storeMaterials.reduce((sum, material) => sum + material.textureCount, 0),
      storeMaterials: storeMaterials.sort((left, right) =>
        `${left.linkId}:${left.role}:${left.bodyIndex}`.localeCompare(
          `${right.linkId}:${right.role}:${right.bodyIndex}`,
        )),
      runtimeVisualMeshCount: runtimeVisualMeshes.length,
      runtimeMaterialCount,
      runtimeTextureCount,
      runtimeVisualMeshes: runtimeVisualMeshes
        .map((mesh) => ({
          link: mesh.link,
          name: mesh.name,
          visible: mesh.visible,
          effectiveVisible: mesh.effectiveVisible,
          isPlaceholder: mesh.isPlaceholder,
          missingMeshPath: mesh.missingMeshPath,
          materialCount: Array.isArray(mesh.materials) ? mesh.materials.length : 0,
          textureCount: Array.isArray(mesh.materials)
            ? mesh.materials.filter((material) => material.hasTexture).length
            : 0,
          colors: Array.isArray(mesh.materials)
            ? mesh.materials.map((material) => material.color).filter(Boolean).sort()
            : [],
        }))
        .sort((left, right) => `${left.link}:${left.name}`.localeCompare(`${right.link}:${right.name}`)),
      usdMaterials,
    };
  });
}

export async function openSourceEditor(page) {
  const opened = await page.evaluate(() => {
    const candidates = [
      document.querySelector('[data-testid="source-code-open"]'),
      ...document.querySelectorAll('button'),
    ].filter(Boolean);
    const button = candidates.find((candidate) => {
      const text = `${candidate.textContent ?? ''} ${candidate.getAttribute?.('title') ?? ''} ${
        candidate.getAttribute?.('aria-label') ?? ''
      }`;
      return /source|code|xml|源码|源代码/i.test(text);
    });
    button?.click();
    return Boolean(button);
  });
  if (!opened) throw new Error('Could not find source editor open button.');

  await page.waitForSelector('.monaco-editor', { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelectorAll('.monaco-editor .view-line').length > 0, {
    timeout: 30_000,
  });
}

export async function getSourceEditorText(page) {
  return page.evaluate(() => {
    const activeEditorText = window.__URDF_STUDIO_DEBUG__?.__sourceEditor?.getValue?.();
    if (typeof activeEditorText === 'string' && activeEditorText.length > 0) return activeEditorText;
    const monacoModels = globalThis.monaco?.editor?.getModels?.();
    const activeModel = Array.isArray(monacoModels) ? monacoModels[monacoModels.length - 1] : null;
    const monacoText = activeModel?.getValue?.();
    if (typeof monacoText === 'string' && monacoText.length > 0) return monacoText;
    return document.querySelector('.monaco-editor')?.textContent ?? '';
  });
}

export async function replaceSourceEditorText(page, nextText) {
  const changedViaMonaco = await page.evaluate((value) => {
    const monacoModels = globalThis.monaco?.editor?.getModels?.();
    const activeModel = Array.isArray(monacoModels) ? monacoModels[monacoModels.length - 1] : null;
    if (!activeModel || typeof activeModel.setValue !== 'function') return false;
    activeModel.setValue(value);
    return true;
  }, nextText);
  if (changedViaMonaco) {
    await delay(100);
    return;
  }

  await page.click('.monaco-editor');
  await page.keyboard.down(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('A');
  await page.keyboard.up(process.platform === 'darwin' ? 'Meta' : 'Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(nextText, { delay: 0 });
  await page.waitForFunction(
    (expectedLength) => {
      const monacoModels = globalThis.monaco?.editor?.getModels?.();
      const activeModel = Array.isArray(monacoModels) ? monacoModels[monacoModels.length - 1] : null;
      const value = activeModel?.getValue?.();
      return typeof value === 'string' && value.length === expectedLength;
    },
    { timeout: 30_000 },
    nextText.length,
  ).catch(() => {});
}

export async function saveSourceEditor(page) {
  await page.waitForFunction(
    () => {
      const button =
        document.querySelector('[data-testid="source-code-save"]') ??
        [...document.querySelectorAll('button')].find((candidate) =>
          /save|保存/i.test(`${candidate.textContent ?? ''} ${candidate.title ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`));
      return Boolean(button && !button.disabled);
    },
    { timeout: 30_000 },
  );
  const clicked = await page.evaluate(() => {
    const button =
      document.querySelector('[data-testid="source-code-save"]') ??
      [...document.querySelectorAll('button')].find((candidate) =>
        /save|保存/i.test(`${candidate.textContent ?? ''} ${candidate.title ?? ''} ${candidate.getAttribute('aria-label') ?? ''}`));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  if (!clicked) throw new Error('Could not click source editor save button.');
}

export async function waitForRobotPredicate(page, predicateSource, timeoutMs = 60_000) {
  await page.waitForFunction(
    (source) => {
      const snapshot = window.__URDF_STUDIO_DEBUG__?.getRegressionSnapshot?.();
      if (!snapshot?.store) return false;
      return new Function('snapshot', `return (${source})(snapshot);`)(snapshot);
    },
    { timeout: timeoutMs },
    predicateSource,
  );
}

export function assertNoBrowserErrors(suite, session, label = 'no browser errors') {
  const errs = session.errors();
  assert(suite, errs.page.length === 0, `${label}: no page errors`);
  assert(
    suite,
    errs.console.filter((entry) => /\[(error|assert)\]/i.test(entry)).length === 0,
    `${label}: no console errors`,
  );
}

// ── Store operations ─────────────────────────────────────────────────

function workspaceStoreOp(page, operation, ...args) {
  return page.evaluate(({ operationName, callArgs }) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const store = api?.__workspaceStore__?.getState?.();
    if (!store) return { ok: false, error: 'no workspace store' };

    const normalize = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const basename = (value) => normalize(value).split('/').filter(Boolean).pop() ?? '';
    const pathsMatch = (candidateName, expectedName) => {
      const candidate = normalize(candidateName);
      const expected = normalize(expectedName);
      return candidate === expected || candidate.endsWith(`/${expected}`) ||
        basename(candidate) === basename(expected);
    };
    const toVector = (value, keys) => Array.isArray(value)
      ? Object.fromEntries(keys.map((key, index) => [key, Number(value[index] ?? 0)]))
      : value;
    const normalizeJointPatch = (patch) => {
      if (!patch || typeof patch !== 'object') return patch;
      return {
        ...patch,
        ...(patch.axis ? { axis: toVector(patch.axis, ['x', 'y', 'z']) } : {}),
        ...(patch.origin
          ? {
              origin: {
                ...patch.origin,
                ...(patch.origin.xyz
                  ? { xyz: toVector(patch.origin.xyz, ['x', 'y', 'z']) }
                  : {}),
                ...(patch.origin.rpy
                  ? { rpy: toVector(patch.origin.rpy, ['r', 'p', 'y']) }
                  : {}),
              },
            }
          : {}),
      };
    };
    const getActiveComponent = () =>
      store.workspace.components[store.activeComponentId] ??
      Object.values(store.workspace.components)[0] ?? null;
    const resolveEntityRef = (type, rendererIdOrName) => {
      const projection = store.getSceneProjection();
      let globalId = rendererIdOrName;
      let ref = projection.globalToEntityRef.get(globalId);
      if (ref?.type === type) return ref;
      const entities = type === 'link' ? projection.robotData.links : projection.robotData.joints;
      globalId = Object.entries(entities).find(([id, entity]) =>
        id === rendererIdOrName || entity?.id === rendererIdOrName ||
        entity?.name === rendererIdOrName)?.[0];
      ref = globalId ? projection.globalToEntityRef.get(globalId) : null;
      return ref?.type === type ? ref : null;
    };

    switch (operationName) {
      case 'setName': {
        const component = getActiveComponent();
        if (!component) return { ok: false };
        return {
          ok: store.replaceComponentRobot(
            component.id,
            { ...component.robot, name: callArgs[0] },
            { label: 'Rename robot' },
          ),
        };
      }
      case 'addChild': {
        const ref = resolveEntityRef('link', callArgs[0]);
        if (!ref) return { ok: false, error: `link not found: ${callArgs[0]}` };
        const result = store.addChild({
          componentId: ref.componentId,
          parentLinkId: ref.entityId,
        });
        return result ? { ok: true, ...result } : { ok: false };
      }
      case 'updateLink': {
        const ref = resolveEntityRef('link', callArgs[0]);
        return { ok: Boolean(ref && store.updateLink(ref, callArgs[1])) };
      }
      case 'deleteLink': {
        const ref = resolveEntityRef('link', callArgs[0]);
        return { ok: Boolean(ref && store.deleteLink(ref)) };
      }
      case 'setLinkVisibility': {
        const ref = resolveEntityRef('link', callArgs[0]);
        return { ok: Boolean(ref && store.setLinkVisibility(ref, callArgs[1])) };
      }
      case 'setAllLinksVisibility': {
        const component = getActiveComponent();
        return { ok: Boolean(component && store.setAllLinksVisibility(component.id, callArgs[0])) };
      }
      case 'updateJoint': {
        const ref = resolveEntityRef('joint', callArgs[0]);
        return { ok: Boolean(ref && store.updateJoint(ref, normalizeJointPatch(callArgs[1]))) };
      }
      case 'deleteJoint': {
        const ref = resolveEntityRef('joint', callArgs[0]);
        return { ok: Boolean(ref && store.deleteJoint(ref)) };
      }
      case 'setJointAngle': {
        const ref = resolveEntityRef('joint', callArgs[0]);
        if (!ref || !store.setJointMotion(ref, callArgs[1])) return { ok: false };
        store.flushPendingJointMotion();
        return { ok: true };
      }
      case 'deleteSubtree': {
        const ref = resolveEntityRef('link', callArgs[0]);
        return { ok: Boolean(ref && store.deleteSubtree(ref)) };
      }
      case 'undo':
        return { ok: store.undo() };
      case 'redo':
        return { ok: store.redo() };
      case 'stabilizeHistory':
        store.flushPendingJointMotion();
        store.clearPendingAutoGroundComponentIds();
        store.clearHistory();
        return { ok: true };
      case 'initAssembly': {
        store.renameWorkspace(callArgs[0], { skipHistory: true });
        store.clearHistory();
        api.__browserAssemblyClaimedComponentIds__ = [];
        return { ok: true };
      }
      case 'addComponent': {
        const fileLike = callArgs[0];
        const fileName = typeof fileLike === 'string' ? fileLike : fileLike?.name;
        const availableFiles = api?.__assetsStore__?.getState?.()?.availableFiles ?? [];
        const file = availableFiles.find((candidate) => pathsMatch(candidate?.name, fileName)) ??
          fileLike;
        if (!file?.name) return { ok: false, error: `file not found: ${fileName ?? '<null>'}` };

        const claimedIds = new Set(api.__browserAssemblyClaimedComponentIds__ ?? []);
        const existing = Object.values(store.workspace.components).find(
          (component) => pathsMatch(component.sourceFile, file.name) && !claimedIds.has(component.id),
        );
        if (existing) {
          claimedIds.add(existing.id);
          api.__browserAssemblyClaimedComponentIds__ = [...claimedIds];
          store.setActiveComponent(existing.id);
          return { ok: true, id: existing.id, name: existing.name };
        }

        const cachedRobots = api.__browserRobotDataBySource__ ?? {};
        const cachedRobotEntry = Object.entries(cachedRobots).find(([sourcePath]) =>
          pathsMatch(sourcePath, file.name));
        const sameSourceComponent = Object.values(store.workspace.components).find(
          (component) => pathsMatch(component.sourceFile, file.name),
        );
        const robot = cachedRobotEntry?.[1] ?? sameSourceComponent?.robot ?? null;
        if (!robot) return { ok: false, error: `robot data not cached: ${file.name}` };
        const component = store.appendComponent({
          name: robot.name,
          sourceFile: file.name,
          robot: structuredClone(robot),
          queueAutoGround: false,
        });
        claimedIds.add(component.id);
        api.__browserAssemblyClaimedComponentIds__ = [...claimedIds];
        store.setActiveComponent(component.id);
        return { ok: true, id: component.id, name: component.name };
      }
      case 'removeComponent':
        return { ok: store.removeComponent(callArgs[0]) };
      case 'updateComponentTransform': {
        const componentId = callArgs[0];
        const isBridgedChild = Object.values(store.workspace.bridges).some(
          (bridge) => bridge.childComponentId === componentId,
        );
        return {
          ok: !isBridgedChild && store.updateComponentTransform(componentId, callArgs[1]),
        };
      }
      case 'toggleComponentVisibility':
        return { ok: store.setComponentVisibility(callArgs[0], callArgs[1]) };
      case 'addBridge': {
        const params = callArgs[0];
        const bridge = store.addBridge({
          ...params,
          joint: normalizeJointPatch(params.joint),
        });
        return bridge ? { ok: true, id: bridge.id, name: bridge.name } : { ok: false };
      }
      case 'removeBridge':
        return { ok: store.removeBridge(callArgs[0]) };
      case 'updateBridge': {
        const patch = callArgs[1];
        return {
          ok: store.updateBridge(callArgs[0], {
            ...patch,
            ...(patch?.joint ? { joint: normalizeJointPatch(patch.joint) } : {}),
          }),
        };
      }
      default:
        return { ok: false, error: `unknown workspace operation: ${operationName}` };
    }
  }, { operationName: operation, callArgs: args });
}

export async function findAvailableFile(page, fileName) {
  return page.evaluate((expectedName) => {
    const normalize = (value) => String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
    const basename = (value) => normalize(value).split('/').filter(Boolean).pop() ?? '';
    const matches = (candidateName, expected) => {
      const candidate = normalize(candidateName);
      const target = normalize(expected);
      return (
        candidate === target ||
        candidate.endsWith(`/${target}`) ||
        basename(candidate) === basename(target)
      );
    };
    const files =
      window.__URDF_STUDIO_DEBUG__?.__assetsStore__?.getState?.()?.availableFiles ??
      window.__URDF_STUDIO_DEBUG__?.getAvailableFiles?.() ??
      [];
    return (
      files.find((file) => matches(file?.name, expectedName)) ??
      null
    );
  }, fileName);
}

export const store = {
  // Robot
  setName:            (page, name) => workspaceStoreOp(page, 'setName', name),

  // Links
  addChild:           (page, parentId) => workspaceStoreOp(page, 'addChild', parentId),
  updateLink:         (page, id, upd) => workspaceStoreOp(page, 'updateLink', id, upd),
  deleteLink:         (page, id) => workspaceStoreOp(page, 'deleteLink', id),
  setLinkVisibility:  (page, id, v) => workspaceStoreOp(page, 'setLinkVisibility', id, v),
  setAllLinksVisibility: (page, v) => workspaceStoreOp(page, 'setAllLinksVisibility', v),

  // Joints
  updateJoint:        (page, id, upd) => workspaceStoreOp(page, 'updateJoint', id, upd),
  deleteJoint:        (page, id) => workspaceStoreOp(page, 'deleteJoint', id),
  setJointAngle:      (page, name, angle) => workspaceStoreOp(page, 'setJointAngle', name, angle),

  // Subtree
  deleteSubtree:      (page, id) => workspaceStoreOp(page, 'deleteSubtree', id),

  // History
  undo:               (page) => workspaceStoreOp(page, 'undo'),
  redo:               (page) => workspaceStoreOp(page, 'redo'),
  stabilizeHistory:   (page) => workspaceStoreOp(page, 'stabilizeHistory'),

  // Assembly
  initAssembly:       (page, name) => workspaceStoreOp(page, 'initAssembly', name),
  addComponent:       (page, file) => workspaceStoreOp(page, 'addComponent', file),
  removeComponent:    (page, id) => workspaceStoreOp(page, 'removeComponent', id),
  updateComponentTransform: (page, id, t) => workspaceStoreOp(page, 'updateComponentTransform', id, t),
  toggleComponentVisibility: (page, id, v) => workspaceStoreOp(page, 'toggleComponentVisibility', id, v),
  addBridge:          (page, params) => workspaceStoreOp(page, 'addBridge', params),
  removeBridge:       (page, id) => workspaceStoreOp(page, 'removeBridge', id),
  updateBridge:       (page, id, upd) => workspaceStoreOp(page, 'updateBridge', id, upd),

  // Debug API shortcuts
  setJointAngles: (page, map) => page.evaluate((m) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return typeof api?.setViewerJointAngles === 'function' ? api.setViewerJointAngles(m) : { ok: false };
  }, map),
  setViewerFlags: (page, flags) => page.evaluate((f) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return typeof api?.setViewerFlags === 'function' ? api.setViewerFlags(f) : { ok: false };
  }, flags),
  setViewerToolMode: (page, mode) => page.evaluate((m) => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return typeof api?.setViewerToolMode === 'function' ? api.setViewerToolMode(m) : { ok: false };
  }, mode),
};

// ── Output ───────────────────────────────────────────────────────────

export async function writeReport(name, data) {
  const out = path.resolve(`tmp/regression/${name}_results.json`);
  await ensureDir(path.dirname(out));
  await writeJsonAtomic(out, { ...data, generatedAt: new Date().toISOString() });
  return out;
}
