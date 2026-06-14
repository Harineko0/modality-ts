import type { ModelState, Value } from "modality-ts/core";

export interface PendingOp {
  [key: string]: Value;
  opId: string;
  continuation: string;
  args: Record<string, Value>;
}

export function readPending(state: ModelState): PendingOp[] {
  const pending = state["sys:pending"];
  return Array.isArray(pending) ? (pending as PendingOp[]) : [];
}
