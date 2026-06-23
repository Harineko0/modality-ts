import type { Value } from "modality-ts/core";
import type { NodeRef } from "../../lang/node-ref.js";
import type { SurfaceExpr, SymbolRef } from "../../lang/surface-ir.js";

export type { NodeRef, SymbolRef };

export interface ResolvedSymbol {
  name: string;
  kind: "local" | "parameter" | "import" | "module" | "property" | "unknown";
  module?: string;
  declaration?: NodeRef;
}

export interface ImportBinding {
  module: string;
  exportedName: string;
  isNamespace: boolean;
}

export type TypeView =
  | {
      kind: "primitive";
      name: "string" | "number" | "boolean" | "undefined" | "null" | "unknown";
    }
  | { kind: "literal"; value: Value }
  | { kind: "union"; members: TypeView[] }
  | { kind: "object"; properties: string[] }
  | { kind: "opaque" };

export interface SymbolPort {
  resolve(ref: SymbolRef): ResolvedSymbol | undefined;
  localSymbolKey(ref: SymbolRef): string | undefined;
  importBinding(ref: SymbolRef): ImportBinding | undefined;
  typeOf(expr: SurfaceExpr): TypeView | undefined;
}
