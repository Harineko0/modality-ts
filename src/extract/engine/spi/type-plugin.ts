import type {
  AbstractDomain,
  ExtractionCaveat,
  NumericReduction,
} from "modality-ts/core";
import type { NodeRef } from "../../lang/ts/node-ref.js";
import type { OriginReader } from "../../lang/ts/origin-reader.js";
import type { SurfaceExpr } from "../../lang/ts/surface-ir.js";
import type { SymbolPort, TypeView } from "./symbol-port.js";

export interface TypeRefinementContext {
  typeView?: TypeView;
  typeAnnotation?: NodeRef;
  initializer?: SurfaceExpr;
  declaration?: NodeRef;
  fileName?: string;
  originReader: OriginReader;
  symbols?: SymbolPort;
  typeAliases: ReadonlyMap<string, NodeRef>;
  visited: ReadonlySet<string>;
  varId?: string;
}

export interface TypeRefinementResolution {
  domain?: AbstractDomain;
  caveats: ExtractionCaveat[];
  reductions?: NumericReduction[];
}

export interface TypePlugin {
  id: string;
  version?: string;
  packageNames: readonly string[];
  kind: "type";
  refineDomain(
    ctx: TypeRefinementContext,
  ): TypeRefinementResolution | undefined;
}
