import type { Transition } from "modality-ts/core";
import type { SemanticTypeContext } from "../../../lang/ts/semantic-type-context.js";
import type { EnvironmentEventConfig } from "../environment-config.js";
import type { ExtractableHandler, ExtractionWarning } from "../types.js";
import type { TransitionBinding } from "./concurrent.js";
import type { WebSocketRegistration } from "./environment-callbacks.js";
import type { TimerRegistration } from "./timers.js";

export interface StatementSummaryState {
  locals: Map<string, import("../types.js").BoundExpr>;
  handlers?: Map<string, ExtractableHandler>;
  resetSymbols?: ReadonlySet<string>;
  snapshotReads: boolean;
  snapshottedReads?: ReadonlySet<string>;
  component?: string;
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
  warnings?: ExtractionWarning[];
  fileName?: string;
  source?: import("typescript").SourceFile;
  types?: SemanticTypeContext;
  effectPlugins?: readonly import("../../spi/index.js").EffectPlugin[];
}
