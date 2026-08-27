import { describe, expect, it } from 'vitest';
import { resolveMappedDepartmentWorkspace } from '../../../department-runtime/department-workspace.mjs';

function workspaces(routes) {
  return { cwdFor: (scope) => routes[scope] };
}

describe('department workspace resolution', () => {
  it('uses only an explicit scope or group mapping', () => {
    expect(resolveMappedDepartmentWorkspace({
      scope: 'oc_group',
      chatId: 'oc_group',
      workspaces: workspaces({}),
    })).toBeNull();
    expect(resolveMappedDepartmentWorkspace({
      scope: 'oc_group',
      chatId: 'oc_group',
      workspaces: workspaces({ oc_group: '/srv/department' }),
    })).toBe('/srv/department');
  });

  it('allows a topic to inherit the explicit group mapping', () => {
    expect(resolveMappedDepartmentWorkspace({
      scope: 'oc_group:thread_1',
      chatId: 'oc_group',
      workspaces: workspaces({ oc_group: '/srv/group-department' }),
    })).toBe('/srv/group-department');
    expect(resolveMappedDepartmentWorkspace({
      scope: 'oc_group:thread_1',
      chatId: 'oc_group',
      workspaces: workspaces({}),
    })).toBeNull();
  });
});
