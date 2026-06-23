import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { extractReactSourceTransitions } from "../../src/extract/lang/ts/driver/react-source-transitions.js";
import { callbackEffect } from "../../src/extract/lang/ts/driver/transition/callback-effects.js";
import { unwrapReactHookFormHandler } from "../../src/extract/plugins/framework/react-hook-form/unwrap.js";

// ---------------------------------------------------------------------------
// Unit: adapter unwrap
// ---------------------------------------------------------------------------

function parseSource(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "test.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

describe("reactHookForm unwrap", () => {
  it("unwraps form.handleSubmit(cb) to the inner callback", () => {
    const source = parseSource(`
      import { useForm } from "react-hook-form";
      function App() {
        const form = useForm();
        const onSubmit = form.handleSubmit((values) => {
          console.log(values);
        });
      }
    `);
    const adapter = { unwrapHandler: unwrapReactHookFormHandler };
    let result: ts.ArrowFunction | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "onSubmit" &&
        node.initializer
      ) {
        const unwrapped = adapter.unwrapHandler(node.initializer, {
          sourceFile: source,
          fileName: "test.tsx",
        });
        if (unwrapped && ts.isArrowFunction(unwrapped)) result = unwrapped;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(result).toBeDefined();
  });

  it("unwraps destructured handleSubmit(cb)", () => {
    const source = parseSource(`
      import { useForm } from "react-hook-form";
      function App() {
        const { handleSubmit } = useForm();
        const onSubmit = handleSubmit((values) => {});
      }
    `);
    const adapter = { unwrapHandler: unwrapReactHookFormHandler };
    let result: ts.ArrowFunction | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "onSubmit" &&
        node.initializer
      ) {
        const unwrapped = adapter.unwrapHandler(node.initializer, {
          sourceFile: source,
          fileName: "test.tsx",
        });
        if (unwrapped && ts.isArrowFunction(unwrapped)) result = unwrapped;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(result).toBeDefined();
  });

  it("does not unwrap unrelated wrapper calls", () => {
    const source = parseSource(`
      function App() {
        const handler = debounce(() => {});
      }
    `);
    const adapter = { unwrapHandler: unwrapReactHookFormHandler };
    let result: unknown;
    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "handler" &&
        node.initializer
      ) {
        result = adapter.unwrapHandler(node.initializer, {
          sourceFile: source,
          fileName: "test.tsx",
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Integration: full extraction
// ---------------------------------------------------------------------------

const APPROVAL_FIXTURE = `
import { useState } from "react";
import { useForm } from "react-hook-form";

type ApprovalState = "indeterminate" | "approving" | "declining";

function ApiAuthorizationValidScreen() {
  const [approvalState, setApprovalState] = useState<ApprovalState>("indeterminate");
  const form = useForm();

  const onApproveRequest = form.handleSubmit((values) => {
    if (approvalState !== "indeterminate") {
      return;
    }
    setApprovalState("approving");
    approveRequest(
      { id: "auth_id", slug: values.selectedOrgSlug },
      { onError: () => setApprovalState("indeterminate") }
    );
  });

  const onDeclineRequest = form.handleSubmit((values) => {
    if (approvalState !== "indeterminate") {
      return;
    }
    setApprovalState("declining");
    declineRequest(
      { id: "auth_id", slug: values.selectedOrgSlug },
      { onError: () => setApprovalState("indeterminate") }
    );
  });

  return (
    <ApiAuthorizationMainView
      approvalState={approvalState}
      onApprove={onApproveRequest}
      onDecline={onDeclineRequest}
    />
  );
}
`;

describe("extractReactSourceTransitions with react-hook-form handleSubmit", () => {
  it("extracts onApprove handler — no no-extractable-effect warning", () => {
    const result = extractReactSourceTransitions(APPROVAL_FIXTURE, {
      fileName: "ApiAuthorization.Valid.tsx",
      effectApis: ["approveRequest", "declineRequest"],
    });

    const unextractableWarnings = result.warnings.filter(
      (w) =>
        w.caveat?.kind === "unextractable" &&
        (w.caveat.id.includes("onApprove") ||
          w.caveat.id.includes("onDecline")),
    );
    expect(unextractableWarnings).toHaveLength(0);
  });

  it("extracts user transitions that write approvalState=approving and approvalState=declining", () => {
    const result = extractReactSourceTransitions(APPROVAL_FIXTURE, {
      fileName: "ApiAuthorization.Valid.tsx",
      effectApis: ["approveRequest", "declineRequest"],
    });

    const approvalStateVar = result.vars.find((v) =>
      v.id.includes("approvalState"),
    );
    expect(approvalStateVar).toBeDefined();
    const varId = approvalStateVar!.id;

    const userTransitions = result.transitions.filter((t) => t.cls === "user");
    const approvingTransition = userTransitions.find(
      (t) =>
        t.writes.includes(varId) &&
        JSON.stringify(t.effect).includes('"approving"'),
    );
    const decliningTransition = userTransitions.find(
      (t) =>
        t.writes.includes(varId) &&
        JSON.stringify(t.effect).includes('"declining"'),
    );
    expect(approvingTransition).toBeDefined();
    expect(decliningTransition).toBeDefined();
  });

  it("extracts enqueue + error resolve transitions for approveRequest", () => {
    const result = extractReactSourceTransitions(APPROVAL_FIXTURE, {
      fileName: "ApiAuthorization.Valid.tsx",
      effectApis: ["approveRequest", "declineRequest"],
    });

    const enqueue = result.transitions.find(
      (t) =>
        t.cls === "user" &&
        t.id.includes("approveRequest") &&
        t.id.endsWith(".start"),
    );
    const errorResolve = result.transitions.find(
      (t) =>
        t.cls === "env" &&
        t.label.kind === "resolve" &&
        (t.label as { kind: "resolve"; op: string; outcome: string }).op ===
          "approveRequest" &&
        (t.label as { kind: "resolve"; op: string; outcome: string })
          .outcome === "error",
    );
    expect(enqueue).toBeDefined();
    expect(errorResolve).toBeDefined();
  });

  it("error resolve transition resets approvalState to indeterminate", () => {
    const result = extractReactSourceTransitions(APPROVAL_FIXTURE, {
      fileName: "ApiAuthorization.Valid.tsx",
      effectApis: ["approveRequest", "declineRequest"],
    });

    const approvalStateVar = result.vars.find((v) =>
      v.id.includes("approvalState"),
    );
    const varId = approvalStateVar!.id;

    const errorResolve = result.transitions.find(
      (t) =>
        t.cls === "env" &&
        t.label.kind === "resolve" &&
        (t.label as { kind: "resolve"; op: string; outcome: string }).op ===
          "approveRequest" &&
        (t.label as { kind: "resolve"; op: string; outcome: string })
          .outcome === "error",
    );
    expect(errorResolve).toBeDefined();
    expect(errorResolve!.writes).toContain(varId);
    expect(JSON.stringify(errorResolve!.effect)).toContain('"indeterminate"');
  });
});

// ---------------------------------------------------------------------------
// Unit: callback-effect detection
// ---------------------------------------------------------------------------

describe("callbackEffect detection", () => {
  it("detects a bare callback-style mutation call", () => {
    const source = parseSource(
      `approveRequest({ id }, { onError: () => {} });`,
    );
    const stmt = source.statements[0];
    expect(stmt).toBeDefined();
    const effectApis = new Set(["approveRequest"]);
    const found = callbackEffect(stmt!, effectApis, "test.tsx");
    expect(found).toBeDefined();
    expect(found?.op).toBe("approveRequest");
  });

  it("does not detect an await-expression as a callback effect", () => {
    const source = parseSource(`await approveRequest({ id });`);
    const stmt = source.statements[0];
    const effectApis = new Set(["approveRequest"]);
    const found = callbackEffect(stmt!, effectApis, "test.tsx");
    // await expressions are ExpressionStatements with AwaitExpression, not CallExpression directly
    expect(found).toBeUndefined();
  });
});
