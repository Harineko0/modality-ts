import * as ts from "typescript";
import {
  callName,
  type ExtractableHandler,
  isExtractableHandler,
} from "../../engine/ts/ast.js";
import type { TsUnwrapHandlerCtx } from "../../engine/ts/framework-ts-bridge.js";

/**
 * Returns the set of local names that are bound to a handleSubmit function
 * from useForm() in the given source file.
 *
 * Handles:
 *   const form = useForm(...)           → "form.handleSubmit"
 *   const { handleSubmit } = useForm()  → "handleSubmit"
 *   const { handleSubmit: hs } = useForm() → "hs"
 */
function collectHandleSubmitNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      isUseFormCall(node.initializer)
    ) {
      if (ts.isIdentifier(node.name)) {
        // const form = useForm() → "form.handleSubmit"
        names.add(`${node.name.text}.handleSubmit`);
      } else if (ts.isObjectBindingPattern(node.name)) {
        // const { handleSubmit, handleSubmit: hs } = useForm()
        for (const element of node.name.elements) {
          const propName =
            element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : ts.isIdentifier(element.name)
                ? element.name.text
                : undefined;
          if (propName === "handleSubmit" && ts.isIdentifier(element.name)) {
            names.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function isUseFormCall(node: ts.CallExpression): boolean {
  const name = callName(node.expression);
  return name === "useForm" || name?.endsWith(".useForm") === true;
}

export function unwrapReactHookFormHandler(
  node: ts.Expression,
  ctx: TsUnwrapHandlerCtx,
): ExtractableHandler | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  const callee = callName(node.expression);
  if (!callee) return undefined;

  const names = collectHandleSubmitNames(ctx.sourceFile);
  if (!names.has(callee)) return undefined;

  // handleSubmit(onValid, ?onInvalid) — extract the first argument (onValid)
  const first = node.arguments[0];
  if (!first) return undefined;
  return isExtractableHandler(first) ? first : undefined;
}
