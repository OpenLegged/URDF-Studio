#!/usr/bin/env node

/**
 * Shared GUI-driving layer for the workflow E2E suite
 * (scripts/test/e2e/test_workflow_suite.mjs).
 *
 * Everything here drives the app the way a user does — real DOM events on the
 * property panel, the BridgeCreateModal's custom comboboxes, the File→Export
 * dialog — and verifies results through the regression debug API
 * (window.__URDF_STUDIO_DEBUG__, gated by ?regressionDebug=1) rather than
 * internal store writes. Assertions come from scripts/test/helpers/assertions.
 *
 * All waits are event-driven (waitForFunction / polling probes); fixed sleeps
 * are limited to short settle delays after clicks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { setTimeout as wait } from 'node:timers/promises';

import {
  takeScreenshot,
  retryPageAction,
  DEFAULT_OPERATION_TIMEOUT_MS,
} from '../../helpers/browser-helpers.mjs';

import {
  assert,
} from '../../helpers/assertions.mjs';
// English UI labels (the suite pins the app to EN; see setLanguageEn).
export const UI = {
  fileMenu: 'File',
  export: 'Export',
  importFile: 'Import File',
  cancel: 'Cancel',
  confirm: 'Confirm',
  exportZip: 'Export ZIP',
  sourceCode: 'Source Code',
  save: 'Save',
  // Property panel labels (src/shared/i18n/locales/en.ts)
  name: 'Name',
  type: 'Type',
  mass: 'Mass (kg)',
  lower: 'Lower Limit',
  upper: 'Upper Limit',
  effort: 'Effort',
  velocity: 'Velocity',
  kinematics: 'Kinematics',
  limits: 'Limits',
  visualMaterial: 'Material',
  color: 'Color',
  // Bridge modal
  createBridge: 'Create Bridge',
  parentLink: 'Parent Link',
  childLink: 'Child Link',
  linkListMode: 'Link List',
  geometryMode: 'Geometry Snap',
  advancedSettings: 'Advanced settings',
  baseLink: 'Base Link',
  attachLink: 'Attach Link',
  jointTypeFixed: 'Fixed',
  jointTypeRevolute: 'Revolute',
  jointTypeContinuous: 'Continuous',
  jointTypePrismatic: 'Prismatic',
};

export const SCREENSHOT_DIR = path.resolve('tmp/e2e/workflow/screenshots');

// ── Language / session helpers ────────────────────────────────────────

/** Pin the UI language to English so the label constants above stay valid. */
export async function setLanguageEn(page) {
  await page.evaluate(() => {
    window.localStorage.setItem('language', 'en');
  });
  // Reload so the app picks the language up on boot.
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Cold dev-server compiles under parallel journeys can take a while.
  await retryPageAction(
    () => page.waitForFunction(() => Boolean(window.__URDF_STUDIO_DEBUG__), { timeout: 30_000 }),
    DEFAULT_OPERATION_TIMEOUT_MS,
    'debug API availability after language pin',
  );
}

export async function screenshot(page, journeyId, stepName) {
  await takeScreenshot(page, `${journeyId}_${stepName}`, SCREENSHOT_DIR);
}

// ── Generic in-page UI primitives ─────────────────────────────────────

/**
 * Set an <input> value the way React expects: focus, select, insert, fire
 * input+change (isTrusted-safe path used by Puppeteer evaluate).
 */
export async function setInputValue(page, selector, value, { timeoutMs = 10_000 } = {}) {
  await page.waitForSelector(selector, { timeout: timeoutMs, visible: true });
  const ok = await page.evaluate(
    ({ sel, nextValue }) => {
      const input = document.querySelector(sel);
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      // React-controlled inputs need the value setter bypass, otherwise the
      // framework's virtual DOM overwrites the typed value on re-render.
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      descriptor?.set?.call(input, String(nextValue));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      return true;
    },
    { sel: selector, nextValue: value },
  );
  if (!ok) throw new Error(`setInputValue: no input matched ${selector}`);
}

