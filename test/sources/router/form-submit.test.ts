import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { reactRouterAdapter } from "modality-ts/extract/sources/router";

function sourceFile(sourceText: string, fileName = "Form.tsx"): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

describe("router recognizeFormSubmit", () => {
  const router = reactRouterAdapter();

  it("returns the identical enqueue effect for <Form method=post>", () => {
    const source = sourceFile(`
      import { Form } from 'react-router';
      export default function Home() {
        return (
          <Form method="post">
            <input type="hidden" name="intent" value="brew-start" />
            <button type="submit">Start</button>
          </Form>
        );
      }
    `);
    const opening = source.statements[1] as ts.FunctionDeclaration;
    const returnStmt = (opening.body!.statements[0] as ts.ReturnStatement)
      .expression as ts.ParenthesizedExpression;
    const formElement = (returnStmt.expression as ts.JsxElement).openingElement;
    const warnings: import("modality-ts/extract/engine/ts/types.js").ExtractionWarning[] =
      [];
    const recognized = router.recognizeFormSubmit?.(formElement, {
      source,
      fileName: "Form.tsx",
      component: "Home",
      route: "/",
      setters: new Map(),
      submitBindings: new Map(),
      modeledSubmitHandlers: new Set(),
      warnings,
    });
    expect(recognized?.kind).toBe("submit");
    if (recognized?.kind !== "submit") return;
    expect(recognized.form.effect).toEqual({
      kind: "seq",
      effects: [
        {
          kind: "enqueue",
          op: "ACTION /",
          continuation: "Home.onSubmit.ACTION /.cont",
          args: { intent: { kind: "lit", value: "brew-start" } },
        },
      ],
    });
    expect(recognized.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining([
        "Home.onSubmit.ACTION /.start",
        "Home.onSubmit.ACTION /.success",
        "Home.onSubmit.ACTION /.error",
      ]),
    );
  });

  it("recognizes useSubmit bindings and useActionData vars", () => {
    const source = sourceFile(`
      import { useSubmit, useActionData } from 'react-router';
      export default function CustomerHome() {
        const submit = useSubmit();
        const actionData = useActionData();
        return null;
      }
    `);
    const fn = source.statements.find(ts.isFunctionDeclaration);
    expect(fn).toBeDefined();
    const decls: ts.VariableDeclaration[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) decls.push(node);
      ts.forEachChild(node, visit);
    };
    visit(fn!);
    const submitDecl = decls.find(
      (decl) =>
        ts.isIdentifier(decl.name) && decl.name.text === "submit",
    );
    const actionDataDecl = decls.find(
      (decl) =>
        ts.isIdentifier(decl.name) && decl.name.text === "actionData",
    );
    expect(submitDecl).toBeDefined();
    expect(actionDataDecl).toBeDefined();
    const ctx = {
      source,
      fileName: "Form.tsx",
      component: "CustomerHome",
      route: "/customer",
      setters: new Map(),
      submitBindings: new Map<string, boolean>(),
      modeledSubmitHandlers: new Set<string>(),
      warnings: [],
    };
    expect(router.recognizeFormSubmit?.(submitDecl!, ctx)).toEqual({
      kind: "use-submit-binding",
      name: "submit",
    });
    const actionData = router.recognizeFormSubmit?.(actionDataDecl!, ctx);
    expect(actionData?.kind).toBe("action-data");
    if (actionData?.kind !== "action-data") return;
    expect(actionData.varDecl.id).toBe("router:actionData:_customer:CustomerHome");
    expect(actionData.setterBinding.varId).toBe(
      "router:actionData:_customer:CustomerHome",
    );
  });
});
