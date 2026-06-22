import type { Transition } from "modality-ts/core";
import type { NavFormSubmitCtx, SemanticTypeContext } from "../../spi/index.js";
import type { EffectOpAliases } from "../effect-op-aliases.js";
import type { BoundExpr } from "../types.js";
import type { TransitionBinding } from "./concurrent.js";
import type { TimerRegistration } from "./timers.js";

export interface HandlerExtractionContext {
  activeBoundary?: string;
  initialLocals?: Map<string, BoundExpr>;
  valueSuffix?: string;
  transitionBindings?: Map<string, TransitionBinding>;
  timerRegistrations?: TimerRegistration[];
  envTransitions?: Transition[];
  timerIndex?: { value: number };
  routerSubmitContext?: NavFormSubmitCtx;
  effectOpAliases?: EffectOpAliases;
  effectModelProviders?: readonly import("../../spi/index.js").EffectModelProvider[];
  types?: SemanticTypeContext;
  semanticName?: string;
}

export {
  boundedListIndexGuard,
  readListItemBinding,
  transitionsFromBoundedListAttribute,
  transitionsFromBoundedListComponentPropAttribute,
  transitionsFromComponentPropAttribute,
  transitionsFromJsxAttribute,
  transitionsFromLiteralListAttribute,
} from "./handler-jsx-attrs.js";

export { transitionsFromResolvedHandler } from "./handler-resolution.js";

export {
  conditionalTransitionFromHandler,
  escapedSetterTransitions,
  loopWriteTransitions,
  sequentialTransitionFromHandler,
  stateNameForVar,
} from "./handler-sequential.js";
