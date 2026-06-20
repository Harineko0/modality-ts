import { describe, expect, it } from "vitest";
import type { Transition } from "modality-ts/core";
import { buildTransitionTree } from "./transition-handles.js";

function transition(
  overrides: Partial<Transition> & Pick<Transition, "id">,
): Transition {
  return {
    cls: "user",
    label: { kind: "click", text: "Go" },
    source: [{ file: "App.tsx", line: 1 }],
    guard: { kind: "true" },
    effect: { kind: "assign", target: "local:App.flag", value: true },
    reads: [],
    writes: [],
    confidence: "exact",
    ...overrides,
  };
}

describe("buildTransitionTree", () => {
  it("groups transitions by component and event with period-split remainder paths", () => {
    const tree = buildTransitionTree([
      transition({ id: "CustomerHome.onClick.isHistoryOpen" }),
      transition({ id: "CustomerHome.onClick.isPrinterSettingsOpen" }),
      transition({ id: "App.onClick.handleAdvance" }),
    ]);

    expect(tree).toEqual([
      {
        component: "App",
        events: [
          {
            event: "onClick",
            leaves: [
              {
                path: ["handleAdvance"],
                transitionId: "App.onClick.handleAdvance",
              },
            ],
          },
        ],
      },
      {
        component: "CustomerHome",
        events: [
          {
            event: "onClick",
            leaves: [
              {
                path: ["isHistoryOpen"],
                transitionId: "CustomerHome.onClick.isHistoryOpen",
              },
              {
                path: ["isPrinterSettingsOpen"],
                transitionId: "CustomerHome.onClick.isPrinterSettingsOpen",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("splits dotted remainders into path segments and preserves non-period tokens", () => {
    const tree = buildTransitionTree([
      transition({ id: "CustomerHome.onClick.注文を確認する" }),
      transition({
        id: "CustomerHome.onSubmit.ACTION /order.start",
      }),
      transition({
        id: "CustomerHome.useEffect.actionData_isAutoPrintEnabled",
      }),
    ]);

    const customerHome = tree.find(
      (entry) => entry.component === "CustomerHome",
    );
    expect(customerHome?.events).toEqual([
      {
        event: "onClick",
        leaves: [
          {
            path: ["注文を確認する"],
            transitionId: "CustomerHome.onClick.注文を確認する",
          },
        ],
      },
      {
        event: "onSubmit",
        leaves: [
          {
            path: ["ACTION /order", "start"],
            transitionId: "CustomerHome.onSubmit.ACTION /order.start",
          },
        ],
      },
      {
        event: "useEffect",
        leaves: [
          {
            path: ["actionData_isAutoPrintEnabled"],
            transitionId:
              "CustomerHome.useEffect.actionData_isAutoPrintEnabled",
          },
        ],
      },
    ]);
  });

  it("uses _ for missing event and remainder segments", () => {
    const tree = buildTransitionTree([
      transition({ id: "swr:api_user:fetch" }),
      transition({ id: "App.onClick" }),
    ]);

    expect(tree).toEqual([
      {
        component: "App",
        events: [
          {
            event: "onClick",
            leaves: [{ path: ["_"], transitionId: "App.onClick" }],
          },
        ],
      },
      {
        component: "swr:api_user:fetch",
        events: [
          {
            event: "_",
            leaves: [{ path: ["_"], transitionId: "swr:api_user:fetch" }],
          },
        ],
      },
    ]);
  });

  it("sorts components, events, and leaves deterministically", () => {
    const tree = buildTransitionTree([
      transition({ id: "Zeta.onClick.b" }),
      transition({ id: "Alpha.onSubmit.z" }),
      transition({ id: "Alpha.onClick.a" }),
      transition({ id: "Alpha.onClick.b" }),
    ]);

    expect(tree.map((entry) => entry.component)).toEqual(["Alpha", "Zeta"]);
    expect(tree[0]?.events.map((entry) => entry.event)).toEqual([
      "onClick",
      "onSubmit",
    ]);
    expect(tree[0]?.events[0]?.leaves.map((leaf) => leaf.path[0])).toEqual([
      "a",
      "b",
    ]);
  });
});
