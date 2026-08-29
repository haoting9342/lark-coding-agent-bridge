import { Command } from 'commander';
import pkg from '../../package.json';
import { formatAgentPreflightDiagnostic, getAgentPreflightDiagnostic } from '../agent/preflight';
import { runKillCli, runPs } from './commands/ps';
import {
  runSecretsGet,
  runSecretsList,
  runSecretsRemove,
  runSecretsSet,
} from './commands/secrets';
import {
  runProfileCreate,
  runProfileExport,
  runProfileList,
  runProfileRemove,
  runProfileUse,
} from './commands/profile';
import {
  runServiceRestart,
  runServiceStart,
  runServiceStatus,
  runServiceStop,
  runServiceUnregister,
} from './commands/service';
import { runStart } from './commands/start';
import { runUi } from './commands/ui';
import { runOrganizationDoctor, runOrganizationStatus } from './commands/organization';
import {
  runOrganizationWorkflowApply,
  runOrganizationWorkflowProtocol,
  runOrganizationWorkflowShow,
} from './commands/organization-workflow';
import {
  runOrganizationHandoffOperation,
  runOrganizationHandoffServe,
  runOrganizationHandoffStatus,
  runOrganizationHandoffSubmit,
  runOrganizationNodeList,
  runOrganizationNodePlan,
  runOrganizationNodeRegister,
  runOrganizationNodeActivate,
} from './commands/organization-node';
import { runWorkBuddyCreate } from './commands/workbuddy';

const program = new Command();

program
  .name('lark-channel-bridge-department')
  .description('Feishu/Lark bridge with conversational department organization management')
  .version(pkg.version, '-v, --version');

// === process-level commands (work directly on bridge processes) ===

program
  .command('run')
  .description('Run the bridge in the foreground (was `start` in older versions)')
  .option('-c, --config <path>', 'path to config file')
  .option('--profile <name>', 'profile name to run')
  .option('--web-ui', 'run the machine-wide supervisor + local web console (hosts all profiles); default is a single-profile headless run')
  .option('--agent <kind>', 'agent kind for a new profile (claude or codex)')
  .option('--workspace <path>', 'initial working directory for first-run profile bootstrap')
  .option('--app-id <id>', 'use an existing Lark/Feishu app instead of QR app creation')
  .option('--app-secret <secret>', 'App Secret for --app-id; prefer interactive input on shared machines')
  .option('--tenant <tenant>', 'tenant for --app-id (feishu or lark; default feishu)')
  .option('--skip-check-lark-cli', 'skip lark-cli pre-flight check (auto-install + bind)')
  .action(async (opts: {
    config?: string;
    profile?: string;
    webUi?: boolean;
    agent?: string;
    workspace?: string;
    appId?: string;
    appSecret?: string;
    tenant?: string;
    skipCheckLarkCli?: boolean;
  }) => {
    await runStart(opts);
  });

const profile = program
  .command('profile')
  .description('Manage local bridge profiles');

const organization = program
  .command('organization')
  .description('Inspect the bundled department organization control plane');

organization
  .command('status')
  .description('Show the default organization status')
  .action(async () => {
    await runOrganizationStatus();
  });

organization
  .command('doctor')
  .description('Validate the default organization control plane')
  .action(async () => {
    const report = await runOrganizationDoctor();
    if (!report.ready) process.exitCode = 1;
  });

const organizationWorkflow = organization
  .command('workflow')
  .description('Inspect or safely update an existing department workflow');

organizationWorkflow
  .command('show <department-id>')
  .description('Print the authoritative workflow, revision, and SHA-256')
  .action(async (departmentId: string) => {
    await runOrganizationWorkflowShow(departmentId);
  });

organizationWorkflow
  .command('protocol <department-id> <protocol-id>')
  .description('Print one task protocol without loading unrelated protocols')
  .action(async (departmentId: string, protocolId: string) => {
    await runOrganizationWorkflowProtocol(departmentId, protocolId);
  });

organizationWorkflow
  .command('apply <department-id>')
  .description('Apply one confirmed, hash-guarded workflow update request from stdin')
  .action(async (departmentId: string) => {
    await runOrganizationWorkflowApply(departmentId);
  });

const organizationNode = organization
  .command('node')
  .description('Inspect or plan optional multi-host organization nodes');

organizationNode
  .command('list')
  .description('List registered organization nodes')
  .action(async () => {
    await runOrganizationNodeList();
  });

organizationNode
  .command('plan <node-id>')
  .description('Print a non-mutating auxiliary-node pairing plan')
  .requiredOption('--host <alias>', 'primary host alias used by the auxiliary node')
  .option('--capability <id>', 'capability owned by this node', (value, previous: string[]) => [...previous, value], [])
  .action(async (nodeId: string, opts: { host: string; capability: string[] }) => {
    await runOrganizationNodePlan(nodeId, {
      hostAlias: opts.host,
      capabilities: opts.capability,
    });
  });

