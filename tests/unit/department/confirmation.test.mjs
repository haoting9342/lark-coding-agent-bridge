import { describe, expect, it } from 'vitest';
import { classifyDepartmentConfirmation } from '../../../department-runtime/department-confirmation.mjs';

describe('department final confirmation boundary', () => {
  it('accepts only explicit unconditional confirmation in the final phase', () => {
    for (const text of ['同意', '确认', '同意创建', '确认创建', '按这个方案创建', ' 同意。 ']) {
      expect(classifyDepartmentConfirmation({
        phase: 'awaiting_final_confirmation',
        text,
      })).toEqual({ action: 'confirm' });
    }
  });

  it('keeps local acceptance and conditional changes in discussion', () => {
    for (const text of ['好的', '可以', '👍', '同意，但是审批边界还要改', '确认，不过先改一下职责']) {
      expect(classifyDepartmentConfirmation({
        phase: 'awaiting_final_confirmation',
        text,
      }).action).not.toBe('confirm');
    }
    for (const phase of ['awaiting_name', 'designing', 'needs_revision', 'paused']) {
      expect(classifyDepartmentConfirmation({ phase, text: '同意' })).toEqual({ action: 'discuss' });
    }
  });
});
