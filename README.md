# moltbot-email

Email (Gmail) channel plugin for Moltbot.

## Features

- Gmail integration via OAuth2
- Receive and respond to emails
- Allowlist for senders and recipients
- Configurable polling interval

## Installation

```bash
moltbot plugin install github:raye-deng/moltbot-email
```

Or add to your `moltbot.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/moltbot-email"]
    }
  }
}
```

## Configuration

### 1. Create Google OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the Gmail API
4. Create OAuth2 credentials (Desktop application)
5. Download the credentials JSON

### 2. Get Refresh Token

Run the authorization flow to get a refresh token:

```bash
moltbot email auth
```

Or manually:
1. Visit the authorization URL (shown when starting without refresh token)
2. Authorize the application
3. Copy the code from the redirect URL
4. Exchange for refresh token

### 3. Configure the Plugin

Add to your `moltbot.json`:

```json
{
  "channels": {
    "email": {
      "enabled": true,
      "credentials": {
        "clientId": "YOUR_CLIENT_ID",
        "clientSecret": "YOUR_CLIENT_SECRET",
        "refreshToken": "YOUR_REFRESH_TOKEN"
      },
      "allowFrom": [
        "allowed@example.com"
      ],
      "allowTo": [
        "recipient@example.com"
      ],
      "pollIntervalMs": 30000,
      "subjectPrefix": "[Moltbot]"
    }
  }
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | false | Enable the email channel |
| `credentials.clientId` | string | - | Google OAuth2 Client ID |
| `credentials.clientSecret` | string | - | Google OAuth2 Client Secret |
| `credentials.refreshToken` | string | - | OAuth2 Refresh Token |
| `allowFrom` | string[] | [] | Email addresses allowed to send messages |
| `allowTo` | string[] | [] | Email addresses the bot can send to |
| `pollIntervalMs` | number | 30000 | How often to check for new emails (ms) |
| `subjectPrefix` | string | "[Moltbot]" | Prefix for outgoing email subjects |
| `defaultRecipient` | string | - | Default recipient for outgoing messages |

## Usage

Once configured, the bot will:

1. Poll for unread emails from allowed senders
2. Process the email body as a message
3. Send replies back via email

### Sending Messages

Use the `message` tool:

```
message send --channel email --to user@example.com --message "Hello!"
```

## License

MIT