/**
 * Set a <select> value with real DOM events (React onChange listens to change).
 * Only for native selects — the app's custom combobox needs selectCombobox.
 */
export async function setSelectValue(page, selector, value, { timeoutMs = 10_000 } = {}) {
  await page.waitForSelector(selector, { timeout: timeoutMs, visible: true });
  const ok = await page.evaluate(
    ({ sel, nextValue }) => {
      const select = document.querySelector(sel);
      if (!(select instanceof HTMLSelectElement)) return false;
      select.focus();
      const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      descriptor?.set?.call(select, String(nextValue));
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    { sel: selector, nextValue: value },
  );
  if (!ok) throw new Error(`setSelectValue: no select matched ${selector}`);
}

/**
 * Drive the app's custom Select combobox (src/shared/components/ui/Select.tsx):
 * a `button[role="combobox"]` trigger whose popup renders `role="option"`
 * buttons in a document.body portal. Clicking the option commits the value.
 * The trigger is located by aria-label (e.g. "Parent Link") or by its visible
 * text when no aria-label is present.
 */
export async function selectCombobox(
  page,
  { ariaLabel = null, triggerText = null, optionText },
  { timeoutMs = 10_000 } = {},
) {
  const matched = await page.evaluate(
    ({ expectedLabel, expectedTriggerText }) => {
      const triggers = [...document.querySelectorAll('button[role="combobox"]')];
      const trigger = expectedLabel
        ? triggers.find((button) => button.getAttribute('aria-label') === expectedLabel)
        : triggers.find((button) => button.textContent?.trim() === expectedTriggerText);
      if (!(trigger instanceof HTMLElement)) return { ok: false, error: 'trigger not found' };
      trigger.click();
      return { ok: true };
    },
    { expectedLabel: ariaLabel, expectedTriggerText: triggerText },
  );
  if (!matched.ok) {
    throw new Error(
      `selectCombobox: trigger not found (label=${ariaLabel ?? 'n/a'}, text=${triggerText ?? 'n/a'})`,
    );
  }

  // The portal menu renders after the click; under parallel journeys the lazy
  // modal chunk can take longer than the default 5s to mount.
  await page.waitForSelector('[role="option"]', { timeout: Math.min(timeoutMs, 15_000) });

  const picked = await page.evaluate((expectedOption) => {
    const options = [...document.querySelectorAll('[role="option"]')];
    const target = options.find((option) => option.textContent?.trim() === expectedOption);
    if (!(target instanceof HTMLElement)) {
      return { ok: false, available: options.map((o) => o.textContent?.trim()).slice(0, 40) };
    }
    target.click();
    return { ok: true, value: expectedOption };
  }, optionText);

  if (!picked.ok) {
    throw new Error(
      `selectCombobox: option "${optionText}" not found. Available: ${JSON.stringify(picked.available)}`,
    );
  }
  await delay(120);
  return picked;
}

/** Read the committed value of a custom combobox trigger. */
export async function readComboboxValue(page, { ariaLabel = null }) {
  return page.evaluate((expectedLabel) => {
    const trigger = [...document.querySelectorAll('button[role="combobox"]')].find(
      (button) => button.getAttribute('aria-label') === expectedLabel,
    );
    return trigger ? trigger.textContent?.trim() ?? null : null;
  }, ariaLabel);
}

/** Click a button matched by exact visible text or aria-label, retry-safe. */
export async function clickButton(page, { text = null, ariaLabel = null, selector = null, timeoutMs = 10_000 } = {}) {
  const clicked = await retryPageAction(
    () =>
      page.evaluate(
        ({ expectedText, expectedLabel, expectedSelector }) => {
          let candidates = [...document.querySelectorAll('button')];
          if (expectedSelector) {
            candidates = [...document.querySelectorAll(expectedSelector)].filter(
              (element) => element instanceof HTMLElement,
            );
          }
          const match = candidates.find((button) => {
            if (expectedLabel && button.getAttribute('aria-label') === expectedLabel) return true;
            if (expectedText && button.textContent?.trim() === expectedText) return true;
            return false;
          });
          if (!(match instanceof HTMLElement)) return false;
          match.click();
          return true;
        },
        { expectedText: text, expectedLabel: ariaLabel, expectedSelector: selector },
      ),
    timeoutMs,
    `clicking button text=${text ?? ''} label=${ariaLabel ?? ''}`,
  );
  if (!clicked) {
    throw new Error(`clickButton: no button matched text=${text} aria-label=${ariaLabel} selector=${selector}`);
  }
  await delay(150);
}

// ── Property panel driving (right sidebar) ────────────────────────────

const PROPERTY_EDITOR = '[data-testid="property-editor-sidebar"]';

/**
 * Select a link or joint in the tree so the property panel shows it.
 * The component's ROOT link renders with the `tree-robot-root-{componentId}`
 * testid (SingleComponentRobotRoot) instead of `tree-link-…`; non-root links
 * and joints use `tree-link-`/`tree-joint-`. The click handler lives on the
 * inner row div (the testid wrapper is a plain layout div).
 */
export async function selectTreeEntity(page, { componentId, linkId = null, jointId = null, isRootLink = false }) {
  const testId = linkId
    ? isRootLink
      ? `[data-testid="tree-robot-root-${componentId}"]`
      : `[data-testid="tree-link-${componentId}-${linkId}"]`
    : `[data-testid="tree-joint-${componentId}-${jointId}"]`;
  await page.waitForSelector(testId, { timeout: 30_000 });
  const clicked = await page.evaluate((sel) => {
    const wrapper = document.querySelector(sel);
    const row = wrapper?.querySelector(':scope > div');
    if (!(row instanceof HTMLElement)) return false;
    row.click();
    return true;
  }, testId);
  if (!clicked) throw new Error(`selectTreeEntity: row not clickable for ${testId}`);
  await page.waitForSelector(PROPERTY_EDITOR, { timeout: 45_000 });
  await delay(200);
}

/**
 * Edit a numeric field inside the property panel by its label text
 * (e.g. "Mass (kg)", "Lower Limit"). The link editor is tabbed
 * (Visual/Collision/Physics) — mass/inertia live in the Physics tab — so
 * this clicks the tab first, then focuses the input in-page and types
 * through the real keyboard pipeline (page.keyboard) so NumberInput's
 * commitOnBlurOnly draft ref updates, and blurs to commit.
 */
export async function editPropertyNumber(page, label, value) {
  await ensurePropertyFieldVisible(page, label);
  const selector = await findPropertyInputSelector(page, label);
  const focused = await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!(input instanceof HTMLInputElement)) return false;
    input.scrollIntoView({ block: 'center' });
    input.focus();
    input.select();
    return document.activeElement === input;
  }, selector);
  if (!focused) throw new Error(`editPropertyNumber(${label}): input not focusable`);
  await page.keyboard.type(String(value), { delay: 10 });
  await page.evaluate((sel) => {
    document.querySelector(sel)?.blur();
  }, selector);
  await delay(250);

  // Mass edits open the mass/inertia decision dialog (default "ask" behavior).
  // Confirm it so the store actually receives the new mass.
  if (/^Mass/i.test(label)) {
    await confirmMassInertiaDialogIfOpen(page);
  }
}

