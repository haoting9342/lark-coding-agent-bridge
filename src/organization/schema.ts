export const ORGANIZATION_SCHEMA_VERSION = 1;
export const ORGANIZATION_TEMPLATE_VERSION = '1.0.0';

export interface OrganizationManifest {
  schemaVersion: 1;
  templateVersion: string;
  organizationId: string;
  primaryNodeId: string;
  createdAt: string;
}

export function parseOrganizationManifest(input: unknown): OrganizationManifest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('organization manifest must be an object');
  }
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== ORGANIZATION_SCHEMA_VERSION) {
    throw new Error(`organization schemaVersion must be ${ORGANIZATION_SCHEMA_VERSION}`);
  }
  if (typeof value.templateVersion !== 'string' || !value.templateVersion) {
    throw new Error('organization templateVersion is required');
  }
  if (typeof value.organizationId !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(value.organizationId)) {
    throw new Error('organizationId is invalid');
  }
  if (typeof value.primaryNodeId !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(value.primaryNodeId)) {
    throw new Error('primaryNodeId is invalid');
  }
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new Error('organization createdAt must be an ISO timestamp');
  }
  return value as unknown as OrganizationManifest;
}
