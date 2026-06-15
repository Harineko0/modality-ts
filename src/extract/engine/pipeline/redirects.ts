import type { EffectIR, Transition } from "modality-ts/core";
import type { RouteInventory } from "../spi/index.js";
import { safeId } from "../ts/ids.js";
import { routeMountGuard } from "../ts/routes.js";

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
      effect: {
        kind: "navigate",
        mode: "replace",
        to: { kind: "lit", value: target },
      },
      reads: ["sys:route", "sys:history"],
      writes: ["sys:route", "sys:history"],
      confidence: "exact",
    });
  }

  return transitions.sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      navigateTarget(left.effect).localeCompare(navigateTarget(right.effect)),
  );
}

function navigateTarget(effect: EffectIR): string {
  if (effect.kind === "navigate" && effect.to?.kind === "lit") {
    return String(effect.to.value);
  }
  return "";
}
