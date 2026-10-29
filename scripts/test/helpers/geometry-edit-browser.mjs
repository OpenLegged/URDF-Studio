import assert from 'node:assert/strict';

const labels = {
  visual: /^(可视化几何|Visual Geometry)$/,
  collision: /^(碰撞几何|Collision Geometry)$/,
};

export async function settleGeometryFrame(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export async function readGeometryMetrics(page) {
  return page.evaluate(() => {
    const debug = window.__URDF_STUDIO_DEBUG__;
    const snapshot = debug.getRegressionSnapshot();
    const runtime = snapshot.primaryRuntime ?? snapshot.runtime;
    const content = Object.values(debug.__assetsStore__.getState().componentSourceDrafts)
      .map(draft => draft.content).join('\n');
    const doc = content ? new DOMParser().parseFromString(content, 'text/xml') : null;
    return {
      draftSourceBytes: new TextEncoder().encode(content).length,
      draftValid: Boolean(doc?.documentElement.tagName === 'robot' && !doc.querySelector('parsererror')),
      draftLinks: doc?.querySelectorAll('robot > link').length ?? 0,
      draftJoints: doc?.querySelectorAll('robot > joint').length ?? 0,
      maxIndent: Math.max(0, ...content.split(/\r?\n/).map(line => line.match(/^[ \t]*/)[0].length)),
      runtimeRevision: snapshot.primaryRuntimeRevision,
      links: snapshot.store?.linkCount, joints: snapshot.store?.jointCount,
      visualMeshes: runtime?.visualMeshCount, collisionMeshes: runtime?.collisionMeshCount,
      placeholders: runtime?.placeholderMeshCount,
      triangles: runtime?.visualMeshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0),
      canvasCount: [...document.querySelectorAll('canvas')].filter(canvas => !canvas.closest('.monaco-editor')).length,
      contextLosses: window.__geometryEditContextLosses ?? 0,
      heapBytes: performance.memory?.usedJSHeapSize,
      load: debug.getDocumentLoadState(),
    };
  });
}

export function assertGeometryMetrics(metrics, model, baseline, requireDraft = true) {
  assert.equal(metrics.links, model.linkCount, 'model link count');
  assert.equal(metrics.joints, model.jointCount, 'model joint count');
  assert.equal(metrics.placeholders, 0, 'all real meshes must load');
  assert.equal(metrics.load?.status, 'ready');
  assert.equal(metrics.canvasCount, 1);
  assert.equal(metrics.contextLosses, 0, 'WebGL context remains available');
  assert.equal(metrics.runtimeRevision, baseline.runtimeRevision, 'edits reuse the imported runtime');
  assert.equal(metrics.visualMeshes, baseline.visualMeshes, 'visual meshes remain mounted');
  assert.equal(metrics.collisionMeshes, baseline.collisionMeshes, 'collision meshes remain mounted');
  if (requireDraft) {
    assert.ok(metrics.draftSourceBytes > 0 && metrics.draftValid, 'editing must produce nonempty valid URDF');
    assert.equal(metrics.draftLinks, model.linkCount);
    assert.equal(metrics.draftJoints, model.jointCount);
  }
  assert.ok(metrics.maxIndent < Math.max(64, model.maxIndent * 2), 'source indentation remains bounded');
  assert.ok(metrics.draftSourceBytes < model.sourceBytes * 2 + 4096, 'source size remains bounded');
}

export async function readEditedGeometry(page, target) {
  return page.evaluate(({ link, subType, objectIndex }) => {
    const components = Object.values(window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState().workspace.components);
    if (components.length !== 1) throw new Error('Expected one imported robot component');
    const robotLink = Object.values(components[0].robot.links).find(value => value.name === link);
    if (!robotLink) throw new Error(`Missing link ${link}`);
    const entries = [robotLink[subType], ...(robotLink[`${subType}Bodies`] ?? [])];
    const geometry = entries[objectIndex];
    if (!geometry) throw new Error(`Missing ${subType} ${objectIndex} on ${link}`);
    return geometry;
  }, target);
}

async function selectGeometry(page, target) {
  const panel = page.getByTestId('property-editor-sidebar-content');
  const identity = await page.evaluate(name => {
    const [componentId, component] = Object.entries(window.__URDF_STUDIO_DEBUG__.__workspaceStore__.getState().workspace.components)[0];
    const link = Object.values(component.robot.links).find(value => value.name === name);
    return { componentId, linkId: link?.id };
  }, target.link);
  const row = page.getByTestId(`tree-link-${identity.componentId}-${identity.linkId}`);
  await row.getByRole('button', { name: target.link, exact: true }).getByText(target.link, { exact: true }).click();
  await panel.getByRole('heading', { name: target.link, exact: true }).waitFor();
  await panel.getByRole('button', { name: labels[target.subType] }).click();
  if (target.subType === 'collision') {
    const name = target.name || new RegExp(`^(碰撞体|Collision) ${target.objectIndex + 1}$`);
    await panel.getByRole('button', { name, exact: true }).click();
  }
  return panel;
}

