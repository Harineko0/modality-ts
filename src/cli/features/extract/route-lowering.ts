import type { EffectIR, Transition } from "modality-ts/core";
import type {
  LocationLowering,
  NavIntent,
  RouteInventory,
  RoutePlugin,
} from "modality-ts/extract/engine/spi";

export function buildLocationLowering(
  transitions: readonly Transition[],
  adapter: RoutePlugin,
  inventory: RouteInventory,
): LocationLowering {
  const pushTargets = new Set<string>();
  const pushOrigins = new Set<string>();
  let hasUnboundPush = false;
  const routePatterns = inventory.routes.map((node) => node.pattern);

  for (const transition of transitions) {
    if (transition.id.startsWith("route:")) continue;
    const navigations = collectPushReplaceNavigations(transition.effect);
    if (navigations.length === 0) continue;

    const component = transition.id.split(".")[0] ?? "";
    const origin = adapter.routeForComponent?.(component, inventory);

    for (const navigation of navigations) {
      if (navigation.to) pushTargets.add(navigation.to);
      if (!origin) hasUnboundPush = true;
      else pushOrigins.add(origin);

      if (adapter.lowerNavigation) {
        const intent: NavIntent = {
          mode: navigation.mode,
          ...(navigation.to !== undefined ? { to: navigation.to } : {}),
        };
        for (const loweredNavigation of collectPushReplaceNavigations(
          adapter.lowerNavigation(intent, { inventory, routePatterns }).effect,
        )) {
          if (loweredNavigation.to) pushTargets.add(loweredNavigation.to);
        }
      }
    }
  }

  return {
    pushTargets: [...pushTargets].sort(),
    pushOrigins: [...pushOrigins].sort(),
    hasUnboundPush,
  };
}

function collectPushReplaceNavigations(
  effect: EffectIR,
  locationIds: { currentId: string; historyId: string } = {
    currentId: "sys:route",
    historyId: "sys:history",
  },
): Array<{ mode: "push" | "replace"; to?: string }> {
  const routeTargets: string[] = [];
  let touchesHistory = false;
  const visit = (current: EffectIR): void => {
    if (
      (current.kind === "assign" || current.kind === "havoc") &&
      current.var === locationIds.historyId
    ) {
      touchesHistory = true;
    }
    if (
      current.kind === "assign" &&
      current.var === locationIds.currentId &&
      current.expr.kind === "lit" &&
      typeof current.expr.value === "string"
    ) {
      routeTargets.push(current.expr.value);
    }
    if (current.kind === "seq") {
      for (const child of current.effects) visit(child);
    }
    if (current.kind === "if") {
      visit(current.then);
      visit(current.else);
    }
  };
  visit(effect);
  const mode = touchesHistory ? "push" : "replace";
  return routeTargets.map((to) => ({ mode, to }));
}
