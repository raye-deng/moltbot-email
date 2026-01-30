import {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  type ChannelDock,
  type ChannelPlugin,
  type MoltbotConfig,
} from "openclaw/plugin-sdk";
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

/**
 * Generate a dynamic email subject from reply content
 * Extracts the first meaningful line or sentence as the subject
 */
function generateSubjectFromContent(content: string, prefix?: string): string {
  const maxLength = 60;
  
  // Remove markdown formatting
  let text = content
    .replace(/\*\*(.+?)\*\*/g, "$1")  // Bold
    .replace(/\*(.+?)\*/g, "$1")       // Italic
    .replace(/`(.+?)`/g, "$1")         // Code
    .replace(/^#+\s*/gm, "")           // Headers
    .replace(/^\s*[-*]\s*/gm, "")      // List items
    .replace(/\[来自.*?\]/g, "")       // Remove signature
    .trim();
  
  // Get first line or sentence
  const firstLine = text.split(/[\n\r]/)[0]?.trim() || "";
  const firstSentence = firstLine.split(/[。！？.!?]/)[0]?.trim() || firstLine;
  
  // Use first sentence if it's reasonable length, otherwise first line
  let subject = firstSentence.length > 10 && firstSentence.length <= maxLength 
    ? firstSentence 
    : firstLine;
  
  // Truncate if too long
  if (subject.length > maxLength) {
    subject = subject.substring(0, maxLength - 3) + "...";
  }
  
  // Fallback if empty
  if (!subject) {
    subject = "Message from Moltbot";
  }
  
  // Add prefix if configured
  if (prefix) {
    return `${prefix} ${subject}`;
  }
  
  return subject;
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
    formatAllowFrom: ({ allowFrom }) => allowFrom.filter(Boolean),
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
  messaging: {
    targetResolver: {
      hint: "email@example.com",
      looksLikeId: (raw: string) => {
        // Email addresses are valid target IDs
        return raw.includes("@") && raw.includes(".");
      },
    },
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

  gateway: {
    startAccount: async (ctx) => {
      const { account, cfg, runtime, abortSignal } = ctx;
      console.log("[email] startAccount() method called");
      ctx.log?.info?.("[email] startAccount() method called");
      
      if (!account.config.enabled || !account.credentials?.refreshToken) {
        console.log("[email] Not starting - disabled or missing credentials");
        ctx.log?.info?.("[email] Not starting - disabled or missing credentials");
        return;
      }

      ctx.setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      try {
        gmailClient = await createGmailClient(account.credentials);
        ctx.log?.info?.("[email] Gmail client initialized");

        const pollInterval = account.config.pollIntervalMs || 30000;
        
        const poll = async () => {
          try {
            const messages = await fetchNewMessages(gmailClient, "is:unread");
            const allowFrom = account.config.allowFrom || [];

            for (const msg of messages) {
              const senderEmail = extractEmailAddress(msg.from);

              if (!isSenderAllowed(msg.from, allowFrom)) {
                ctx.log?.debug?.(`[email] Ignoring email from: ${senderEmail}`);
                await markAsRead(gmailClient, msg.id);
                continue;
              }

              ctx.log?.info?.(`[email] New email from ${senderEmail}: ${msg.subject}`);
              await markAsRead(gmailClient, msg.id);

              const core = getEmailRuntime();
              if (!core?.channel) {
                ctx.log?.error?.("[email] Email runtime not available");
                continue;
              }

              // Resolve agent route - use "group" kind to ensure separate session per email
              // When peerKind is "dm" and dmScope is "main" (default), it routes to main session
              // Using "group" ensures each email address gets its own session
              const route = core.channel.routing.resolveAgentRoute({
                cfg: cfg as MoltbotConfig,
                channel: "email",
                accountId: DEFAULT_ACCOUNT_ID,
                peer: { kind: "group", id: senderEmail },
              });

              // Get store path and format envelope
              const storePath = core.channel.session.resolveStorePath((cfg as MoltbotConfig).session?.store, {
                agentId: route.agentId,
              });
              const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg as MoltbotConfig);
              const previousTimestamp = core.channel.session.readSessionUpdatedAt({
                storePath,
                sessionKey: route.sessionKey,
              });

              const body = core.channel.reply.formatAgentEnvelope({
                channel: "Email",
                from: senderEmail,
                timestamp: Date.now(),
                previousTimestamp,
                envelope: envelopeOptions,
                body: msg.body,
              });

              // Create inbound context - use senderEmail consistently for To field
              const ctxPayload = core.channel.reply.finalizeInboundContext({
                Body: body,
                RawBody: msg.body,
                CommandBody: msg.body,
                BodyForAgent: msg.body,
                From: `email:${senderEmail}`,
                To: senderEmail,  // Use consistent sender email, not thread ID
                SessionKey: route.sessionKey,
                AccountId: route.accountId,
                ChatType: "direct",
                ConversationLabel: senderEmail,
                SenderId: senderEmail,
                SenderName: msg.from,  // Include full sender name
                Provider: "email",
                Surface: "email",
                MessageSid: msg.id,
                MessageSidFull: msg.id,
                OriginatingChannel: "email",
                OriginatingTo: senderEmail,
                // Add timestamp for envelope formatting
                Timestamp: Date.now(),
              });

              ctx.log?.info?.(`[email] Processing message - sessionKey: ${route.sessionKey}, agentId: ${route.agentId}`);

              // Record session meta - await to ensure it's recorded before dispatch
              try {
                await core.channel.session.recordSessionMetaFromInbound({
                  storePath,
                  sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
                  ctx: ctxPayload,
                });
                ctx.log?.debug?.(`[email] Session meta recorded for ${route.sessionKey}`);
              } catch (err) {
                ctx.log?.error?.(`[email] Failed updating session meta: ${String(err)}`);
              }

              // Dispatch and get reply
              ctx.log?.info?.(`[email] Starting dispatch for message from ${senderEmail}`);
              const dispatchResult = await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                ctx: ctxPayload,
                cfg: cfg as MoltbotConfig,
                dispatcherOptions: {
                  deliver: async (payload, info) => {
                    ctx.log?.debug?.(`[email] Deliver called - kind: ${info.kind}, hasText: ${!!payload.text}`);
                    
                    // Send reply via email for final replies
                    if (payload.text) {
                      try {
                        // Generate dynamic subject from reply content
                        const subject = generateSubjectFromContent(payload.text, account.config.subjectPrefix);
                        ctx.log?.info?.(`[email] Generated subject: "${subject}" from content: "${payload.text.substring(0, 50)}..."`);
                        await sendEmail(gmailClient, senderEmail, subject, payload.text, msg.threadId);
                        ctx.log?.info?.(`[email] Sent ${info.kind} reply to ${senderEmail} (${payload.text.length} chars)`);
                      } catch (err: any) {
                        ctx.log?.error?.(`[email] Failed to send reply: ${err.message}`);
                        throw err;  // Re-throw to trigger onError
                      }
                    }
                  },
                  onError: (err, info) => {
                    ctx.log?.error?.(`[email] Reply ${info.kind} failed: ${String(err)}`);
                  },
                },
              });
              
              ctx.log?.info?.(`[email] Dispatch completed - queuedFinal: ${dispatchResult?.queuedFinal}`);
            }
          } catch (error: any) {
            ctx.log?.error?.(`[email] Poll error: ${error.message}`);
          }
        };

        pollTimer = setInterval(poll, pollInterval);
        await poll(); // Initial poll
        ctx.log?.info?.(`[email] Polling started (interval: ${pollInterval}ms)`);

        // Return cleanup function
        return () => {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = undefined;
          }
          gmailClient = null;
          ctx.log?.info?.("[email] Stopped");
          ctx.setStatus({
            accountId: account.accountId,
            running: false,
          });
        };
      } catch (error: any) {
        ctx.log?.error?.(`[email] Failed to start: ${error.message}`);
        ctx.setStatus({
          accountId: account.accountId,
          running: false,
          error: error.message,
        });
      }
    },
  },

  outbound: {
    textChunkLimit: 50000,
    resolveTarget: ({ to, allowFrom }) => {
      if (to && typeof to === "string" && to.includes("@")) {
        return { ok: true, to };
      }
      const emails = (allowFrom ?? []).filter((e): e is string => typeof e === "string" && e.includes("@"));
      if (emails.length > 0) {
        return { ok: true, to: emails[0] };
      }
      return { ok: false, error: "No valid email target" };
    },
    sendText: async ({ cfg, to, text }) => {
      const config = getEmailConfig(cfg as MoltbotConfig);
      // Auto-initialize Gmail client if not already done
      if (!gmailClient && config?.credentials?.refreshToken) {
        try {
          gmailClient = await createGmailClient(config.credentials);
          getEmailRuntime()?.log?.("[email] Gmail client auto-initialized for outbound");
        } catch (err: any) {
          throw new Error(`Failed to initialize Gmail client: ${err.message}`);
        }
      }
      if (!gmailClient) {
        throw new Error("Gmail client not initialized - check credentials");
      }
      const allowTo = config?.allowTo || [];
      if (!isRecipientAllowed(to, allowTo)) {
        throw new Error(`Recipient ${to} not allowed`);
      }
      // Generate dynamic subject from content
      const subject = generateSubjectFromContent(text, config?.subjectPrefix);
      const messageId = await sendEmail(gmailClient, to, subject, text);
      getEmailRuntime()?.log?.(`[email] Sent to ${to} (id: ${messageId})`);
      return {
        channel: "email",
        messageId: messageId || "",
        chatId: to,
      };
    },
    sendMedia: async ({ to }) => {
      throw new Error(`Email channel does not support media attachments to ${to}`);
    },
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
};
