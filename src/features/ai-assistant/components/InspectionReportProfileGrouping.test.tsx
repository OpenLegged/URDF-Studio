import test from 'node:test'
import assert from 'node:assert/strict'

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import type { InspectionReport } from '@/types'
import type { RobotState } from '@/types'
import { translations } from '@/shared/i18n'
import { buildInspectionProfileSections, InspectionReportView } from './InspectionReport.tsx'

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  })

  ;(globalThis as { window?: Window }).window = dom.window as unknown as Window
  ;(globalThis as { document?: Document }).document = dom.window.document
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  })
  ;(globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement
  ;(globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement
  ;(globalThis as { Node?: typeof Node }).Node = dom.window.Node
  ;(globalThis as { Event?: typeof Event }).Event = dom.window.Event
  ;(globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent
  ;(globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window)
  ;(globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window)
  ;(globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window)
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  return dom
}

const robotFixture: RobotState = {
  name: 'report-layout-fixture',
  rootLinkId: 'base_link',
  links: {},
  joints: {},
  inspectionContext: undefined,
  selection: { type: null, id: null },
}

test('buildInspectionProfileSections groups report issues by executable profile items', () => {
  const issues: InspectionReport['issues'] = [
    {
      type: 'warning',
      title: 'Invalid inertia',
      description: 'Mass should be positive.',
      profileId: 'base.physical_plausibility',
      itemId: 'mass_positive',
      score: 4,
    },
    {
      type: 'error',
      title: 'URDF root missing',
      description: 'The root contract is invalid.',
      profileId: 'format.urdf',
      itemId: 'urdf_robot_root',
      score: 0,
    },
  ]

  const sections = buildInspectionProfileSections(issues, 'en', {
    'base.physical_plausibility': 4,
    'format.urdf': 0,
  })

  assert.deepEqual(
    sections.map((section) => section.profileId),
    ['base.physical_plausibility', 'format.urdf'],
  )
  assert.equal(sections[0]?.profileName, 'Physical Plausibility')
  assert.equal(sections[0]?.itemGroups[0]?.itemId, 'mass_positive')
  assert.equal(sections[0]?.profileScore, 4)
})

test('inspection report renders profile items as row groups instead of nested cards', async () => {
  const dom = installDom()
  const container = dom.window.document.getElementById('root')
  assert.ok(container, 'root container should exist')

  const root = createRoot(container)
  const report: InspectionReport = {
    summary: 'Layout summary',
    overallScore: 4,
    maxScore: 10,
    profileScores: {
      'base.physical_plausibility': 4,
    },
    issues: [
      {
        type: 'warning',
        title: 'Invalid inertia',
        description: 'Mass should be positive.',
        profileId: 'base.physical_plausibility',
        itemId: 'mass_positive',
        score: 4,
      },
    ],
  }

  try {
    await act(async () => {
      root.render(
        <InspectionReportView
          report={report}
          robot={robotFixture}
          lang="en"
          t={translations.en}
          expandedProfiles={new Set(['base.physical_plausibility'])}
          retestingItem={null}
          isGeneratingAI={false}
          onToggleProfile={() => {}}
          onRetestItem={() => {}}
          onDownloadPDF={() => {}}
          onSelectItem={() => {}}
          onAskAboutIssue={() => {}}
        />,
      )
    })

    const itemRow = container.querySelector<HTMLElement>('[data-inspection-report-item-row]')
    const issueRow = container.querySelector<HTMLElement>('[data-inspection-report-issue-row]')
    const issueIcon = container.querySelector<HTMLElement>('[data-inspection-report-issue-icon]')

    assert.ok(itemRow, 'expected the expanded profile to render item groups as list rows')
    assert.ok(issueRow, 'expected issue details to render as compact rows inside the item group')
    assert.ok(issueIcon, 'expected issue details to render a status icon')
    assert.match(issueIcon.className, /\bh-9\b/)
    assert.match(issueIcon.className, /\bw-9\b/)
    assert.match(issueIcon.className, /\bself-start\b/)
    assert.equal(
      itemRow.classList.contains('shadow-sm'),
      false,
      'report item rows should avoid another card shadow layer',
    )
  } finally {
    await act(async () => {
      root.unmount()
    })
    dom.window.close()
  }
})
