import type {
  EffectIR,
  ExtractionCaveat,
  SourceAnchor,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import type { NodeRef } from "../../lang/ts/node-ref.js";
import type { SurfaceExpr } from "../../lang/ts/surface-ir.js";
import type { DecodedSetterBinding, ExtractionWarning } from "./index.js";

export interface RouteFormSubmitCtx {
  fileName: string;
  sourceText?: string;
  component: string;
  route: string;
  setters: Map<string, DecodedSetterBinding>;
  actionDataVarId?: string;
  submitBindings: Map<string, boolean>;
  modeledSubmitHandlers: Set<string>;
  warnings: ExtractionWarning[];
}

export interface FormSubmit {
  action?: string;
  effect: EffectIR;
  caveats?: ExtractionCaveat[];
}

export type FormSubmitRecognition =
  | {
      kind: "submit";
      form: FormSubmit;
      transitions: Transition[];
      sourceAnchor: SourceAnchor[];
    }
  | { kind: "use-submit-binding"; name: string }
  | {
      kind: "action-data";
      localName: string;
      varDecl: StateVarDecl;
      setterBinding: DecodedSetterBinding;
    };

export interface RouteUseSubmitHandlerCtx extends RouteFormSubmitCtx {
  attr: string;
  effectApis: ReadonlySet<string>;
  disabledGuard?: { expression: SurfaceExpr; origin: NodeRef };
}

export interface UseSubmitHandlerRecognition {
  form: FormSubmit;
  transitions: Transition[];
}

export interface RouteJsxSubmitCtx extends RouteFormSubmitCtx {
  tag: string;
  attrs: ReadonlyMap<string, SurfaceExpr | undefined>;
}

export interface RouteHandlerRef {
  origin: NodeRef;
  name?: string;
}
