import { describe, expect, it } from 'vitest';
import { WorkBuddyDesignSession } from '../../../department-runtime/workbuddy-design-session.mjs';

function readyDraft() {
  return {
    departmentName: '内容部', kind: 'permanent', purpose: '内容生产', workspace: '/tmp/workbuddy-project',
    responsibilities: ['选题'], outOfScope: [], workflow: ['理解', '执行'], businessLifecycle: [],
    taskProtocols: [], capabilityPlan: [], approvalBoundaries: ['发布前确认'], confirmedFacts: [],
    historicalRules: [], contextSources: [], openQuestions: [], mission: '内容生产', serviceCatalog: ['内容'],
    recurringWorkflows: [], defaultProjects: [], taskTypes: ['内容'], lifecycle: 'active',
  };
}

describe('WorkBuddy design session', () => {
  it('allows an incomplete proposal during free discussion', () => {
    const session = new WorkBuddyDesignSession();
    const state = session.applyProposal({ departmentName: '内容部' }, { changedPaths: ['departmentName'] });

    expect(state.status).toBe('designing');
    expect(state.draft).toEqual({ departmentName: '内容部' });
    expect(state.history[0].changedPaths).toEqual(['departmentName']);
  });

  it('does not enter confirmation until the draft is complete', () => {
    const session = new WorkBuddyDesignSession();
    session.applyProposal({ departmentName: '内容部' });

    expect(() => session.requestConfirmation()).toThrow();
    expect(session.snapshot().status).toBe('designing');
  });

  it('does not confirm on vague agreement but does on explicit creation', () => {
    const session = new WorkBuddyDesignSession({ draft: readyDraft() });
    expect(session.start().status).toBe('designing');
    expect(session.acceptMessage('同意创建').confirmed).toBe(false);
    expect(session.requestConfirmation().status).toBe('awaiting_confirmation');
    expect(session.acceptMessage('可以').confirmed).toBe(false);
    expect(session.acceptMessage('同意创建').confirmed).toBe(true);
    expect(session.acceptMessage('确认创建').state.status).toBe('confirmed');
  });

  it('restores a persisted session and records provisioning failures', () => {
    const first = new WorkBuddyDesignSession();
    const persisted = first.applyProposal({ departmentName: '内容部' }, {
      source: 'workbuddy_conversation',
      changedPaths: ['departmentName'],
    });
    const restored = new WorkBuddyDesignSession({ state: persisted });

    expect(restored.snapshot()).toEqual(persisted);
    const failed = restored.markFailed(new Error('写入失败'));
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('写入失败');
  });
});
