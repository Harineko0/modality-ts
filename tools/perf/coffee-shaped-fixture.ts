import {
  always,
  enabled,
  eq,
  lit,
  neq,
  notExpr,
  orExpr,
  readVar,
  type Model,
  type Property,
} from "modality-ts/core";
import { routeMountScope } from "../../src/extract/engine/ts/routes.js";

export const COFFEE_SHAPED_DENSITY_ONE_PROPERTY =
  "densityOneRequiresConnectedPrinter";
export const COFFEE_SHAPED_DENSITY_SEVEN_PROPERTY =
  "densitySevenDisabledWhenPrinterDisconnected";
export const COFFEE_SHAPED_LOAD_MORE_PROPERTY =
  "loadMoreOrdersEnabledOnlyWithCursorAndIdleDialog";

const bool = { kind: "bool" } as const;
const pendingOp = {
  kind: "record",
  fields: {
    opId: { kind: "enum", values: ["POST"] },
    continuation: { kind: "enum", values: ["submit#1"] },
    args: { kind: "record", fields: {} },
  },
} as const;

function read(id: string) {
  return { kind: "read" as const, var: id };
}

export function coffeeShapedPerformanceModel(): Model {
  const customerRoute = "/customer/home";
  const printerStatus = {
    kind: "enum" as const,
    values: ["connected", "disconnected", "error"],
  };
  const printerDataFields = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [`bit${index}`, bool]),
  );
  const orderHistoryFields = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [`order${index}`, bool]),
  );
  const densityValues = [1, 2, 3, 4, 5, 6, 7];
  const routeSiblings = [
    "local:home.autoPrint",
    "local:home.printerSettingsOpen",
    "local:home.orderHistoryOpen",
  ];
  return {
    schemaVersion: 1,
    id: "coffee-near-full-slice",
    bounds: { maxDepth: 4, maxPending: 5, maxInternalSteps: 8 },
    vars: [
      {
        id: "sys:route",
        domain: { kind: "enum", values: [customerRoute, "/other"] },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-current" },
        initial: customerRoute,
      },
      {
        id: "sys:history",
        domain: {
          kind: "boundedList",
          inner: { kind: "enum", values: [customerRoute, "/other"] },
          maxLen: 3,
        },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
      {
        id: "printerStatus",
        domain: printerStatus,
        origin: "system",
        scope: { kind: "global" },
        initial: "disconnected",
      },
      {
        id: "printerStatusData",
        domain: { kind: "record", fields: printerDataFields },
        origin: "system",
        scope: { kind: "global" },
        initial: Object.fromEntries(
          Array.from({ length: 16 }, (_, index) => [`bit${index}`, false]),
        ),
      },
      {
        id: "orderHistoryCursor",
        domain: { kind: "enum", values: ["none", "page1", "page2"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "none",
      },
      {
        id: "orderHistoryDialog",
        domain: { kind: "enum", values: ["idle", "loading", "open"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "idle",
      },
      {
        id: "orderHistoryPayload",
        domain: { kind: "record", fields: orderHistoryFields },
        origin: "system",
        scope: { kind: "global" },
        initial: Object.fromEntries(
          Array.from({ length: 16 }, (_, index) => [`order${index}`, false]),
        ),
      },
      {
        id: "sys:pending",
        domain: { kind: "boundedList", inner: pendingOp, maxLen: 5 },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "pending-queue" },
        initial: [],
      },
      ...routeSiblings.map((id) => ({
        id,
        domain: bool,
        origin: "system" as const,
        scope: routeMountScope(customerRoute),
        initial: false,
      })),
      ...densityValues.map((value) => ({
        id: `optimisticDensity${value}`,
        domain: bool,
        origin: "system" as const,
        scope: routeMountScope(customerRoute),
        initial: false,
      })),
    ],
    transitions: [
      ...densityValues.map((value) => ({
        id: `setDensity${value}`,
        cls: "user" as const,
        label: { kind: "click" as const, text: `Set density ${value}` },
        source: [],
        guard: {
          kind: "and" as const,
          args: [
            {
              kind: "eq" as const,
              args: [read("sys:route"), lit(customerRoute)],
            },
            {
              kind: "eq" as const,
              args: [read("printerStatus"), lit("connected")],
            },
          ],
        },
        effect: {
          kind: "assign" as const,
          var: `optimisticDensity${value}`,
          expr: lit(true),
        },
        reads: [
          "sys:route",
          "printerStatus",
          `optimisticDensity${value}`,
          "printerStatusData",
        ],
        writes: [`optimisticDensity${value}`, "printerStatusData"],
        confidence: "exact" as const,
      })),
      {
        id: "loadMoreOrders",
        cls: "user",
        label: { kind: "click", text: "Load more orders" },
        source: [],
        guard: {
          kind: "and",
          args: [
            { kind: "neq", args: [read("orderHistoryCursor"), lit("none")] },
            { kind: "eq", args: [read("orderHistoryDialog"), lit("idle")] },
          ],
        },
        effect: {
          kind: "enqueue",
          queue: "sys:pending",
          op: "POST",
          continuation: "loadMore#1",
          args: {},
        },
        reads: [
          "orderHistoryCursor",
          "orderHistoryDialog",
          "orderHistoryPayload",
        ],
        writes: ["sys:pending", "orderHistoryPayload"],
        confidence: "exact",
      },
      {
        id: "internal:refreshPrinterData",
        cls: "internal",
        label: { kind: "internal", text: "Refresh printer data" },
        source: [],
        guard: {
          kind: "eq",
          args: [read("printerStatus"), lit("connected")],
        },
        effect: { kind: "havoc", var: "printerStatusData" },
        reads: ["printerStatus"],
        writes: ["printerStatusData"],
        triggeredBy: ["printerStatus"],
        confidence: "exact",
      },
      {
        id: "internal:refreshOrderHistory",
        cls: "internal",
        label: { kind: "internal", text: "Refresh order history" },
        source: [],
        guard: {
          kind: "neq",
          args: [read("orderHistoryCursor"), lit("none")],
        },
        effect: { kind: "havoc", var: "orderHistoryPayload" },
        reads: ["orderHistoryCursor"],
        writes: ["orderHistoryPayload"],
        triggeredBy: ["orderHistoryCursor"],
        confidence: "exact",
      },
      ...routeSiblings.map((id) => ({
        id: `toggle:${id}`,
        cls: "user" as const,
        label: { kind: "click" as const, text: `Toggle ${id}` },
        source: [],
        guard: lit(true),
        effect: { kind: "assign" as const, var: id, expr: lit(true) },
        reads: [id],
        writes: [id],
        confidence: "exact" as const,
      })),
    ],
  };
}

export function coffeeShapedPerformanceProperties(
  model: Model,
): readonly Property[] {
  return [
    always(
      model,
      orExpr(
        neq(readVar("printerStatus"), lit("connected")),
        enabled(model, "setDensity1"),
      ),
      {
        name: COFFEE_SHAPED_DENSITY_ONE_PROPERTY,
        reads: ["printerStatus"],
      },
    ),
    always(
      model,
      orExpr(
        eq(readVar("printerStatus"), lit("connected")),
        notExpr(enabled(model, "setDensity7")),
      ),
      {
        name: COFFEE_SHAPED_DENSITY_SEVEN_PROPERTY,
        reads: ["printerStatus"],
      },
    ),
    always(model, enabled(model, "loadMoreOrders"), {
      name: COFFEE_SHAPED_LOAD_MORE_PROPERTY,
      reads: ["orderHistoryCursor", "orderHistoryDialog"],
    }),
  ];
}
