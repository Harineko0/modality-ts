import type { Model, ModelState, Transition } from "modality-ts/core";
import { applyEffect, guardHolds } from "../runtime/effects.js";
import { routeLocalMounted } from "./mounts.js";
import { changedVars, uniqueStabilizingStates } from "./state-utils.js";
import type { TransitionIndex } from "./transitions.js";

interface StabilizingState {
  state: ModelState;
  changed: ReadonlySet<string>;
}

export function stabilize(
  model: Model,
  state: ModelState,
  changed: ReadonlySet<string>,
  index?: TransitionIndex,
  canon?: (state: ModelState) => string,
): ModelState[] {
  let states: StabilizingState[] = [{ state, changed }];
  for (let i = 0; i < model.bounds.maxInternalSteps; i += 1) {
    const next: StabilizingState[] = [];
    let changedThisRound = false;
    for (const candidate of states) {
      const candidates = indexedInternalCandidates(index, candidate.changed);
      const internal = (
        index
          ? candidates
          : model.transitions.filter(
              (transition) => transition.cls === "internal",
            )
      )
        .filter(
          (transition) =>
            routeLocalMounted(model, transition, candidate.state) &&
            internalTriggered(transition, candidate.changed) &&
            guardHolds(model, transition, candidate.state),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
      if (internal.length === 0) next.push(candidate);
      else {
        changedThisRound = true;
        for (const sequence of stabilizingSequences(internal)) {
          next.push(...applyInternalSequence(model, candidate.state, sequence));
        }
      }
    }
    states = uniqueStabilizingStates(model, next, canon);
    if (!changedThisRound) return states.map((candidate) => candidate.state);
  }
  throw new Error(
    `Internal transitions did not stabilize within ${model.bounds.maxInternalSteps} steps`,
  );
}

function indexedInternalCandidates(
  index: TransitionIndex | undefined,
  changed: ReadonlySet<string>,
): Transition[] {
  if (!index) return [];
  const seen = new Set<string>();
  const out: Transition[] = [];
  const add = (transition: Transition) => {
    if (!seen.has(transition.id)) {
      seen.add(transition.id);
      out.push(transition);
    }
  };
  for (const transition of index.alwaysTriggeredInternal) add(transition);
  for (const varId of changed) {
    for (const transition of index.internalByTriggeredVar.get(varId) ?? []) {
      add(transition);
    }
  }
  return out;
}

function internalTriggered(
  transition: Transition,
  changed: ReadonlySet<string>,
): boolean {
  if (!transition.triggeredBy || transition.triggeredBy.length === 0)
    return true;
  return transition.triggeredBy.some((id) => changed.has(id));
}

function stabilizingSequences(
  internal: readonly Transition[],
): readonly Transition[][] {
  if (!hasWriteConflict(internal)) return [internal.slice()];
  return permutations(internal);
}

function applyInternalSequence(
  model: Model,
  state: ModelState,
  sequence: readonly Transition[],
): StabilizingState[] {
  return sequence.reduce<StabilizingState[]>(
    (states, transition) =>
      states.flatMap((candidate) => {
        if (
          !routeLocalMounted(model, transition, candidate.state) ||
          !guardHolds(model, transition, candidate.state)
        ) {
          return [candidate];
        }
        return applyEffect(model, candidate.state, transition.effect).map(
          (post) => ({
            state: post,
            changed: changedVars(state, post, model),
          }),
        );
      }),
    [{ state, changed: new Set<string>() }],
  );
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [values.slice()];
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    if (head === undefined) continue;
    const tail = values.filter((_, candidateIndex) => candidateIndex !== index);
    for (const rest of permutations(tail)) out.push([head, ...rest]);
  }
  return out;
}

function hasWriteConflict(transitions: readonly Transition[]): boolean {
  for (let i = 0; i < transitions.length; i += 1) {
    for (let j = i + 1; j < transitions.length; j += 1) {
      const left = transitions[i];
      const right = transitions[j];
      if (left && right && intersects(left.writes, right.writes)) return true;
    }
  }
  return false;
}

function intersects(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const seen = new Set(left);
  return right.some((item) => seen.has(item));
}