organizationNode
  .command('register <plan-file>')
  .description('Register an auxiliary node after separate SSH identity setup')
  .requiredOption('--actor-node <id>', 'primary node authorizing the registration')
  .requiredOption('--fingerprint <sha256>', 'dedicated SSH public-key fingerprint')
  .action(async (planFile: string, opts: { actorNode: string; fingerprint: string }) => {
    await runOrganizationNodeRegister(planFile, {
      actorNodeId: opts.actorNode,
      fingerprint: opts.fingerprint,
    });
  });

organizationNode
  .command('activate <node-id>')
  .description('Mark a separately paired auxiliary node online')
  .requiredOption('--actor-node <id>', 'primary node authorizing activation')
  .requiredOption('--profile <name>', 'bridge profile on the auxiliary node')
  .requiredOption('--workspace <path>', 'absolute auxiliary workspace path')
  .action(async (nodeId: string, opts: { actorNode: string; profile: string; workspace: string }) => {
    await runOrganizationNodeActivate(nodeId, {
      actorNodeId: opts.actorNode,
      bridgeProfile: opts.profile,
      workspace: opts.workspace,
    });
  });

organization
  .command('handoff-serve <node-id>')
  .description('Serve one paired node through an SSH forced-command allowlist')
  .action(async (nodeId: string) => {
    await runOrganizationHandoffServe(nodeId);
  });

organization
  .command('handoff-operation <department-id> <node-id> <operation>')
  .description('Fixed JSON operation endpoint for a forced-command SSH pairing')
  .action(async (departmentId: string, nodeId: string, operationName: string) => {
    await runOrganizationHandoffOperation(departmentId, nodeId, operationName);
  });

organization
  .command('handoff-submit <department-id>')
  .description('Route one bounded JSON task from stdin to the capable department node')
  .action(async (departmentId: string) => {
    await runOrganizationHandoffSubmit(departmentId);
  });

organization
  .command('handoff-status <department-id> <task-id>')
  .description('Read a handoff receipt for primary-node synthesis')
  .action(async (departmentId: string, taskId: string) => {
    await runOrganizationHandoffStatus(departmentId, taskId);
  });

const workbuddy = program
  .command('workbuddy')
  .description('在 WorkBuddy 工作区创建本地部门，不部署飞书桥接');

workbuddy
  .command('create')
  .description('创建 WorkBuddy 部门包并写入工作区 AGENTS.md')
  .option('--spec <path>', '部门规格 JSON 文件')
  .option('--workspace <path>', '工作区绝对路径')
  .option('--name <name>', '部门名称')
  .option('--purpose <text>', '部门目标')
  .option('--responsibility <text>', '部门职责，可重复指定', (value, previous: string[]) => [...previous, value], [])
  .option('--department-id <id>', '部门编号')
  .action(async (opts: {
    spec?: string;
    workspace?: string;
    name?: string;
    purpose?: string;
    responsibility?: string[];
    departmentId?: string;
  }) => {
    await runWorkBuddyCreate(opts);
  });

profile
  .command('list')
  .description('List configured profiles')
  .action(async () => {
    await runProfileList();
  });

profile
  .command('create <name>')
  .description('Create a profile from QR registration or existing app credentials')
  .option('--agent <kind>', 'agent kind (claude or codex)')
  .option('--workspace <path>', 'initial working directory for this profile')
  .option('--app-id <id>', 'use an existing Lark/Feishu app instead of QR app creation')
  .option('--app-secret <secret>', 'App Secret for --app-id; prefer interactive input on shared machines')
  .option('--tenant <tenant>', 'tenant for --app-id (feishu or lark; default feishu)')
  .action(async (name: string, opts: {
    agent?: string;
    workspace?: string;
    appId?: string;
    appSecret?: string;
    tenant?: string;
  }) => {
    await runProfileCreate(name, opts);
  });

profile
  .command('use <name>')
  .description('Set the active profile')
  .action(async (name: string) => {
    await runProfileUse(name);
  });

profile
  .command('remove <name>')
  .description('Archive a profile and its local state')
  .option('--purge', 'permanently delete profile state instead of archiving')
  .option('--yes', 'confirm destructive profile deletion')
  .action(async (name: string, opts: { purge?: boolean; yes?: boolean }) => {
    await runProfileRemove(name, { purge: opts.purge, yes: opts.yes });
  });

profile
  .command('export <name>')
  .description('Export one profile as JSON')
  .option('--output <path>', 'write export JSON to a file instead of stdout')
  .option('--force', 'overwrite an existing output file')
  .option('--include-secrets', 'include secret provider configuration and app secret values')
  .option('--yes', 'confirm exporting secrets')
  .action(async (name: string, opts: {
    output?: string;
    force?: boolean;
    includeSecrets?: boolean;
    yes?: boolean;
  }) => {
    await runProfileExport(name, {
      output: opts.output,
      force: opts.force,
      includeSecrets: opts.includeSecrets,
      yes: opts.yes,
    });
  });

