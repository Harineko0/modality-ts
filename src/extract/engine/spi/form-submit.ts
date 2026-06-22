import type {
  EffectIR,
  ExtractionCaveat,
  SourceAnchor,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import type * as ts from "typescript";
import type { SemanticTypeContext } from "./index.js";
import type {
  ExtractionWarning,
  SetterBinding,
} from "../ts/types.js";

export type SurfaceNode = ts.Node;

export interface NavFormSubmitCtx {
  source: ts.SourceFile;
  fileName: string;
  component: string;
  route: string;
  setters: Map<string, SetterBinding>;
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
      setterBinding: SetterBinding;
    };

export interface NavUseSubmitHandlerCtx extends NavFormSubmitCtx {
  attr: string;
  effectApis: ReadonlySet<string>;
  disabledGuard?: import("../ts/transition/guards.js").ParsedGuard;
  types?: SemanticTypeContext;
}

export interface UseSubmitHandlerRecognition {
  form: FormSubmit;
  transitions: Transition[];
}
