import type { Transition } from "modality-ts/core";

function safeId(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "_") || "value";
  return /^[a-zA-Z]/u.test(sanitized) ? sanitized : `_${sanitized}`;
}

export interface TransitionLeaf {
  path: readonly string[];
  transitionId: string;
}

export interface TransitionEventGroup {
  event: string;
  leaves: TransitionLeaf[];
}

export interface TransitionComponentGroup {
  component: string;
  events: TransitionEventGroup[];
}

export function componentExportName(componentId: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(componentId)
    ? componentId
    : safeId(componentId);
}

function compareTransitionPaths(
  left: readonly string[],
  right: readonly string[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const compared = left[index]!.localeCompare(right[index]!);
    if (compared !== 0) return compared;
  }
  return left.length - right.length;
}

export function buildTransitionTree(
  transitions: readonly Transition[],
): TransitionComponentGroup[] {
  const byComponent = new Map<string, Map<string, TransitionLeaf[]>>();

  for (const transition of transitions) {
    const id = transition.id;
    const segments = id.split(".");
    const component = segments[0] ?? id;
    const event = segments[1] ?? "_";
    const path = segments.length > 2 ? segments.slice(2) : ["_"];

    let events = byComponent.get(component);
    if (!events) {
      events = new Map();
      byComponent.set(component, events);
    }
    let leaves = events.get(event);
    if (!leaves) {
      leaves = [];
      events.set(event, leaves);
    }
    leaves.push({ path, transitionId: id });
  }

  const components: TransitionComponentGroup[] = [];
  for (const [component, eventsMap] of [...byComponent.entries()].sort(
    (left, right) => left[0].localeCompare(right[0]),
  )) {
    const events: TransitionEventGroup[] = [];
    for (const [event, leaves] of [...eventsMap.entries()].sort((left, right) =>
      left[0].localeCompare(right[0]),
    )) {
      events.push({
        event,
        leaves: [...leaves].sort(
          (left, right) =>
            compareTransitionPaths(left.path, right.path) ||
            left.transitionId.localeCompare(right.transitionId),
        ),
      });
    }
    components.push({ component, events });
  }
  return components;
}
