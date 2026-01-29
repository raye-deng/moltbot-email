import type { MoltbotConfig } from "moltbot/plugin-sdk";

export interface EmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  redirectUri?: string;
}

export interface EmailChannelConfig {
  enabled?: boolean;
  credentials?: EmailCredentials;
  allowFrom?: string[];
  allowTo?: string[];
  pollIntervalMs?: number;
  subjectPrefix?: string;
  defaultRecipient?: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  date: Date;
  isRead: boolean;
}

export interface EmailRuntime {
  gmail: any;
  pollTimer?: NodeJS.Timeout;
  lastCheckedHistoryId?: string;
  log?: (msg: string) => void;
}

export function getEmailConfig(cfg: MoltbotConfig): EmailChannelConfig | undefined {
  return (cfg.channels as any)?.email as EmailChannelConfig | undefined;
}
