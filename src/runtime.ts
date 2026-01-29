import type { PluginRuntime } from "clawdbot/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setEmailRuntime(r: PluginRuntime) {
  runtime = r;
}

export function getEmailRuntime(): PluginRuntime | null {
  return runtime;
}