/** Click Confirm on the mass/inertia decision dialog if it appeared. */
async function confirmMassInertiaDialogIfOpen(page) {
  const confirmed = await page.evaluate(() => {
    // Title: "Update inertia after changing mass?" (massChangeInertiaDialogTitle).
    const dialogs = [...document.querySelectorAll('[role="dialog"], .fixed')];
    const dialog = dialogs.find((container) =>
      /update inertia after changing mass/i.test(container.textContent ?? ''));
    if (!dialog) return false;
    const confirm = [...dialog.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Confirm',
    );
    if (!(confirm instanceof HTMLElement)) return false;
    confirm.click();
    return true;
  });
  if (confirmed) await delay(300);
}

/** Labels that live in the link editor's Physics tab (vs default Visual). */
const PHYSICS_TAB_LABELS = [/^Mass/i, /^Inertial/i, /^Density/i, /^Center of Mass/i];

async function ensurePropertyFieldVisible(page, label) {
  const needsPhysicsTab = PHYSICS_TAB_LABELS.some((pattern) => pattern.test(label));
  if (!needsPhysicsTab) return;
  const clicked = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="property-editor-sidebar"]');
    const buttons = [...(root?.querySelectorAll('button') ?? [])];
    const tab = buttons.find((button) => button.textContent?.trim() === 'Physics');
    if (!(tab instanceof HTMLElement)) return false;
    tab.click();
    return true;
  });
  if (!clicked) throw new Error(`ensurePropertyFieldVisible: Physics tab not found for "${label}"`);
  await delay(250);
}

