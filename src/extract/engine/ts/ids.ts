import * as ts from "typescript";
import type { Transition } from "modality-ts/core";
import type { InternalTransition } from "./types.js";

export function withStableTransitionIds(transitions: readonly Transition[]): Transition[] {
  const groups = new Map<string, InternalTransition[]>();
  for (const transition of transitions) {
    const group = groups.get(transition.id) ?? [];
    group.push(transition as InternalTransition);
    groups.set(transition.id, group);
  }
  const emitted = new Map<string, number>();
  return transitions.map((transition) => {
    const internal = transition as InternalTransition;
    const group = groups.get(transition.id) ?? [];
    const base = stripInternalTransition(internal);
    if (group.length <= 1) return base;
    const suffix = shortHash(internal.__stableIdKey ?? canonicalTransitionKey(base));
    const id = `${transition.id}.${suffix}`;
    const count = emitted.get(id) ?? 0;
    emitted.set(id, count + 1);
    return { ...base, id: count === 0 ? id : `${id}.${count + 1}` };
  });
}

export function tagStableIdKey(transitions: readonly Transition[], node: ts.Node): Transition[] {
  const key = normalizedAstKey(node);
  return transitions.map((transition) => ({ ...(transition as InternalTransition), __stableIdKey: key }));
}

export function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_") || "value";
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function stripInternalTransition(transition: InternalTransition): Transition {
  const { __stableIdKey: _ignored, ...publicTransition } = transition;
  return publicTransition;
}

function canonicalTransitionKey(transition: Transition): string {
  return JSON.stringify({
    label: transition.label,
    guard: transition.guard,
    effect: transition.effect,
    reads: transition.reads,
    writes: transition.writes
  });
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, "0").slice(0, 6);
}

function normalizedAstKey(node: ts.Node): string {
  return node
    .getText()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, "");
}
