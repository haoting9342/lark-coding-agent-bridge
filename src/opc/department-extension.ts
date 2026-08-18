import { canRunAdminCommand } from '../policy/access';
import { log } from '../core/logger';

let opcDepartmentBootstrapPromise: Promise<any> | undefined;

async function loadOpcDepartmentBootstrap(): Promise<any | null> {
  const entry = process.env.OPC_DEPARTMENT_RUNTIME_ENTRY;
  if (!entry) return null;
  try {
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
    host: process.env.OPC_DEPARTMENT_HOST ?? '',
    botName: context.channel.botIdentity?.name ?? '',
    chatType: context.msg.chatType,
    chatId: context.msg.chatId,
    senderId: context.msg.senderId,
    groupName:
      knownChats.find((chat: any) => chat.id === context.msg.chatId)?.name ??
      context.msg.chatId,
    text: context.msg.content,
    isDepartmentAdmin: canRunAdminCommand(
      context.controls.profileConfig,
      context.controls,
      context.msg.senderId,
    ).ok,
    controllerConfigPath: process.env.OPC_DEPARTMENT_CONTROLLER_CONFIG ?? '',
    activeRunCount: () => context.activeRuns.scopes().length,
    applyWorkspaceRoute: (route: { chatId: string; cwd: string }) =>
      context.workspaces.setCwd(route.chatId, route.cwd),
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
  if (!bootstrap) {
    await reply(context, '部门控制器尚未配置。');
    return;
  }
  const adapted = bridgeContext(context);
  const runtime = await bootstrap.getDepartmentRuntime(adapted);
  await runtime.handleDepartmentCommand(args, adapted);
}

export async function tryHandleOpcDepartmentWizardReply(
  context: any,
): Promise<boolean> {
  try {
    const bootstrap = await loadOpcDepartmentBootstrap();
    if (!bootstrap) return false;
    const adapted = bridgeContext(context);
    const runtime = await bootstrap.getDepartmentRuntime(adapted);
    return runtime.tryHandleDepartmentWizardReply(adapted);
  } catch (error) {
    log.fail('opc-department', error, { step: 'wizard-intake' });
    return false;
  }
}
