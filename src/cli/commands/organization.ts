import { resolveAppPaths } from '../../config/app-paths';
import { doctorOrganization, type OrganizationDoctorReport } from '../../organization/doctor';
import { ensureDefaultOrganization } from '../../organization/initializer';

interface OrganizationCommandOptions {
  rootDir?: string;
  initialize?: boolean;
  output?: (line: string) => void;
}

export async function runOrganizationStatus(
  options: OrganizationCommandOptions = {},
): Promise<OrganizationDoctorReport> {
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  if (options.initialize !== false) await ensureDefaultOrganization({ rootDir });
  const report = await doctorOrganization({ rootDir });
  printReport(report, options.output ?? console.log);
  return report;
}

export async function runOrganizationDoctor(
  options: OrganizationCommandOptions = {},
): Promise<OrganizationDoctorReport> {
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  if (options.initialize !== false) await ensureDefaultOrganization({ rootDir });
  const report = await doctorOrganization({ rootDir });
  printReport(report, options.output ?? console.log, true);
  return report;
}

function printReport(
  report: OrganizationDoctorReport,
  output: (line: string) => void,
  detailed = false,
): void {
  output(`organization: ${report.organizationId}`);
  output(`status: ${report.ready ? 'ready' : 'not-ready'}`);
  output(`root: ${report.organizationRoot}`);
  if (detailed) {
    for (const check of report.checks) {
      output(`${check.ok ? 'ok' : 'fail'} ${check.id}: ${check.detail}`);
    }
  }
}
