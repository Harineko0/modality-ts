import type { ModelState, StepFacts, Trace, Transition } from "modality-ts/core";

export type PropertyVerdict =
  | { status: "verified-within-bounds"; property: string }
  | { status: "violated"; property: string; trace: Trace; replayable?: boolean; replayBlockedReason?: string }
  | { status: "reachable"; property: string; trace: Trace; replayable?: boolean; replayBlockedReason?: string }
  | { status: "vacuous-warning"; property: string; message: string }
  | { status: "error"; property: string; message: string };

export interface CheckResult {
  verdicts: PropertyVerdict[];
  stats: { states: number; edges: number; depth: number };
  vacuityWarnings: string[];
  boundHits: string[];
}

export interface CheckOptions {
  slicing?: boolean;
}

export interface Parent {
  parent: string | null;
  transition: Transition | null;
  pre: ModelState | null;
  post: ModelState;
}

export interface Edge {
  preCanon: string;
  postCanon: string;
  pre: ModelState;
  post: ModelState;
  transition: Transition;
  step: StepFacts;
}
