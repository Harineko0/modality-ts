import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import type { Model } from "@modality/kernel";
import { emitAppModel } from "../src/codegen/model.js";

describe("emitAppModel", () => {
  it("emits a type-checkable app.model.ts with typed vars and initial state", () => {
    const model: Model = {
      schemaVersion: 1,
      id: "fixture",
      bounds: { maxDepth: 4, maxPending: 1, maxInternalSteps: 4 },
      vars: [
        {
          id: "atom:auth",
          domain: {
            kind: "tagged",
            tag: "kind",
            variants: {
              guest: { kind: "record", fields: {} },
              user: { kind: "record", fields: { name: { kind: "enum", values: ["Ada"] } } }
            }
          },
          origin: { file: "state.ts", line: 1, column: 1 },
          scope: { kind: "global" },
          initial: { kind: "guest" }
        },
        {
          id: "local:App.items",
          domain: { kind: "lengthCat" },
          origin: { file: "App.tsx", line: 2, column: 3 },
          scope: { kind: "route-local", route: "/" },
          initial: "0"
        }
      ],
      transitions: []
    };

    const text = emitAppModel(model);
    const diagnostics = ts.transpileModule(text, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        strict: true
      },
      reportDiagnostics: true
    }).diagnostics ?? [];

    expect(diagnostics.map((diagnostic) => diagnostic.messageText)).toEqual([]);
    expect(text).toContain("\"atom:auth\": { kind: \"guest\";  } | { kind: \"user\"; name: \"Ada\"; };");
    expect(text).toContain("\"local:App.items\": \"0\" | \"1\" | \"many\";");
    expect(text).toContain("export const initialState = {\"atom:auth\":{\"kind\":\"guest\"},\"local:App.items\":\"0\"}");
  });
});
