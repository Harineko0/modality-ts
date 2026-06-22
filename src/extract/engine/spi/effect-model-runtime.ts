import type { EffectModelProvider } from "./effect-model.js";

let registeredEffectModelProviders: readonly EffectModelProvider[] | undefined;

export function registerEffectModelProviders(
  providers: readonly EffectModelProvider[],
): void {
  registeredEffectModelProviders = providers;
}

export function resolveEffectModelProviders(
  explicit?: readonly EffectModelProvider[],
): readonly EffectModelProvider[] {
  if (explicit !== undefined) return explicit;
  if (!registeredEffectModelProviders) {
    throw new Error(
      "No effect-model providers configured. Pass effectModels in extraction options or register providers via registerEffectModelProviders.",
    );
  }
  return registeredEffectModelProviders;
}
