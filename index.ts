import type { PluginExports } from "moltbot/plugin-sdk";
export type { EmailChannelConfig } from "./src/types.js";

export const plugin: PluginExports = {
  async load(ctx) {
    const { registerChannel } = await import("./src/channel.js");
    registerChannel(ctx);
  },
};
