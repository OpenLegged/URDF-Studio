import test from 'node:test'
import assert from 'node:assert/strict'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'

import { translations } from '@/shared/i18n'
import { GeometryType, type RobotState } from '@/types'
import { buildNormalInspectionPlan } from '../utils/inspectionNormalPlan.ts'
import { InspectionSetupNormalView } from './InspectionSetupNormalView.tsx'

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })

  ;(globalThis as { window?: Window }).window = dom.window as unknown as Window
  ;(globalThis as { document?: Document }).document = dom.window.document
  ;(globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement
  ;(globalThis as { Node?: typeof Node }).Node = dom.window.Node
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  return dom
}

const createRobot = (): RobotState =>
  ({
    name: 'normal-plan-robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.1, z: 0.1 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#999999',
        },
      },
    },
    joints: {},
    inspectionContext: { sourceFormat: 'urdf' },
    selection: null,
  }) as unknown as RobotState

test('normal setup view shows the profile recommendation card', async () => {
  const dom = installDom()
  const container = dom.window.document.getElementById('root')
  assert.ok(container, 'root container should exist')

  const root = createRoot(container)
  const plan = buildNormalInspectionPlan({ robot: createRobot() })

  try {
    await act(async () => {
      root.render(
        <InspectionSetupNormalView
          t={translations.en}
          automaticPlan={plan}
          override={{}}
          onOverrideChange={() => {}}
        />,
      )
    })

    const card = container.querySelector<HTMLElement>('[data-inspection-recognition-panel="true"]')
    assert.ok(card, 'expected the recommendation card to render')
    assert.match(
      card.className,
      /\boverflow-hidden\b/,
      'recommendation card should clip child backgrounds to its rounded corners',
    )
    assert.match(card.textContent ?? '', /Recommended Plan/)
    assert.match(card.textContent ?? '', /URDF/)
    assert.match(card.textContent ?? '', /Inspection Purpose/)
    const selects = Array.from(card.querySelectorAll('select'))
    assert.equal(selects.length, 4)
    assert.equal(
      selects.every((select) => select.value === ''),
      true,
      'automatic recommendation should remain selected until the user adds an override',
    )
    assert.match(card.textContent ?? '', /PurposeAuto/)
    assert.equal(
      card.querySelectorAll('[data-inspection-recognition-auto]').length,
      4,
    )
    assert.equal(selects[0]?.selectedOptions[0]?.textContent, 'Basic Health')

    // The check editor / profile rows used to live here too; they have moved entirely to professional mode.
    assert.equal(
      container.querySelector('[data-inspection-normal-check-editor="true"]'),
      null,
      'normal mode should not render the direct check editor anymore',
    )
    assert.equal(
      container.querySelector('[data-inspection-normal-profile-row]'),
      null,
      'normal mode should not render profile rows anymore',
    )

    await act(async () => {
      root.render(
        <InspectionSetupNormalView
          t={translations.en}
          automaticPlan={plan}
          override={{ sourceFormat: 'mjcf' }}
          onOverrideChange={() => {}}
        />,
      )
    })
    assert.equal(
      container.querySelector('[data-inspection-normal-check-editor="true"]'),
      null,
      'normal mode should still hide the check editor after the recommendation changes',
    )
  } finally {
    await act(async () => {
      root.unmount()
    })
    dom.window.close()
  }
})
