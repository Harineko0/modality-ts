import type {
  AbstractDomain,
  EffectIR,
  ExtractionCaveat,
  Transition,
} from "modality-ts/core";
import type * as ts from "typescript";
import type { ModalityAdapterBase } from "./index.js";
import type { EnvironmentEventConfig } from "../ts/environment-config.js";
import type {
  ExtractableHandler,
  EffectSummary,
  SetterBinding,
} from "../ts/types.js";
import type { TimerRegistration } from "../ts/transition/timers.js";
import type { WebSocketRegistration } from "../ts/transition/environment-callbacks.js";
import type { TransitionBinding } from "../ts/transition/concurrent.js";

export type EffectSurfaceCall = ts.CallExpression | ts.NewExpression;

export interface EffectCtx {
  component: string;
  source: ts.SourceFile;
  fileName: string;
  setters: Map<string, SetterBinding>;
  timerContext?: string;
  timerIndex?: { value: number };
  timerBindings?: Map<string, string>;
  timerRegistrations?: TimerRegistration[];
  webSocketRegistrations?: WebSocketRegistration[];
  webSocketBindings?: Map<string, string>;
  webSocketIndex?: { value: number };
  environment?: EnvironmentEventConfig;
  transitionBindings?: Map<string, TransitionBinding>;
  envTransitions?: Transition[];
  handlers?: Map<string, ExtractableHandler>;
  resetSymbols?: ReadonlySet<string>;
  snapshotReads?: boolean;
  snapshottedReads?: ReadonlySet<string>;
  warnings?: import("../ts/types.js").ExtractionWarning[];
  types?: import("./index.js").SemanticTypeContext;
}

export interface EffectModel {
  channel: "timer" | "websocket" | "promise" | string;
  enqueue: EffectIR;
  resolution: { domain: AbstractDomain; effect: EffectIR };
  caveats?: ExtractionCaveat[];
}

export interface EffectModelRecognition {
  model: EffectModel;
  scheduleSummary: EffectSummary;
}

export interface EffectModelAssignmentRecognition {
  scheduleSummaries: EffectSummary[];
}

export interface EffectModelProvider extends ModalityAdapterBase {
  kind: "effect-model";
  recognizeEffect(
    call: EffectSurfaceCall,
    ctx: EffectCtx,
  ): EffectModelRecognition | undefined;
  recognizeEffectAssignment?(
    statement: ts.ExpressionStatement,
    ctx: EffectCtx,
  ): EffectModelAssignmentRecognition | undefined;
}