/** Locate the input element for a property label; returns a unique selector. */
async function findPropertyInputSelector(page, label) {
  const selector = await page.evaluate(
    ({ expectedLabel, PROPERTY_EDITOR_ROOT }) => {
      const labels = [...document.querySelectorAll(`${PROPERTY_EDITOR_ROOT} label`)];
      const label = labels.find((candidate) =>
        candidate.textContent?.trim().startsWith(expectedLabel),
      );
      if (!(label instanceof HTMLElement)) return { ok: false, error: 'label not found' };

      // InputGroup: label and the field wrapper are siblings in one flex row.
      const row = label.parentElement;
      const wrapper = row ? [...row.children].find((child) => child !== label) : null;
      const input = wrapper?.querySelector('input');
      if (!(input instanceof HTMLInputElement)) return { ok: false, error: 'input not found' };
      input.setAttribute('data-workflow-input', expectedLabel.replace(/\W+/g, '-'));
      return { ok: true, attr: `[data-workflow-input="${expectedLabel.replace(/\W+/g, '-')}"]` };
    },
    { expectedLabel: label, PROPERTY_EDITOR_ROOT: PROPERTY_EDITOR },
  );
  if (!selector.ok) throw new Error(`editPropertyNumber(${label}): ${selector.error}`);
  return selector.attr;
}

/** Read back a property number field by label (for verification). */
export async function readPropertyNumber(page, label) {
  const selector = await findPropertyInputSelector(page, label);
  return page.evaluate((sel) => document.querySelector(sel)?.value ?? null, selector);
}

/**
 * Change the joint type via the property panel select (aria-label="Type").
 * This one is a native <select> (PropertyEditorSelect).
 */
export async function editJointTypeViaPanel(page, jointTypeValue) {
  await setSelectValue(
    page,
    `${PROPERTY_EDITOR} select[aria-label="${UI.type}"]`,
    jointTypeValue,
  );
  await delay(200);
}

// ── Export flow (File menu → dialog → captured download) ──────────────

/**
 * Enable download capture via CDP so clicking "Export ZIP" yields a real file
 * we can unzip and assert on. Puppeteer exposes page._client via
 * createCDPSession; the modern path is the browser-level download events, but
 * Browser.setDownloadBehavior on the page target works for Puppeteer 22+.
 */
export async function enableDownloadCapture(page, downloadDir) {
  const client = await page.createCDPSession();
  await client.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadDir,
    eventsEnabled: true,
  });
  return client;
}

/**
 * Warm the lazy ExportDialog chunk before journeys converge on heavy work.
 * Under parallel load the Vite dev server can starve the chunk request and
 * the dialog stays on "Loading panel…" forever — a dev-server artifact, not
 * an app bug. Opening and cancelling the dialog once, early (right after
 * import, while CPU is idle), makes every later export instant.
 */
