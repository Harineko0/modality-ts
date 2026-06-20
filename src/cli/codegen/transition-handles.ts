import type { EventLabel, Transition } from "modality-ts/core";

function safeId(value: string): string {
  const sanitized = value.replace(/[^a-zA-Z0-9_-]+/g, "_") || "value";
  return /^[a-zA-Z]/u.test(sanitized) ? sanitized : `_${sanitized}`;
}

function camelCase(value: string): string {
  const tokens = value
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return "value";
  const [first, ...rest] = tokens;
  const head = first.charAt(0).toLowerCase() + first.slice(1);
  const tail = rest
    .map(
      (token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase(),
    )
    .join("");
  return `${head}${tail}`;
}

function lowerCamelComponent(componentId: string): string {
  if (!componentId) return "component";
  return componentId.charAt(0).toLowerCase() + componentId.slice(1);
}

function componentIdFromTransitionId(id: string): string {
  return id.split(".")[0] ?? id;
}

function fieldNameFromWrite(write: string): string | undefined {
  if (!write.startsWith("local:")) return undefined;
  const rest = write.slice("local:".length);
  const dot = rest.indexOf(".");
  if (dot < 0) return undefined;
  return rest.slice(dot + 1);
}

function writesToken(writes: readonly string[]): string | undefined {
  const fields = writes
    .map((write) => fieldNameFromWrite(write))
    .filter((field): field is string => field !== undefined);
  return fields.length > 0 ? fields.join("_") : undefined;
}

function tokenFromLabel(label: EventLabel, writes: readonly string[]): string {
  if (
    label.kind === "click" ||
    label.kind === "submit" ||
    label.kind === "input"
  ) {
    const locator = label.locator;
    if (locator) {
      if (locator.kind === "testId") {
        return camelCase(locator.value);
      }
      if (locator.kind === "role") {
        return locator.name ? camelCase(locator.name) : locator.role;
      }
    }
  }

  if (
    (label.kind === "click" || label.kind === "submit") &&
    label.text !== undefined
  ) {
    return camelCase(label.text);
  }

  const fromWrites = writesToken(writes);
  if (fromWrites) return fromWrites;

  return label.kind;
}

/**
 * Derive a raw (pre-collision) export name for a transition handle from its id and label.
 */
export function transitionHandleName(transition: Transition): string {
  const component = lowerCamelComponent(
    componentIdFromTransitionId(transition.id),
  );
  const token = tokenFromLabel(transition.label, transition.writes);
  return safeId(`${component}_${token}`);
}

/**
 * Assign collision-safe export names deterministically (`_2`, `_3`, … for later duplicates).
 */
export function assignTransitionHandleNames(
  transitions: readonly Transition[],
): { transition: Transition; name: string }[] {
  const raw = transitions.map((transition) => ({
    transition,
    name: transitionHandleName(transition),
  }));
  const seen = new Map<string, number>();
  return raw.map((entry) => {
    const count = seen.get(entry.name) ?? 0;
    seen.set(entry.name, count + 1);
    const name = count === 0 ? entry.name : `${entry.name}_${count + 1}`;
    return { transition: entry.transition, name };
  });
}
