import type { PluginLoadContext, MoltbotConfig } from "moltbot/plugin-sdk";
import type { EmailChannelConfig, EmailRuntime } from "./types.js";
import {
  createGmailClient,
  fetchNewMessages,
  markAsRead,
  sendEmail,
  extractEmailAddress,
  generateAuthUrl,
} from "./gmail.js";

const runtime: EmailRuntime = {
  gmail: null,
  pollTimer: undefined,
  lastCheckedHistoryId: undefined,
  log: undefined,
};

function getConfig(cfg: MoltbotConfig): EmailChannelConfig | undefined {
  return (cfg.channels as any)?.email as EmailChannelConfig | undefined;
}

function isSenderAllowed(sender: string, allowFrom: string[]): boolean {
  if (allowFrom.length === 0) return false;
  if (allowFrom.includes("*")) return true;

  const senderEmail = extractEmailAddress(sender).toLowerCase();
  return allowFrom.some((allowed) => {
    const allowedEmail = allowed.toLowerCase();
    return senderEmail === allowedEmail || senderEmail.endsWith(`@${allowedEmail}`);
  });
}

function isRecipientAllowed(recipient: string, allowTo: string[]): boolean {
  if (allowTo.length === 0) return true; // If no allowTo, allow all
  if (allowTo.includes("*")) return true;

  const recipientEmail = extractEmailAddress(recipient).toLowerCase();
  return allowTo.some((allowed) => {
    const allowedEmail = allowed.toLowerCase();
    return recipientEmail === allowedEmail;
  });
}

export function registerChannel(ctx: PluginLoadContext) {
  const { core } = ctx;

  core.channel.register({
    id: "email",
    name: "Email (Gmail)",

    async probe({ cfg }) {
      const config = getConfig(cfg);
      if (!config?.enabled) return { ok: false, error: "Email channel is disabled" };
      if (!config.credentials?.clientId || !config.credentials?.clientSecret) {
        return { ok: false, error: "Missing Gmail OAuth2 credentials" };
      }
      if (!config.credentials?.refreshToken) {
        const authUrl = generateAuthUrl(config.credentials);
        return {
          ok: false,
          error: `Missing refresh token. Please authorize: ${authUrl}`,
        };
      }
      return { ok: true };
    },

    async start({ cfg }) {
      const config = getConfig(cfg);
      if (!config?.enabled || !config.credentials?.refreshToken) {
        return;
      }

      runtime.log = (msg: string) => {
        if (core.runtime?.log) {
          core.runtime.log(`[email] ${msg}`);
        }
      };

      try {
        runtime.gmail = await createGmailClient(config.credentials);
        runtime.log?.("Gmail client initialized");

        // Start polling for new messages
        const pollInterval = config.pollIntervalMs || 30000;
        runtime.pollTimer = setInterval(async () => {
          await pollForMessages(cfg, core);
        }, pollInterval);

        // Initial poll
        await pollForMessages(cfg, core);
        runtime.log?.(`Polling started (interval: ${pollInterval}ms)`);
      } catch (error: any) {
        runtime.log?.(`Failed to start: ${error.message}`);
      }
    },

    async stop() {
      if (runtime.pollTimer) {
        clearInterval(runtime.pollTimer);
        runtime.pollTimer = undefined;
      }
      runtime.gmail = null;
      runtime.log?.("Email channel stopped");
    },

    async send({ cfg, to, text }) {
      const config = getConfig(cfg);
      if (!runtime.gmail) {
        return { ok: false, error: "Gmail client not initialized" };
      }

      const recipient = to || config?.defaultRecipient;
      if (!recipient) {
        return { ok: false, error: "No recipient specified" };
      }

      const allowTo = config?.allowTo || [];
      if (!isRecipientAllowed(recipient, allowTo)) {
        return { ok: false, error: `Recipient ${recipient} not in allowTo list` };
      }

      try {
        const subject = `${config?.subjectPrefix || "[Moltbot]"} Message`;
        const messageId = await sendEmail(runtime.gmail, recipient, subject, text);
        runtime.log?.(`Sent email to ${recipient} (id: ${messageId})`);
        return { ok: true, messageId };
      } catch (error: any) {
        runtime.log?.(`Failed to send email: ${error.message}`);
        return { ok: false, error: error.message };
      }
    },

    resolveTarget({ to, allowFrom }) {
      if (to && typeof to === "string" && to.includes("@")) {
        return { ok: true, target: to };
      }
      const allowList = (allowFrom ?? []).filter((e) => typeof e === "string" && e.includes("@"));
      if (allowList.length > 0) {
        return { ok: true, target: allowList[0] as string };
      }
      return { ok: false, error: "No valid email target specified" };
    },

    formatAllowFrom({ allowFrom }) {
      return (allowFrom ?? [])
        .filter((e) => typeof e === "string" && e.includes("@"))
        .map((e) => `\`${e}\``)
        .join(", ") || "(none)";
    },
  });
}

async function pollForMessages(cfg: MoltbotConfig, core: any) {
  const config = getConfig(cfg);
  if (!runtime.gmail || !config) return;

  try {
    const messages = await fetchNewMessages(runtime.gmail, "is:unread");
    const allowFrom = config.allowFrom || [];

    for (const msg of messages) {
      const senderEmail = extractEmailAddress(msg.from);

      // Check if sender is allowed
      if (!isSenderAllowed(msg.from, allowFrom)) {
        runtime.log?.(`Ignoring email from non-allowed sender: ${senderEmail}`);
        await markAsRead(runtime.gmail, msg.id);
        continue;
      }

      runtime.log?.(`New email from ${senderEmail}: ${msg.subject}`);

      // Mark as read immediately to avoid reprocessing
      await markAsRead(runtime.gmail, msg.id);

      // Route to agent
      const route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "email",
        peer: {
          kind: "dm",
          id: senderEmail,
        },
      });

      core.channel.routing.routeInbound({
        cfg,
        channel: "email",
        accountId: "default",
        chatId: msg.threadId,
        route,
        message: msg.body,
        senderId: senderEmail,
        senderLabel: senderEmail,
        isGroup: false,
        replyTo: msg.threadId,
      });
    }
  } catch (error: any) {
    runtime.log?.(`Poll error: ${error.message}`);
  }
}
