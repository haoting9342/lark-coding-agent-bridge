export function resolveMappedDepartmentWorkspace({ scope, chatId, workspaces } = {}) {
  if (!workspaces || typeof workspaces.cwdFor !== 'function') return null;
  const scopedWorkspace = workspaces.cwdFor(scope);
  if (typeof scopedWorkspace === 'string' && scopedWorkspace) return scopedWorkspace;
  if (scope === chatId) return null;
  const groupWorkspace = workspaces.cwdFor(chatId);
  return typeof groupWorkspace === 'string' && groupWorkspace
    ? groupWorkspace
    : null;
}
