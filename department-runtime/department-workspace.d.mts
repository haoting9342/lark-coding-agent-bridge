export interface DepartmentWorkspaceContext {
  scope?: string;
  chatId?: string;
  workspaces?: {
    cwdFor(scope?: string): string | undefined;
  };
}

export function resolveMappedDepartmentWorkspace(
  context?: DepartmentWorkspaceContext,
): string | null;