export async function warmExportDialog(page) {
  try {
    await clickButton(page, { ariaLabel: UI.fileMenu });
    await page.waitForSelector('[role="menu"]', { timeout: 8_000 });
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menu"] button, [role="menuitem"]')]
        .find((element) => element.textContent?.trim() === 'Export');
      if (item instanceof HTMLElement) item.click();
    });
    await page.waitForSelector('[data-export-format-picker]', { timeout: 30_000 });
    // Close it again: the dialog is a draggable window, Escape (or its close
    // control) dismisses it.
    await page.keyboard.press('Escape');
    await delay(300);
    // Also dismiss the File menu if it re-opened.
    await page.keyboard.press('Escape').catch(() => {});
    await delay(200);
    return true;
  } catch {
    return false; // non-fatal: real export retries anyway
  }
}

/**
 * Click File → Export … pick a format … click Export ZIP, then wait for the
 * downloaded archive to land in downloadDir. Returns the captured file path.
 * Every step waits for its own UI consequence so a slow/failed open is
 * diagnosed at the step that caused it, not as a download timeout.
 */
export async function exportViaDialog(page, client, { formatLabel, downloadDir, timeoutMs = 120_000 }) {
  // 1+2. Open the File menu and click its Export item. The dialog's lazy
  //     chunk can take tens of seconds under parallel load, so each attempt
  //     waits patiently for the picker; only when the export item click
  //     visibly failed (no menu, no picker) do we dismiss overlays and retry.
  let pickerReady = false;
  const menuDeadline = Date.now() + 90_000;
  while (!pickerReady && Date.now() < menuDeadline) {
    await clickButton(page, { ariaLabel: UI.fileMenu }).catch(() => {});
    await page.waitForSelector('[role="menu"]', { timeout: 5_000 }).catch(() => {});
    await page.evaluate(() => {
      const item = [...document.querySelectorAll('[role="menu"] button, [role="menuitem"]')]
        .find((element) => element.textContent?.trim() === 'Export');
      if (item instanceof HTMLElement) item.click();
    });
    // One patient wait: a mid-flight dialog must not be interrupted (Escape
    // would close the very dialog we are waiting for).
    pickerReady = await page
      .waitForSelector('[data-export-format-picker]', { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (pickerReady) break;

    // The click truly failed. Check what happened before blindly retrying.
    const scene = await page
      .evaluate(() => ({
        menuOpen: document.querySelectorAll('[role="menu"]').length,
        hasPicker: Boolean(document.querySelector('[data-export-format-picker]')),
        loadingPanel: document.body.innerText.includes('Loading panel'),
      }))
      .catch(() => ({ menuOpen: 0, hasPicker: false, loadingPanel: false }));
    if (scene.hasPicker) {
      pickerReady = true;
      break;
    }
    // Dismiss whatever swallowed the click: an open header menu, a toast, or
    // a floating window (source editor / bridge modal) holding focus.
    await page.keyboard.press('Escape').catch(() => {});
    await page.evaluate(() => {
      // Close floating windows by clicking their close buttons (the draggable
      // window chrome renders an accessible close control).
      const closeButtons = [...document.querySelectorAll('button[title="Close"], button[aria-label="Close"]')];
      closeButtons.forEach((button) => button instanceof HTMLElement && button.click());
    }).catch(() => {});
    await delay(1_000);
  }
  if (!pickerReady) {
    // Preserve the failure scene for post-mortem (what overlay/panel state
    // actually blocked the dialog?).
    await takeScreenshot(page, 'export-dialog-failed', SCREENSHOT_DIR).catch(() => {});
    const probe = await page
      .evaluate(() => ({
        menuOpen: document.querySelectorAll('[role="menu"]').length,
        hasPicker: Boolean(document.querySelector('[data-export-format-picker]')),
        loadingPanel: document.body.innerText.includes('Loading panel'),
        bodyTail: document.body.innerText.slice(-200),
      }))
      .catch(() => null);
    throw new Error(
      `exportViaDialog: export dialog did not open (probe: ${JSON.stringify(probe)})`,
    );
  }
  const formatClicked = await retryPageAction(
    () =>
      page.evaluate((expected) => {
        const button = [...document.querySelectorAll('[data-export-format-picker] button')]
          .find((element) => element.textContent?.trim() === expected && !element.disabled);
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      }, formatLabel),
    15_000,
    `export format button "${formatLabel}"`,
  );
  if (!formatClicked) throw new Error(`exportViaDialog: format button "${formatLabel}" not found`);
  await delay(300);
  // 4. Export ZIP — wait until it is enabled (it stays disabled while a
  //    previous export is still running).
  const zipClicked = await retryPageAction(
    () =>
      page.evaluate(() => {
        const button = [...document.querySelectorAll('button')]
          .find((element) => element.textContent?.trim() === 'Export ZIP' && !element.disabled);
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      }),
    Math.min(timeoutMs, 60_000),
    'Export ZIP button',
  );
  if (!zipClicked) throw new Error('exportViaDialog: Export ZIP button not found/enabled');

  // 5. Wait for the downloaded file to land in downloadDir.
  const filePath = await waitForDownload(client, downloadDir, timeoutMs);
  await delay(500); // let the dialog close / progress overlay clear
  return filePath;
}

/**
 * Resolve the download once it lands in downloadDir. Uses the CDP progress
 * event as the completion signal, then polls for a concrete FILE (not a
 * .crdownload temp) so an empty suggestedFilename can never resolve to the
 * directory itself.
 */
export async function waitForDownload(client, downloadDir, timeoutMs = 120_000) {
  const completed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for export download event in ${downloadDir}`)),
      timeoutMs,
    );
    const cleanup = () => {
      clearTimeout(timer);
      client.off('Browser.downloadProgress', onProgress);
    };
    const onProgress = (event) => {
      if (event.state === 'completed') {
        cleanup();
        resolve(event.suggestedFilename ?? null);
      }
    };
    client.on('Browser.downloadProgress', onProgress);
  });

  let suggested = null;
  try {
    suggested = await completed;
  } catch (error) {
    // Fall through to directory polling — some Puppeteer/Chrome versions do
    // not emit progress events even with eventsEnabled: true.
  }

  const deadline = Date.now() + Math.min(timeoutMs, 60_000);
  while (Date.now() < deadline) {
    const entries = await fs.readdir(downloadDir, { withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile() && !entry.name.endsWith('.crdownload'));
    if (files.length > 0) {
      const match = suggested ? files.find((entry) => entry.name === suggested) : null;
      return path.join(downloadDir, (match ?? files[0]).name);
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for a downloaded file in ${downloadDir}`);
}

// ── Bridge modal driving (GUI assembly) ───────────────────────────────

/** Open the BridgeCreateModal from the tree's Bridges section + button. */
export async function openBridgeModal(page) {
  const createButton = page.locator
    ? null // Puppeteer has no locators; use evaluate below.
    : null;
  const opened = await retryPageAction(
    () =>
      page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find(
          (candidate) => candidate.getAttribute('aria-label') === 'Create Bridge',
        );
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      }),
    15_000,
    'Create Bridge button',
  );
  if (!opened) throw new Error('openBridgeModal: Create Bridge button not found');
  // The modal body is lazy-loaded; wait for the identity fields.
  await page.waitForSelector('[data-bridge-row="identity"]', { timeout: 45_000 });
  await delay(200);
}

