import ts from "typescript";

export interface MutationSite {
  operatorId: string;
  siteId: string;
  start: number;
  end: number;
  description: string;
}

export interface ConcreteMutation extends MutationSite {
  mutatedText: string;
}

export interface MutationOperator {
  id: string;
  describe(site: MutationSite): string;
  appliesTo(node: ts.Node, sourceFile: ts.SourceFile): boolean;
  mutate(node: ts.Node, context: MutationContext): ts.Node | undefined;
}

export interface MutationContext {
  sourceFile: ts.SourceFile;
}

export function enumerateMutationSites(
  sourceText: string,
  fileName = "source.tsx",
  operatorIds?: readonly string[],
): MutationSite[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const enabled = new Set(operatorIds ?? mutationOperators.map((op) => op.id));
  const sites: MutationSite[] = [];
  const counters = new Map<string, number>();
  const visit = (node: ts.Node) => {
    for (const operator of mutationOperators) {
      if (!enabled.has(operator.id)) continue;
      if (!operator.appliesTo(node, sourceFile)) continue;
      const index = (counters.get(operator.id) ?? 0) + 1;
      counters.set(operator.id, index);
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const site: MutationSite = {
        operatorId: operator.id,
        siteId: `${operator.id}:${index}:${start}-${end}`,
        start,
        end,
        description: operator.describe({
          operatorId: operator.id,
          siteId: "",
          start,
          end,
          description: "",
        }),
      };
      sites.push(site);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites.sort(
    (left, right) =>
      left.start - right.start ||
      left.operatorId.localeCompare(right.operatorId) ||
      left.siteId.localeCompare(right.siteId),
  );
}

export function applyMutation(
  sourceText: string,
  site: MutationSite,
  fileName = "source.tsx",
): ConcreteMutation {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const operator = mutationOperators.find(
    (entry) => entry.id === site.operatorId,
  );
  if (!operator)
    throw new Error(`unknown mutation operator ${site.operatorId}`);
  let mutated = false;
  const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
    const visit: ts.Visitor = (node) => {
      if (
        !mutated &&
        node.getStart(sourceFile) === site.start &&
        node.getEnd() === site.end &&
        operator.appliesTo(node, sourceFile)
      ) {
        const replacement = operator.mutate(node, { sourceFile });
        if (!replacement) {
          mutated = true;
          return undefined;
        }
        mutated = true;
        return replacement;
      }
      return ts.visitEachChild(node, visit, context);
    };
    return (node) => ts.visitNode(node, visit) as ts.SourceFile;
  };
  const result = ts.transform(sourceFile, [transformer]);
  try {
    if (!mutated) throw new Error(`mutation site not found: ${site.siteId}`);
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    return {
      ...site,
      mutatedText: printer.printFile(result.transformed[0]),
    };
  } finally {
    result.dispose();
  }
}

function binaryOperator(
  id: string,
  swaps: ReadonlyMap<ts.SyntaxKind, ts.SyntaxKind>,
  label: string,
): MutationOperator {
  return {
    id,
    describe: () => label,
    appliesTo(node) {
      return ts.isBinaryExpression(node) && swaps.has(node.operatorToken.kind);
    },
    mutate(node) {
      if (!ts.isBinaryExpression(node)) return node;
      const next = swaps.get(node.operatorToken.kind);
      if (!next) return node;
      return ts.factory.updateBinaryExpression(
        node,
        node.left,
        ts.factory.createToken(next) as ts.BinaryOperatorToken,
        node.right,
      );
    },
  };
}

const boundaryOperator = binaryOperator(
  "conditional-boundary",
  new Map([
    [ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken],
    [ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.LessThanToken],
    [ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken],
    [ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.GreaterThanToken],
  ]),
  "swap conditional boundary",
);

const equalityNegationOperator = binaryOperator(
  "negate-conditional-equality",
  new Map([
    [
      ts.SyntaxKind.EqualsEqualsEqualsToken,
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ],
    [
      ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ts.SyntaxKind.EqualsEqualsEqualsToken,
    ],
  ]),
  "negate equality conditional",
);

const ifGuardNegationOperator: MutationOperator = {
  id: "negate-conditional-guard",
  describe: () => "invert if guard",
  appliesTo: (node) => ts.isIfStatement(node),
  mutate(node) {
    if (!ts.isIfStatement(node)) return node;
    return ts.factory.updateIfStatement(
      node,
      ts.factory.createPrefixUnaryExpression(
        ts.SyntaxKind.ExclamationToken,
        parenthesize(node.expression),
      ),
      node.thenStatement,
      node.elseStatement,
    );
  },
};

function removeConditionalOperator(
  id: string,
  value: boolean,
): MutationOperator {
  return {
    id,
    describe: () => `force guard ${String(value)}`,
    appliesTo: (node) => ts.isIfStatement(node),
    mutate(node) {
      if (!ts.isIfStatement(node)) return node;
      return ts.factory.updateIfStatement(
        node,
        value ? ts.factory.createTrue() : ts.factory.createFalse(),
        node.thenStatement,
        node.elseStatement,
      );
    },
  };
}

const removeConditionalTrueOperator = removeConditionalOperator(
  "remove-conditional-true",
  true,
);
const removeConditionalFalseOperator = removeConditionalOperator(
  "remove-conditional-false",
  false,
);

const dropSetterCallOperator: MutationOperator = {
  id: "drop-state-write",
  describe: () => "drop setX state write",
  appliesTo(node) {
    return (
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      /^set[A-Z0-9_]/.test(node.expression.expression.text)
    );
  },
  mutate() {
    return ts.factory.createEmptyStatement();
  },
};

const numericOffByOneOperator: MutationOperator = {
  id: "numeric-off-by-one",
  describe: () => "shift numeric bound by one",
  appliesTo(node, sourceFile) {
    if (!ts.isNumericLiteral(node)) return false;
    const parent = node.parent;
    return (
      ts.isBinaryExpression(parent) &&
      parent.getStart(sourceFile) !== node.getStart(sourceFile)
    );
  },
  mutate(node) {
    if (!ts.isNumericLiteral(node)) return node;
    const value = Number(node.text);
    if (!Number.isFinite(value)) return node;
    return ts.factory.createNumericLiteral(String(value + 1));
  },
};

const swapIfElseOperator: MutationOperator = {
  id: "swap-if-else",
  describe: () => "swap if/else branch bodies",
  appliesTo(node) {
    return ts.isIfStatement(node) && node.elseStatement !== undefined;
  },
  mutate(node) {
    if (!ts.isIfStatement(node) || !node.elseStatement) return node;
    return ts.factory.updateIfStatement(
      node,
      node.expression,
      node.elseStatement,
      node.thenStatement,
    );
  },
};

export const mutationOperators: readonly MutationOperator[] = [
  boundaryOperator,
  equalityNegationOperator,
  ifGuardNegationOperator,
  removeConditionalTrueOperator,
  removeConditionalFalseOperator,
  dropSetterCallOperator,
  numericOffByOneOperator,
  swapIfElseOperator,
];

function parenthesize(expression: ts.Expression): ts.Expression {
  if (
    ts.isIdentifier(expression) ||
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression) ||
    ts.isCallExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return expression;
  }
  return ts.factory.createParenthesizedExpression(expression);
}
