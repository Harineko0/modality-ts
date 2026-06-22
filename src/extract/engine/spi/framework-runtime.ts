import type { FrameworkPlugin } from "./framework.js";

let registeredFrameworkPlugin: FrameworkPlugin | undefined;

export function registerFrameworkPlugin(plugin: FrameworkPlugin): void {
  registeredFrameworkPlugin = plugin;
}

export function resolveFrameworkPlugin(
  explicit?: FrameworkPlugin,
): FrameworkPlugin {
  if (explicit) return explicit;
  if (!registeredFrameworkPlugin) {
    throw new Error(
      "No framework plugin configured. Pass framework in extraction options or register one via registerFrameworkPlugin.",
    );
  }
  return registeredFrameworkPlugin;
}
