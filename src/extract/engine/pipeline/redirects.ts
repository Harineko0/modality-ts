import type { Transition } from "modality-ts/core";
import type { RouteInventory } from "../spi/index.js";
import { safeId } from "../../compile/ids.js";
import { routeMountGuard } from "../../compile/routes.js";
import { locationEffect } from "../../compile/navigation.js";

export function synthesizeRedirectTransitions(
  inventory: RouteInventory,
): readonly Transition[] {
  const modeledPatterns = new Set(
    inventory.routes
      .filter((node) => node.kind === "page" || node.kind === "index")
      .map((node) => node.pattern),
  );
  const transitions: Transition[] = [];

  for (const node of inventory.routes) {
    const target = node.redirectTo;
    if (!target || !modeledPatterns.has(target)) continue;

    transitions.push({
      id: `route:${node.pattern}.redirect.${safeId(target)}`,
      cls: "nav",
      label: { kind: "navigate", mode: "push", to: target },
      source: [],
      guard: routeMountGuard(node.pattern),
      ...locationEffect({
        currentVar: "sys:route",
        historyVar: "sys:history",
        mode: "replace",
        to: { kind: "lit", value: target },
        routeValues: inventory.routes
          .filter((route) => route.kind === "page" || route.kind === "index")
          .map((route) => route.pattern),
      }),
      confidence: "exact",
    });
  }

  return transitions.sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      redirectTarget(left.effect).localeCompare(redirectTarget(right.effect)),
  );
}

function redirectTarget(effect: Transition["effect"]): string {
  if (effect.kind === "assign" && effect.expr.kind === "lit") {
    return String(effect.expr.value);
  }
  return "";
}