export function summarizeEditTimes(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    maxMs: sorted.at(-1), first100MeanMs: mean(durations.slice(0, 100)), last100MeanMs: mean(durations.slice(-100)) };
}

export async function exerciseGeometry(page, target, count, sample, burst = false) {
  const panel = await selectGeometry(page, target);
  const operations = [
    /^(俯仰 增加 90°|Pitch increase 90°)$/, /^(俯仰 减少 90°|Pitch decrease 90°)$/,
    'Increase X', 'Decrease X', /^(偏航 增加 90°|Yaw increase 90°)$/, /^(偏航 减少 90°|Yaw decrease 90°)$/,
  ];
  const scale = panel.locator('label:visible').filter({ hasText: /^(Mesh 缩放|Mesh Scale)$/ })
    .locator('..').getByRole('textbox').first();
  const initialScale = target.type === 'mesh' ? Number(await scale.inputValue()) : null;
  const dimensions = target.type === 'mesh' ? null : panel.getByRole('button', { name: 'Increase value', exact: true }).first();
  const durations = [];
  for (let index = 0; index < count; index++) {
    const before = await readEditedGeometry(page, target);
    const start = performance.now();
    const step = burst ? 0 : index % 8;
    if (step < 6) {
      await panel.getByRole('button', { name: operations[step], exact: true }).click();
    } else if (target.type === 'mesh') {
      const value = step === 6 ? initialScale * 1.01 || 0.01 : initialScale;
      await scale.fill(String(Number(value.toPrecision(8))));
      await scale.press('Enter');
    } else if (step === 6) {
      await dimensions.click();
    } else {
      await panel.getByRole('button', { name: 'Decrease value', exact: true }).first().click();
    }
    if (!burst) await settleGeometryFrame(page);
    assert.notDeepEqual(await readEditedGeometry(page, target), before,
      `${target.link} ${target.subType}[${target.objectIndex}] edit ${index + 1} must change the intended geometry`);
    durations.push(performance.now() - start);
    if ((index + 1) % 8 === 0 || index === count - 1) await sample();
  }
  return { ...target, edits: count, burst, ...summarizeEditTimes(durations), durations };
}

export async function checkGeometryHistory(page, target) {
  // Paired edits and full rotations can cancel exactly (notably on BDX).
  // Retain one real edit so Undo cannot legitimately undo the original import.
  const before = await readEditedGeometry(page, target);
  await page.getByTestId('property-editor-sidebar-content').getByRole('button', { name: 'Increase X', exact: true }).click();
  await settleGeometryFrame(page);
  const edited = await readEditedGeometry(page, target);
  assert.notDeepEqual(edited, before, 'history checkpoint changes geometry');
  await page.getByTestId('history-undo').click(); await settleGeometryFrame(page);
  assert.deepEqual(await readEditedGeometry(page, target), before, 'undo restores geometry before the checkpoint');
  await page.getByTestId('history-redo').click(); await settleGeometryFrame(page);
  assert.deepEqual(await readEditedGeometry(page, target), edited, 'redo restores the selected geometry');
  return { checkpointEdits: 1, undoRedoPassed: true };
}

export async function checkGeometrySource(page, model) {
  // History may invalidate draft caches. Read the actual editor document so an
  // empty cache cannot masquerade as a successful source-size check.
  await page.getByRole('button', { name: /^(源代码|Source Code)$/ }).click();
  await page.waitForFunction(() => Boolean(window.__URDF_STUDIO_DEBUG__?.__sourceEditor?.getValue?.()));
  const source = await page.evaluate(() => window.__URDF_STUDIO_DEBUG__.__sourceEditor.getValue());
  const summary = await page.evaluate(text => {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    return { valid: doc.documentElement.tagName === 'robot' && !doc.querySelector('parsererror'),
      links: doc.querySelectorAll('robot > link').length, joints: doc.querySelectorAll('robot > joint').length };
  }, source);
  assert.ok(summary.valid, 'source editor contains valid URDF after undo/redo');
  assert.equal(summary.links, model.linkCount);
  assert.equal(summary.joints, model.jointCount);
  assert.ok(Buffer.byteLength(source) < model.sourceBytes * 2 + 4096);
  return { ...summary, sourceBytes: Buffer.byteLength(source) };
}
