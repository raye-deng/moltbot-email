import { google, gmail_v1 } from "googleapis";
import type { EmailCredentials, EmailMessage, EmailRuntime } from "./types.js";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];

export async function createGmailClient(
  credentials: EmailCredentials
): Promise<gmail_v1.Gmail> {
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri || "http://localhost"
  );

  if (credentials.refreshToken) {
    oauth2Client.setCredentials({
      refresh_token: credentials.refreshToken,
    });
  }

  return google.gmail({ version: "v1", auth: oauth2Client });
}

export function generateAuthUrl(credentials: EmailCredentials): string {
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri || "http://localhost"
  );

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });
}

export async function exchangeCodeForTokens(
  credentials: EmailCredentials,
  code: string
): Promise<string> {
  const oauth2Client = new google.auth.OAuth2(
    credentials.clientId,
    credentials.clientSecret,
    credentials.redirectUri || "http://localhost"
  );

  const { tokens } = await oauth2Client.getToken(code);
  return tokens.refresh_token || "";
}

export async function fetchNewMessages(
  gmail: gmail_v1.Gmail,
  query: string = "is:unread"
): Promise<EmailMessage[]> {
  const response = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults: 10,
  });

  const messages: EmailMessage[] = [];
  const messageList = response.data.messages || [];

  for (const msg of messageList) {
    if (!msg.id) continue;

    const detail = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "full",
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

    const from = getHeader("From");
    const to = getHeader("To").split(",").map((t) => t.trim());
    const subject = getHeader("Subject");
    const date = new Date(getHeader("Date"));

    // Extract body
    let body = "";
    const payload = detail.data.payload;
    if (payload) {
      if (payload.body?.data) {
        body = Buffer.from(payload.body.data, "base64").toString("utf-8");
      } else if (payload.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === "text/plain" && part.body?.data) {
            body = Buffer.from(part.body.data, "base64").toString("utf-8");
            break;
          }
        }
      }
    }

    messages.push({
      id: msg.id,
      threadId: msg.threadId || msg.id,
      from,
      to,
      subject,
      body: body.trim(),
      date,
      isRead: !detail.data.labelIds?.includes("UNREAD"),
    });
  }

  return messages;
}

export async function markAsRead(
  gmail: gmail_v1.Gmail,
  messageId: string
): Promise<void> {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
}

/**
 * Encode a string for use in email headers (RFC 2047)
 * Non-ASCII characters are encoded as =?UTF-8?B?base64?=
 */
function encodeHeaderValue(value: string): string {
  // Check if the string contains non-ASCII characters
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value; // Pure ASCII, no encoding needed
  }
  // Encode as UTF-8 Base64 per RFC 2047
  const encoded = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

export async function sendEmail(
  gmail: gmail_v1.Gmail,
  to: string,
  subject: string,
  body: string,
  threadId?: string
): Promise<string> {
  // Encode subject for non-ASCII characters
  const encodedSubject = encodeHeaderValue(subject);
  
  const message = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");

  const encodedMessage = Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encodedMessage,
      threadId: threadId,
    },
  });

  return response.data.id || "";
}

export function extractEmailAddress(emailStr: string): string {
  const match = emailStr.match(/<([^>]+)>/);
  return match ? match[1] : emailStr.trim();
}