program
  .command('ui')
  .description('Open the local web console (config, profiles, online bots) in your browser')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .option('--print', 'print the URL instead of opening a browser')
  .action(async (opts: { profile?: string; print?: boolean }) => {
    await runUi(opts);
  });

program
  .command('ps')
  .description('List running bridge processes on this machine')
  .action(() => {
    runPs();
  });

program
  .command('kill <target>')
  .description('Kill a running bridge process by short id or list index (SIGTERM, then SIGKILL after 2s). Was `stop <target>` in older versions.')
  .action(async (target: string) => {
    await runKillCli(target);
  });

// === service-level commands (OS-managed daemon: launchd/systemd/schtasks) ===

program
  .command('start')
  .description('Install (if needed) and start the bridge as an OS-managed daemon')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .option('--web-ui', 'run the supervisor + web console as the background service (hosts all profiles) instead of a single profile')
  .option('--agent <kind>', 'agent kind for first-run profile bootstrap (claude or codex)')
  .option('--workspace <path>', 'initial working directory for first-run profile bootstrap')
  .option('--app-id <id>', 'use an existing Lark/Feishu app instead of QR app creation')
  .option('--app-secret <secret>', 'App Secret for --app-id; prefer interactive input on shared machines')
  .option('--tenant <tenant>', 'tenant for --app-id (feishu or lark; default feishu)')
  .option('--skip-check-lark-cli', 'skip lark-cli pre-flight check (auto-install + bind)')
  .action(async (opts: {
    profile?: string;
    webUi?: boolean;
    agent?: string;
    workspace?: string;
    appId?: string;
    appSecret?: string;
    tenant?: string;
    skipCheckLarkCli?: boolean;
  }) => {
    await runServiceStart(opts);
  });

program
  .command('stop')
  .description('Stop the OS-managed daemon and disable autostart (service definition stays)')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .option('--web-ui', 'target the supervisor service (auto-detected when no per-profile service exists)')
  .action(async (opts: { profile?: string; webUi?: boolean }) => {
    await runServiceStop({ profile: opts.profile, webUi: opts.webUi });
  });

program
  .command('restart')
  .description('Restart the OS-managed daemon')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .option('--web-ui', 'target the supervisor service instead of a per-profile one')
  .action(async (opts: { profile?: string; webUi?: boolean }) => {
    await runServiceRestart({ profile: opts.profile, webUi: opts.webUi });
  });

program
  .command('status')
  .description('Show OS service status (pid, last exit, log paths)')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .option('--web-ui', 'target the supervisor service instead of a per-profile one')
  .action(async (opts: { profile?: string; webUi?: boolean }) => {
    await runServiceStatus({ profile: opts.profile, webUi: opts.webUi });
  });

program
  .command('unregister')
  .description('Remove the OS service registration (bootout + delete plist)')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .option('--web-ui', 'target the supervisor service instead of a per-profile one')
  .action(async (opts: { profile?: string; webUi?: boolean }) => {
    await runServiceUnregister({ profile: opts.profile, webUi: opts.webUi });
  });

const secrets = program
  .command('secrets')
  .description('Manage the bridge\'s encrypted secret keystore (~/.lark-channel-department/profiles/<profile>/secrets.enc)');

secrets
  .command('get')
  .description('Exec-provider protocol: read JSON request from stdin, write JSON response to stdout. Used by lark-cli config bind --source lark-channel.')
  .action(async () => {
    await runSecretsGet();
  });

secrets
  .command('set')
  .description('Encrypt and store an App Secret. Prompts for the secret without echoing.')
  .requiredOption('--app-id <id>', 'App ID (e.g. cli_xxxxxxxxxxxx)')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .action(async (opts: { appId: string; profile?: string }) => {
    await runSecretsSet(opts.appId, { profile: opts.profile });
  });

secrets
  .command('list')
  .description('List the IDs of secrets in the encrypted keystore (no secrets shown)')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .action(async (opts: { profile?: string }) => {
    await runSecretsList({ profile: opts.profile });
  });

secrets
  .command('remove')
  .description('Delete an entry from the encrypted keystore')
  .requiredOption('--app-id <id>', 'App ID to remove')
  .option('--profile <name>', 'profile name (defaults to active profile)')
  .action(async (opts: { appId: string; profile?: string }) => {
    await runSecretsRemove(opts.appId, { profile: opts.profile });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const diagnostic = getAgentPreflightDiagnostic(err);
  if (diagnostic) {
    console.error(formatAgentPreflightDiagnostic(diagnostic));
    process.exit(1);
  }
  if (err instanceof Error) {
    if (err.name === 'UserCancelledError') {
      console.log(err.message);
      process.exit(0);
    }
    console.error(`Error: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
