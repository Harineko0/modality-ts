import type {
  AbstractDomain,
  EffectIR,
  ExtractionCaveat,
} from "modality-ts/core";
import type { SurfaceCall, SurfaceStmt } from "../../lang/surface-ir.js";
import type { DecodedSetterBinding, ModalityAdapterBase } from "./index.js";
import type { SymbolPort } from "./symbol-port.js";

export type EffectSurfaceCall = SurfaceCall;

export interface EffectSummaryLike {
  effect: EffectIR;
  reads: string[];
}

export interface EffectCtx {
  component: string;
  fileName: string;
  symbols?: SymbolPort;
  setters: ReadonlyMap<string, DecodedSetterBinding>;
}

export interface EffectModel {
  channel: "timer" | "websocket" | "promise" | string;
  enqueue: EffectIR;
  resolution: { domain: AbstractDomain; effect: EffectIR };
  caveats?: ExtractionCaveat[];
}

export interface EffectRecognition {
  model: EffectModel;
  scheduleSummary: EffectSummaryLike;
}

export interface EffectAssignmentRecognition {
  scheduleSummaries: EffectSummaryLike[];
}

export interface EffectPlugin extends ModalityAdapterBase {
  kind: "effect";
  recognizeEffect(
    call: EffectSurfaceCall,
    ctx: EffectCtx,
  ): EffectRecognition | undefined;
  recognizeEffectAssignment?(
    statement: SurfaceStmt,
    ctx: EffectCtx,
  ): EffectAssignmentRecognition | undefined;
}