/** Switch the endpoint input mode to the flat link-list selects. */
export async function switchBridgeModeLinkList(page) {
  const switched = await page.evaluate(() => {
    // SegmentedControl renders buttons; the Link List one carries the label text.
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((button) => button.textContent?.trim() === 'Link List');
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  });
  if (!switched) throw new Error('switchBridgeModeLinkList: Link List button not found');
  await delay(250);
}

/**
 * Configure one bridge through the GUI: parent/child endpoints via the flat
 * link-list comboboxes (labels like "componentName › linkName"), joint type,
 * and optional limits. Then click Confirm and wait for the modal to close.
 */
export async function createBridgeViaModal(
  page,
  { parentOption, childOption, jointTypeLabel, limits = null, expectConfirmDisabled = false },
) {
  // Endpoints: two PanelSelect comboboxes with aria-labels Parent Link / Child Link.
  await selectCombobox(page, { ariaLabel: UI.parentLink, optionText: parentOption });
  await selectCombobox(page, { ariaLabel: UI.childLink, optionText: childOption });

  // Joint type: combobox whose trigger shows the current type label. It has no
  // stable aria-label, so find it inside the identity row.
  await selectComboboxInBridgeIdentity(page, jointTypeLabel);

  if (limits) {
    // Position limits live in the advanced section, only for revolute/prismatic.
    await openBridgeAdvanced(page);
    if (limits.lower != null) {
      await setNumberInputByAriaOrLabel(page, 'lower', limits.lower);
    }
    if (limits.upper != null) {
      await setNumberInputByAriaOrLabel(page, 'upper', limits.upper);
    }
  }

  const confirmDisabled = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const confirm = buttons.find((button) => button.textContent?.trim() === 'Confirm');
    return confirm ? confirm.disabled : null;
  });

  if (expectConfirmDisabled) {
    // No suite here — return the observed state and let the journey assert.
    if (confirmDisabled !== true) {
      // Clean up the modal before reporting the failure to the caller.
      await dismissBridgeModal(page);
      return { cancelled: true, confirmDisabled, unexpectedEnabled: true };
    }
    // Close the modal without submitting.
    await dismissBridgeModal(page);
    return { cancelled: true, confirmDisabled };
  }

  if (confirmDisabled) {
    throw new Error(`createBridgeViaModal: Confirm unexpectedly disabled (${JSON.stringify({ parentOption, childOption, jointTypeLabel, limits })})`);
  }

  await clickButton(page, { text: UI.confirm });
  // The modal closes first, then defers the commit by one rAF.
  await wait(400);
  return { cancelled: false };
}

