import type { EffectPlugin } from "./effect-model.js";

let registeredEffectPlugins: readonly EffectPlugin[] | undefined;

export function registerEffectPlugins(
  providers: readonly EffectPlugin[],
): void {
  registeredEffectPlugins = providers;
}

export function resolveEffectPlugins(
  explicit?: readonly EffectPlugin[],
): readonly EffectPlugin[] {
  if (explicit !== undefined) return explicit;
  if (!registeredEffectPlugins) {
    throw new Error(
      "No effect-model providers configured. Pass effectPlugins in extraction options or register providers via registerEffectPlugins.",
    );
  }
  return registeredEffectPlugins;
}
