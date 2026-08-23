import { join } from 'node:path';

export const DEFAULT_ORGANIZATION_ID = 'default';

export function organizationsRoot(rootDir: string): string {
  return join(rootDir, 'organizations');
}

export function organizationRoot(
  rootDir: string,
  organizationId = DEFAULT_ORGANIZATION_ID,
): string {
  if (!/^[a-z][a-z0-9_-]*$/.test(organizationId)) {
    throw new Error(`invalid organization id: ${organizationId}`);
  }
  return join(organizationsRoot(rootDir), organizationId);
}
