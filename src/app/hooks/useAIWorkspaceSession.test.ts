import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';

import type { InspectionReport, RobotState } from '@/types';
import { renderHook } from '../../../scripts/test/helpers/react-hook-harness';
import { useAIWorkspaceSession } from './useAIWorkspaceSession';

function robot(name = 'Robot'): RobotState {
  return { name, links: {}, joints: {}, rootLinkId: '', selection: { type: null, id: null } };
}

function renderSession(context: Parameters<typeof renderHook>[0]) {
  let allowed = true;
  let snapshot = robot();
  const preloads: string[] = [];
  const rendered = renderHook(context, () => useAIWorkspaceSession({
    canEnter: () => allowed,
    readRobotSnapshot: () => snapshot,
    prefetchInspection: () => { preloads.push('inspection'); },
    prefetchConversation: () => { preloads.push('conversation'); },
  }));
  return {
    ...rendered,
    get current() { return rendered.current; },
    preloads,
    setAllowed(value: boolean) { allowed = value; },
    setSnapshot(value: RobotState) { snapshot = value; },
  };
}

test('AI entry guards prevent mounting or replacing sessions while unavailable', (context) => {
  const session = renderSession(context);
  session.setAllowed(false);
  act(() => {
    assert.equal(session.current.openInspection(), false);
    assert.equal(session.current.openConversation(), false);
    session.current.followUpReport({ summary: '', overallScore: 0, issues: [] }, robot());
  });
  assert.equal(session.current.inspectionMounted, false);
  assert.equal(session.current.conversationMounted, false);
  assert.equal(session.current.conversationContext, null);
  assert.deepEqual(session.preloads, []);
});

test('AI commands preserve an open conversation and explicitly control window coexistence', (context) => {
  const session = renderSession(context);
  act(() => { session.current.openConversation(); });
  const initialContext = session.current.conversationContext;
  assert.ok(initialContext);
  act(() => {
    session.current.openInspection({ coexist: true });
    session.current.openConversation();
  });
  assert.equal(session.current.conversationContext, initialContext);
  assert.equal(session.current.conversationOpen, true);
  assert.equal(session.current.inspectionOpen, false);
  assert.equal(session.current.inspectionMounted, true);
  act(() => { session.current.openInspection({ coexist: true }); });
  assert.equal(session.current.conversationOpen, true);
  assert.equal(session.current.inspectionOpen, true);
  act(() => { session.current.closeInspection(); });
  assert.equal(session.current.conversationOpen, true);
  assert.equal(session.current.inspectionMounted, true);
  act(() => { session.current.openInspection(); });
  assert.equal(session.current.conversationOpen, false);
  assert.equal(session.current.conversationMounted, true);
});

test('closing and reopening a general conversation creates a fresh snapshot and identity', (context) => {
  const session = renderSession(context);
  act(() => { session.current.openConversation(); });
  const initialContext = session.current.conversationContext;
  assert.ok(initialContext);
  session.setSnapshot(robot('Updated robot'));
  act(() => {
    session.current.closeConversation();
    session.current.openConversation();
  });
  assert.ok(session.current.conversationContext);
  assert.equal(session.current.conversationContext.robotSnapshot.name, 'Updated robot');
  assert.ok(session.current.conversationContext.sessionId > initialContext.sessionId);
});

test('inspection follow-up keeps its report and focus when starting a new conversation', (context) => {
  const session = renderSession(context);
  const report: InspectionReport = {
    summary: 'Review the joint', overallScore: 72,
    issues: [{
      type: 'warning', title: 'Range', description: 'Narrow joint range',
      profileId: 'base.kinematics', itemId: 'joint_range',
    }],
  };
  act(() => {
    session.current.openInspection();
    session.current.followUpReport(report, robot('Inspected robot'), {
      selectedEntity: null,
      focusedIssue: report.issues[0],
    });
  });
  assert.equal(session.current.inspectionOpen, true);
  assert.equal(session.current.conversationOpen, true);
  const initialContext = session.current.conversationContext;
  assert.ok(initialContext);
  report.summary = 'Changed externally';
  session.setSnapshot(robot('Live robot'));
  act(() => { session.current.startNewConversation(); });
  const nextContext = session.current.conversationContext;
  assert.ok(nextContext);
  assert.ok(nextContext.sessionId > initialContext.sessionId);
  assert.equal(nextContext.mode, 'inspection-followup');
  assert.equal(nextContext.robotSnapshot.name, 'Live robot');
  assert.equal(nextContext.inspectionReportSnapshot?.summary, 'Review the joint');
  assert.equal(nextContext.focusedIssue?.title, 'Range');
});
