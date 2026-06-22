import { lowerStatement as lowerTsStatementImpl } from "../lang/ts/lower.js";
import { createTsSymbolPort } from "../lang/ts/symbol-port.js";
import {
  installSurfaceLowerer,
  installSymbolPortFactory,
} from "../engine/ts/surface-bridge-slot.js";

export function installSurfaceBridge(): void {
  installSurfaceLowerer((statement, fileName) =>
    lowerTsStatementImpl(statement, fileName),
  );
  installSymbolPortFactory((ctx) => createTsSymbolPort(ctx));
}

installSurfaceBridge();
