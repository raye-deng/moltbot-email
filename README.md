# moltbot-email

Email (Gmail) channel plugin for Moltbot.

[中文文档](#中文文档)

## Features

- Gmail integration via OAuth2
- Receive and respond to emails automatically
- Allowlist-based access control for senders and recipients
- Configurable polling interval
- Session routing per sender email

## Installation

**From npm (recommended):**

```bash
npm install moltbot-email
```

**From GitHub:**

```bash
moltbot plugin install github:raye-deng/moltbot-email
```

**Manual:** Add to your `moltbot.json`:

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
2. Create a new project or select an existing one
3. Enable the **Gmail API**
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Choose **Desktop application** as the application type
6. Download the credentials JSON or note the Client ID and Client Secret

### 2. Get Refresh Token

You need a refresh token to allow the plugin to access your Gmail account.

**Option A: Use the authorization URL**

When starting Moltbot without a refresh token, the plugin will output an authorization URL. Visit it, authorize access, and you'll be redirected to a URL containing the authorization code. Exchange this code for a refresh token.

**Option B: Use Google OAuth Playground**

1. Go to [Google OAuth Playground](https://developers.google.com/oauthplayground)
2. Click the gear icon (⚙️) → Check "Use your own OAuth credentials"
3. Enter your Client ID and Client Secret
4. In Step 1, select `https://mail.google.com/` scope
5. Click "Authorize APIs" and sign in
6. In Step 2, click "Exchange authorization code for tokens"
7. Copy the `refresh_token` from the response

### 3. Configure the Plugin

Add to your `moltbot.json`:

```json
{
  "channels": {
    "email": {
      "enabled": true,
      "credentials": {
        "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
        "clientSecret": "YOUR_CLIENT_SECRET",
        "refreshToken": "YOUR_REFRESH_TOKEN",
        "redirectUri": "http://localhost"
      },
      "allowFrom": [
        "friend@example.com",
        "colleague@company.com"
      ],
      "allowTo": [
        "friend@example.com"
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
| `enabled` | boolean | `false` | Enable the email channel |
| `credentials.clientId` | string | - | Google OAuth2 Client ID |
| `credentials.clientSecret` | string | - | Google OAuth2 Client Secret |
| `credentials.refreshToken` | string | - | OAuth2 Refresh Token |
| `credentials.redirectUri` | string | `http://localhost` | OAuth2 redirect URI |
| `allowFrom` | string[] | `[]` | Email addresses allowed to send messages to the bot |
| `allowTo` | string[] | `[]` | Email addresses the bot can send to (empty = all allowed) |
| `pollIntervalMs` | number | `30000` | How often to check for new emails (ms) |
| `subjectPrefix` | string | `[Moltbot]` | Prefix for outgoing email subjects |
| `defaultRecipient` | string | - | Default recipient for outgoing messages |

## How It Works

1. **Polling**: The plugin periodically checks for unread emails
2. **Filtering**: Only emails from addresses in `allowFrom` are processed
3. **Session Routing**: Each sender gets a dedicated session (`agent:main:email:group:<sender-email>`)
4. **Processing**: Email body is sent to the agent for processing
5. **Reply**: Agent's response is sent back as an email reply

## Usage Examples

### Receiving Emails

Once configured, simply send an email to your Gmail account from an allowed sender. The bot will:
- Detect the new email
- Route it to the appropriate session
- Generate a response
- Reply via email

### Sending Messages Programmatically

Use the `message` tool:

```
message send --channel email --to user@example.com --message "Hello from Moltbot!"
```

### Cross-Channel Communication

You can have the bot send emails from other channels:

```
Send an email to john@example.com saying "Meeting reminder for tomorrow"
```

## Troubleshooting

### "Gmail client not initialized"
- Check that `credentials.refreshToken` is set correctly
- Verify your OAuth credentials are valid

### "Recipient not allowed"
- Add the recipient email to the `allowTo` array
- Or set `allowTo` to `["*"]` to allow all recipients

### Emails not being received
- Verify the sender is in `allowFrom`
- Check the polling interval isn't too long
- Look at Moltbot logs for errors: `tail -f ~/.moltbot/logs/gateway.log`

## License

MIT

---

# 中文文档

Moltbot 的 Email (Gmail) 频道插件。

## 功能特性

- 通过 OAuth2 集成 Gmail
- 自动接收和回复邮件
- 基于白名单的发件人和收件人访问控制
- 可配置的轮询间隔
- 按发件人邮箱的会话路由

## 安装

**从 npm 安装（推荐）：**

```bash
npm install moltbot-email
```

**从 GitHub 安装：**

```bash
moltbot plugin install github:raye-deng/moltbot-email
```

**手动安装：** 在 `moltbot.json` 中添加：

```json
{
  "plugins": {
    "load": {
      "paths": ["/path/to/moltbot-email"]
    }
  }
}
```

## 配置步骤

### 1. 创建 Google OAuth2 凭据

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 创建新项目或选择已有项目
3. 启用 **Gmail API**
4. 进入 **凭据** → **创建凭据** → **OAuth 2.0 客户端 ID**
5. 选择 **桌面应用** 作为应用类型
6. 下载凭据 JSON 或记录 Client ID 和 Client Secret

### 2. 获取 Refresh Token

需要获取 refresh token 才能让插件访问你的 Gmail 账户。

**方法 A：使用授权 URL**

启动 Moltbot 时如果没有配置 refresh token，插件会输出授权 URL。访问该 URL，授权后会重定向到包含授权码的 URL，用这个授权码换取 refresh token。

**方法 B：使用 Google OAuth Playground**

1. 访问 [Google OAuth Playground](https://developers.google.com/oauthplayground)
2. 点击齿轮图标（⚙️）→ 勾选 "Use your own OAuth credentials"
3. 输入你的 Client ID 和 Client Secret
4. 在 Step 1 中选择 `https://mail.google.com/` scope
5. 点击 "Authorize APIs" 并登录
6. 在 Step 2 中点击 "Exchange authorization code for tokens"
7. 从响应中复制 `refresh_token`

### 3. 配置插件

在 `moltbot.json` 中添加：

```json
{
  "channels": {
    "email": {
      "enabled": true,
      "credentials": {
        "clientId": "YOUR_CLIENT_ID.apps.googleusercontent.com",
        "clientSecret": "YOUR_CLIENT_SECRET",
        "refreshToken": "YOUR_REFRESH_TOKEN",
        "redirectUri": "http://localhost"
      },
      "allowFrom": [
        "friend@example.com",
        "colleague@company.com"
      ],
      "allowTo": [
        "friend@example.com"
      ],
      "pollIntervalMs": 30000,
      "subjectPrefix": "[Moltbot]"
    }
  }
}
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false` | 是否启用邮件频道 |
| `credentials.clientId` | string | - | Google OAuth2 Client ID |
| `credentials.clientSecret` | string | - | Google OAuth2 Client Secret |
| `credentials.refreshToken` | string | - | OAuth2 Refresh Token |
| `credentials.redirectUri` | string | `http://localhost` | OAuth2 重定向 URI |
| `allowFrom` | string[] | `[]` | 允许发送消息给机器人的邮箱地址 |
| `allowTo` | string[] | `[]` | 机器人可以发送邮件的目标地址（空数组 = 允许所有） |
| `pollIntervalMs` | number | `30000` | 检查新邮件的间隔时间（毫秒） |
| `subjectPrefix` | string | `[Moltbot]` | 发送邮件的主题前缀 |
| `defaultRecipient` | string | - | 默认收件人 |

## 工作原理

1. **轮询**：插件定期检查未读邮件
2. **过滤**：只处理来自 `allowFrom` 地址的邮件
3. **会话路由**：每个发件人有独立的会话（`agent:main:email:group:<发件人邮箱>`）
4. **处理**：邮件正文发送给 Agent 处理
5. **回复**：Agent 的响应以邮件回复形式发送

## 使用示例

### 接收邮件

配置完成后，只需从允许的发件人地址发送邮件到你的 Gmail 账户。机器人会：
- 检测到新邮件
- 路由到对应的会话
- 生成响应
- 通过邮件回复

### 程序化发送邮件

使用 `message` 工具：

```
message send --channel email --to user@example.com --message "来自 Moltbot 的问候！"
```

### 跨频道通信

你可以让机器人从其他频道发送邮件：

```
发一封邮件给 john@example.com，内容是"明天会议提醒"
```

## 故障排除

### "Gmail client not initialized"
- 检查 `credentials.refreshToken` 是否正确设置
- 验证 OAuth 凭据是否有效

### "Recipient not allowed"
- 将收件人邮箱添加到 `allowTo` 数组
- 或设置 `allowTo: ["*"]` 允许所有收件人

### 收不到邮件
- 确认发件人在 `allowFrom` 列表中
- 检查轮询间隔是否太长
- 查看 Moltbot 日志：`tail -f ~/.moltbot/logs/gateway.log`

## 许可证

MIT
