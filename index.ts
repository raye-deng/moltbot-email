import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { emailPlugin, emailDock } from "./src/channel.js";
import { setEmailRuntime } from "./src/runtime.js";

const plugin = {
  id: "moltbot-email",
  name: "Email (Gmail)",
  description: "Moltbot Email channel plugin with Gmail support",
  configSchema: emptyPluginConfigSchema(),
  register(api: MoltbotPluginApi) {
    setEmailRuntime(api.runtime);
    api.registerChannel({ plugin: emailPlugin, dock: emailDock });
  },
};

export default plugin;