async function dismissBridgeModal(page) {
  // Prefer the Cancel footer button; fall back to Escape (the modal listens
  // for it via its floating-window chrome).
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const cancel = buttons.find(
      (button) => /^(cancel|取消)$/i.test(button.textContent?.trim() ?? ''),
    );
    if (cancel instanceof HTMLElement) {
      cancel.click();
      return true;
    }
    return false;
  });
  if (!clicked) {
    await page.keyboard.press('Escape');
  }
  await delay(300);
}

async function selectComboboxInBridgeIdentity(page, jointTypeLabel) {
  const picked = await page.evaluate((expectedOption) => {
    // The identity row's type combobox: the only combobox whose options will
    // include the joint type labels. Open it, then pick from the portal.
    const triggers = [...document.querySelectorAll('button[role="combobox"]')];
    // Prefer the one whose current text is already a joint type label; the
    // endpoint selects are excluded because their triggers show "… › …".
    const typeTrigger =
      triggers.find((button) =>
        ['Fixed', 'Revolute', 'Continuous', 'Prismatic'].includes(button.textContent?.trim() ?? '')) ??
      null;
    if (!typeTrigger) return { ok: false, error: 'type combobox trigger not found' };
    typeTrigger.click();
    return { ok: true };
  }, jointTypeLabel);
  if (!picked.ok) throw new Error(`selectComboboxInBridgeIdentity: ${picked.error}`);

  await page.waitForSelector('[role="option"]', { timeout: 5_000 });
  const committed = await page.evaluate((expectedOption) => {
    const options = [...document.querySelectorAll('[role="option"]')];
    const target = options.find((option) => option.textContent?.trim() === expectedOption);
    if (!(target instanceof HTMLElement)) {
      return { ok: false, available: options.map((o) => o.textContent?.trim()) };
    }
    target.click();
    return { ok: true };
  }, jointTypeLabel);
  if (!committed.ok) {
    throw new Error(`joint type option "${jointTypeLabel}" not found: ${JSON.stringify(committed.available)}`);
  }
  await delay(120);
}

