import { ALLOWED_DRAFT_FIELDS, assertDepartmentDraft } from './department-draft-schema.mjs';

const CONFIRMATIONS = new Set(['同意创建', '确认创建', '按这个方案创建', '确认部门创建']);
const STATUSES = new Set(['designing', 'awaiting_confirmation', 'confirmed', 'failed']);

function restoreState(state, draft) {
  if (state === undefined) {
    return { status: 'designing', revision: 0, draft: structuredClone(draft), history: [] };
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('WorkBuddy session state must be an object');
  if (!STATUSES.has(state.status)) throw new Error(`invalid WorkBuddy session status: ${state.status}`);
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error('invalid WorkBuddy session revision');
  if (!state.draft || typeof state.draft !== 'object' || Array.isArray(state.draft)) throw new Error('invalid WorkBuddy session draft');
  if (!Array.isArray(state.history)) throw new Error('invalid WorkBuddy session history');
  return structuredClone(state);
}

export class WorkBuddyDesignSession {
  constructor({ draft = {}, state, now = () => new Date(), onSnapshot = () => {} } = {}) {
    this.now = now;
    this.onSnapshot = onSnapshot;
    this.state = restoreState(state, draft);
  }

  start() {
    return this.snapshot();
  }

  applyProposal(proposal, { source = 'ai_proposal', changedPaths = [] } = {}) {
    if (this.state.status === 'confirmed') throw new Error('confirmed WorkBuddy design cannot be changed');
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
      throw new Error('WorkBuddy design proposal must be an object');
    }
    const unknownFields = Object.keys(proposal).filter((field) => !ALLOWED_DRAFT_FIELDS.has(field));
    if (unknownFields.length) throw new Error(`unknown WorkBuddy draft field(s): ${unknownFields.join(', ')}`);
    const draft = { ...this.state.draft, ...structuredClone(proposal) };
    this.state = {
      ...this.state,
      status: 'designing',
      revision: this.state.revision + 1,
      draft,
      history: [...this.state.history, { revision: this.state.revision + 1, source, changedPaths, at: this.now().toISOString() }],
    };
    this.onSnapshot(this.snapshot());
    return this.snapshot();
  }

  requestConfirmation() {
    if (this.state.status === 'confirmed') return this.snapshot();
    const draft = assertDepartmentDraft(this.state.draft, { requireReady: true });
    this.state = { ...this.state, status: 'awaiting_confirmation', draft };
    this.onSnapshot(this.snapshot());
    return this.snapshot();
  }

  acceptMessage(message) {
    const normalized = String(message ?? '').trim();
    if (this.state.status !== 'awaiting_confirmation' || !CONFIRMATIONS.has(normalized)) {
      return { confirmed: false, state: this.snapshot() };
    }
    this.state = { ...this.state, status: 'confirmed', confirmedAt: this.now().toISOString() };
    this.onSnapshot(this.snapshot());
    return { confirmed: true, state: this.snapshot() };
  }

  markFailed(error) {
    this.state = {
      ...this.state,
      status: 'failed',
      failedAt: this.now().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    this.onSnapshot(this.snapshot());
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.state);
  }
}

export { CONFIRMATIONS as WORKBUDDY_CREATION_CONFIRMATIONS };
