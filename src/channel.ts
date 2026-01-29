import {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  type ChannelDock,
  type ChannelPlugin,
  type MoltbotConfig,
} from "clawdbot/plugin-sdk";
import { z } from "zod";

import type { EmailChannelConfig, EmailCredentials } from "./types.js";
import { getEmailRuntime } from "./runtime.js";
import {
  createGmailClient,
  fetchNewMessages,
  markAsRead,
  sendEmail,
  extractEmailAddress,
  generateAuthUrl,
} from "./gmail.js";

let gmailClient: any = null;
let pollTimer: NodeJS.Timeout | undefined;

function getEmailConfig(cfg: MoltbotConfig): EmailChannelConfig | undefined {
  return (cfg.channels as any)?.email as EmailChannelConfig | undefined;
}

function isSenderAllowed(sender: string, allowFrom: string[]): boolean {
  if (allowFrom.length === 0) return false;
  if (allowFrom.includes("*")) return true;
  const senderEmail = extractEmailAddress(sender).toLowerCase();
  return allowFrom.some((allowed) => senderEmail === allowed.toLowerCase());
}

function isRecipientAllowed(recipient: string, allowTo: string[]): boolean {
  if (allowTo.length === 0) return true;
  if (allowTo.includes("*")) return true;
  const recipientEmail = extractEmailAddress(recipient).toLowerCase();
  return allowTo.some((allowed) => recipientEmail === allowed.toLowerCase());
}

// Config schema for email channel
const EmailConfigSchema = z.object({
  enabled: z.boolean().optional(),
  credentials: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    refreshToken: z.string().optional(),
    redirectUri: z.string().optional(),
  }).optional(),
  allowFrom: z.array(z.string()).optional(),
  allowTo: z.array(z.string()).optional(),
  pollIntervalMs: z.number().optional(),
  subjectPrefix: z.string().optional(),
  defaultRecipient: z.string().optional(),
});

export const emailDock: ChannelDock = {
  id: "email",
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    media: false,
    threads: true,
    blockStreaming: true,
  },
  outbound: { textChunkLimit: 50000 },
  config: {
    resolveAllowFrom: ({ cfg }) => getEmailConfig(cfg as MoltbotConfig)?.allowFrom ?? [],
    formatAllowFrom: ({ allowFrom }) => allowFrom.filter(Boolean).join(", "),
  },
};

interface ResolvedEmailAccount {
  accountId: string;
  config: EmailChannelConfig;
  credentials: EmailCredentials | null;
  enabled: boolean;
  name?: string;
}

function resolveEmailAccount(cfg: MoltbotConfig, accountId?: string): ResolvedEmailAccount {
  const config = getEmailConfig(cfg) ?? {};
  return {
    accountId: accountId || DEFAULT_ACCOUNT_ID,
    config,
    credentials: config.credentials ?? null,
    enabled: config.enabled ?? false,
    name: "Gmail",
  };
}

export const emailPlugin: ChannelPlugin<ResolvedEmailAccount> = {
  id: "email",
  meta: {
    id: "email",
    label: "Email",
    selectionLabel: "Email (Gmail)",
    docsPath: "/channels/email",
    docsLabel: "email",
    blurb: "Email channel with Gmail support.",
    order: 70,
  },
  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: true,
    media: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.email"] },
  configSchema: buildChannelConfigSchema(EmailConfigSchema),
  config: {
    listAccountIds: () => [DEFAULT_ACCOUNT_ID],
    resolveAccount: (cfg, accountId) => resolveEmailAccount(cfg as MoltbotConfig, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => Boolean(account.credentials?.refreshToken),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.credentials?.refreshToken),
    }),
  },

  async probe({ account }) {
    if (!account.config.enabled) {
      return { ok: false, error: "Email channel is disabled" };
    }
    if (!account.credentials?.clientId || !account.credentials?.clientSecret) {
      return { ok: false, error: "Missing Gmail OAuth2 credentials" };
    }
    if (!account.credentials?.refreshToken) {
      const authUrl = generateAuthUrl(account.credentials);
      return { ok: false, error: `Missing refresh token. Authorize: ${authUrl}` };
    }
    return { ok: true };
  },

  async start({ cfg, account, core }) {
    const runtime = getEmailRuntime();
    if (!account.config.enabled || !account.credentials?.refreshToken) {
      runtime?.log?.("[email] Not starting - disabled or missing credentials");
      return;
    }

    try {
      gmailClient = await createGmailClient(account.credentials);
      runtime?.log?.("[email] Gmail client initialized");

      const pollInterval = account.config.pollIntervalMs || 30000;
      
      const poll = async () => {
        try {
          const messages = await fetchNewMessages(gmailClient, "is:unread");
          const allowFrom = account.config.allowFrom || [];

          for (const msg of messages) {
            const senderEmail = extractEmailAddress(msg.from);

            if (!isSenderAllowed(msg.from, allowFrom)) {
              runtime?.log?.(`[email] Ignoring email from: ${senderEmail}`);
              await markAsRead(gmailClient, msg.id);
              continue;
            }

            runtime?.log?.(`[email] New email from ${senderEmail}: ${msg.subject}`);
            await markAsRead(gmailClient, msg.id);

            core.channel.routing.routeInbound({
              cfg,
              channel: "email",
              accountId: DEFAULT_ACCOUNT_ID,
              chatId: msg.threadId,
              route: core.channel.routing.resolveAgentRoute({
                cfg,
                channel: "email",
                peer: { kind: "dm", id: senderEmail },
              }),
              message: msg.body,
              senderId: senderEmail,
              senderLabel: senderEmail,
              isGroup: false,
              replyTo: msg.threadId,
            });
          }
        } catch (error: any) {
          runtime?.log?.(`[email] Poll error: ${error.message}`);
        }
      };

      pollTimer = setInterval(poll, pollInterval);
      await poll(); // Initial poll
      runtime?.log?.(`[email] Polling started (interval: ${pollInterval}ms)`);
    } catch (error: any) {
      runtime?.log?.(`[email] Failed to start: ${error.message}`);
    }
  },

  async stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
    gmailClient = null;
    getEmailRuntime()?.log?.("[email] Stopped");
  },

  async send({ account, to, text }) {
    if (!gmailClient) {
      return { ok: false, error: "Gmail client not initialized" };
    }

    const recipient = to || account.config.defaultRecipient;
    if (!recipient) {
      return { ok: false, error: "No recipient specified" };
    }

    const allowTo = account.config.allowTo || [];
    if (!isRecipientAllowed(recipient, allowTo)) {
      return { ok: false, error: `Recipient ${recipient} not allowed` };
    }

    try {
      const subject = `${account.config.subjectPrefix || "[Moltbot]"} Message`;
      const messageId = await sendEmail(gmailClient, recipient, subject, text);
      getEmailRuntime()?.log?.(`[email] Sent to ${recipient} (id: ${messageId})`);
      return { ok: true, messageId };
    } catch (error: any) {
      getEmailRuntime()?.log?.(`[email] Send failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
  },

  resolveTarget({ to, allowFrom }) {
    if (to && typeof to === "string" && to.includes("@")) {
      return { ok: true, target: to };
    }
    const emails = (allowFrom ?? []).filter((e): e is string => typeof e === "string" && e.includes("@"));
    if (emails.length > 0) {
      return { ok: true, target: emails[0] };
    }
    return { ok: false, error: "No valid email target" };
  },
};