async function openBridgeAdvanced(page) {
  // The advanced section collapses by default; its header button toggles it.
  const opened = await page.evaluate(() => {
    const section = document.querySelector('[data-bridge-advanced]');
    if (section instanceof HTMLElement) {
      if (section.getAttribute('data-bridge-advanced') === 'collapsed') {
        const toggle = section.querySelector('button');
        toggle?.click();
      }
      return true;
    }
    // Fallback: find the "Advanced settings" section title button.
    const buttons = [...document.querySelectorAll('button')];
    const toggle = buttons.find((button) =>
      button.textContent?.includes('Advanced settings'));
    if (toggle) {
      toggle.click();
      return true;
    }
    return false;
  });
  if (!opened) throw new Error('openBridgeAdvanced: advanced section not found');
  await delay(200);
}

async function setNumberInputByAriaOrLabel(page, kind, value) {
  // BridgeSpinnerField renders inputs with explicit aria-labels
  // ("Position Lower Limit"/"Position Upper Limit"). Type through the real
  // keyboard so the spinner's draft value updates before blur commits.
  const ariaLabel = kind === 'lower' ? 'Position Lower Limit' : 'Position Upper Limit';
  const selector = `input[aria-label="${ariaLabel}"]`;
  const focused = await page.evaluate((sel) => {
    const input = document.querySelector(sel);
    if (!(input instanceof HTMLInputElement)) return false;
    input.scrollIntoView({ block: 'center' });
    input.focus();
    input.select();
    return document.activeElement === input;
  }, selector);
  if (!focused) throw new Error(`setNumberInputByAriaOrLabel: "${ariaLabel}" input not focusable`);
  await page.keyboard.type(String(value), { delay: 10 });
  await page.evaluate((sel) => {
    document.querySelector(sel)?.blur();
  }, selector);
  await delay(150);
}

// ── State probes (debug API) ──────────────────────────────────────────

/** Full workspace state: components, bridges, merged projection counts. */
export async function getWorkflowState(page) {
  return page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    const workspace = api?.__workspaceStore__?.getState?.()?.workspace ?? null;
    const projection = api?.__workspaceStore__?.getState?.()?.getSceneProjection?.() ?? null;
    if (!workspace) return { exists: false };
    return {
      exists: true,
      componentCount: Object.keys(workspace.components ?? {}).length,
      bridgeCount: Object.keys(workspace.bridges ?? {}).length,
      components: Object.entries(workspace.components ?? {}).map(([id, c]) => ({
        id,
        name: c.name,
        sourceFile: c.sourceFile,
        linkCount: Object.keys(c.robot?.links ?? {}).length,
        jointCount: Object.keys(c.robot?.joints ?? {}).length,
      })),
      bridges: Object.entries(workspace.bridges ?? {}).map(([id, b]) => ({
        id,
        name: b.name,
        type: b.joint?.type,
        parentComponentId: b.parentComponentId,
        childComponentId: b.childComponentId,
        parentLinkId: b.parentLinkId,
        childLinkId: b.childLinkId,
        limit: b.joint?.limit ?? null,
      })),
      merged: projection
        ? {
            linkCount: Object.keys(projection.robotData?.links ?? {}).length,
            jointCount: Object.keys(projection.robotData?.joints ?? {}).length,
          }
        : null,
      closedLoopConstraintCount: Array.isArray(projection?.closedLoopConstraints)
        ? projection.closedLoopConstraints.length
        : null,
    };
  });
}

/** Wait until the workspace state satisfies a predicate (serialized source). */
export async function waitForWorkflowState(page, predicateSource, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const state = await getWorkflowState(page);
    last = state;
    let satisfied = false;
    try {
      satisfied = new Function('state', `return (${predicateSource})(state);`)(state);
    } catch (error) {
      throw new Error(`waitForWorkflowState predicate threw: ${error.message}`);
    }
    if (satisfied) return state;
    await delay(200);
  }
  throw new Error(`Timed out waiting for workflow state (last: ${JSON.stringify(last).slice(0, 600)})`);
}
