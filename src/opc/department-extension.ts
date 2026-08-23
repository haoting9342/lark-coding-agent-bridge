import { canRunAdminCommand } from '../policy/access';
import { log } from '../core/logger';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

let opcDepartmentBootstrapPromise: Promise<any> | undefined;

async function loadOpcDepartmentBootstrap(): Promise<any> {
  try {
    const sourceEntry = join(process.cwd(), 'department-runtime', 'bootstrap.mjs');
    const entry = existsSync(sourceEntry)
      ? pathToFileURL(sourceEntry).href
      : new URL('../department-runtime/bootstrap.mjs', import.meta.url).href;
    opcDepartmentBootstrapPromise ??= import(entry);
    return await opcDepartmentBootstrapPromise;
  } catch (error) {
    opcDepartmentBootstrapPromise = undefined;
    throw error;
  }
}

function safeReply(text: unknown): string {
  return String(text).replace(/ou_[A-Za-z0-9_-]+/g, '[已隐藏]');
}

function runtimeLogFields(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : { payload };
}

function commandReplyOptions(context: any): { replyTo: string; replyInThread?: true } {
  return {
    replyTo: context.msg.messageId,
    ...(context.chatMode === 'topic' && context.msg.threadId
      ? { replyInThread: true as const }
      : {}),
  };
}

async function reply(context: any, text: unknown): Promise<void> {
  try {
    await context.channel.send(
      context.msg.chatId,
      { markdown: safeReply(text) },
      commandReplyOptions(context),
    );
  } catch (error) {
    log.fail('opc-department', error, { step: 'reply' });
  }
}

function bridgeContext(context: any): Record<string, unknown> {
  const knownChats = context.controls.knownChats ?? [];
  return {
    profile: context.controls.profile,
    host: process.env.LARK_CHANNEL_DEPARTMENT_HOST ?? hostname(),
    botName: context.channel.botIdentity?.name ?? '',
    chatType: context.msg.chatType,
    chatId: context.msg.chatId,
    scope: context.scope,
    senderId: context.msg.senderId,
    groupName:
      knownChats.find((chat: any) => chat.id === context.msg.chatId)?.name ??
      context.msg.chatId,
    text: context.msg.content,
    messageId: context.msg.messageId,
    currentWorkspace:
      context.workspaces.cwdFor(context.scope) ??
      context.controls.profileConfig.workspaces.default ??
      null,
    isDepartmentAdmin: canRunAdminCommand(
      context.controls.profileConfig,
      context.controls,
      context.msg.senderId,
    ).ok,
    organizationRoot: join(
      dirname(context.controls.configPath),
      'organizations',
      context.controls.profileConfig.organizationId ?? 'default',
    ),
    profileRoot: join(dirname(context.controls.configPath), 'profiles', context.controls.profile),
    activeRunCount: () => context.activeRuns.scopes().length,
    currentWorkspaceRoute: (chatId: string) => context.workspaces.cwdFor(chatId),
    applyWorkspaceRoute: (route: { chatId: string; cwd: string }) =>
      context.workspaces.setCwd(route.chatId, route.cwd),
    restoreWorkspaceRoute: (chatId: string, cwd?: string) => {
      if (cwd == null) context.workspaces.removeCwd(chatId);
      else context.workspaces.setCwd(chatId, cwd);
    },
    reply: (text: unknown) => reply(context, text),
    log: (payload: unknown) =>
      log.info('opc-department', 'runtime', runtimeLogFields(payload)),
  };
}

export async function handleOpcDepartmentCommand(
  args: string,
  context: any,
): Promise<void> {
  const bootstrap = await loadOpcDepartmentBootstrap();
  const adapted = bridgeContext(context);
  const runtime = await bootstrap.getDepartmentRuntime(adapted);
  await runtime.handleDepartmentCommand(args, adapted);
}

export type OpcDepartmentIntakeResult =
  | { action: 'pass' }
  | { action: 'handled' }
  | { action: 'design'; prompt: string; bypassMention: true };

export async function intakeOpcDepartmentMessage(
  context: any,
): Promise<OpcDepartmentIntakeResult> {
  try {
    const bootstrap = await loadOpcDepartmentBootstrap();
    const adapted = bridgeContext(context);
    const runtime = await bootstrap.getDepartmentRuntime(adapted);
    return await runtime.intakeDepartmentMessage(adapted);
  } catch (error) {
    log.fail('opc-department', error, { step: 'design-intake' });
    return { action: 'pass' };
  }
}
