import { describe, expect, it } from "vitest";
import type { Transition } from "modality-ts/core";
import {
  assignTransitionHandleNames,
  transitionHandleName,
} from "./transition-handles.js";

function transition(
  overrides: Partial<Transition> & Pick<Transition, "id" | "label">,
): Transition {
  return {
    cls: "user",
    source: [{ file: "App.tsx", line: 1 }],
    guard: { kind: "true" },
    effect: { kind: "assign", target: "local:App.flag", value: true },
    reads: [],
    writes: [],
    confidence: "exact",
    ...overrides,
  };
}

describe("transitionHandleName", () => {
  it("derives names from testId locators", () => {
    const name = transitionHandleName(
      transition({
        id: "App.onClick.flag.seq",
        label: {
          kind: "click",
          locator: { kind: "testId", value: "load-more" },
        },
        writes: ["local:App.flag"],
      }),
    );
    expect(name).toBe("app_loadMore");
  });

  it("derives names from role locators with names", () => {
    const name = transitionHandleName(
      transition({
        id: "Dialog.onClick.open.seq",
        label: {
          kind: "click",
          locator: { kind: "role", role: "button", name: "Save order" },
        },
        writes: ["local:Dialog.open"],
      }),
    );
    expect(name).toBe("dialog_saveOrder");
  });

  it("falls back to the role when a role locator has no name", () => {
    const name = transitionHandleName(
      transition({
        id: "App.onClick.flag.seq",
        label: {
          kind: "click",
          locator: { kind: "role", role: "button" },
        },
        writes: ["local:App.flag"],
      }),
    );
    expect(name).toBe("app_button");
  });

  it("derives names from click text when no semantic locator token applies", () => {
    const name = transitionHandleName(
      transition({
        id: "App.onClick.flag.seq",
        label: { kind: "click", text: "Load more" },
        writes: ["local:App.flag"],
      }),
    );
    expect(name).toBe("app_loadMore");
  });

  it("falls back to write-set field names", () => {
    const name = transitionHandleName(
      transition({
        id: "App.onClick.flag.seq",
        label: { kind: "internal", text: "stabilize" },
        writes: ["local:App.isFree_phase"],
      }),
    );
    expect(name).toBe("app_isFree_phase");
  });

  it("falls back to positional locators via the write set", () => {
    const name = transitionHandleName(
      transition({
        id: "App.onClick.flag.seq",
        label: {
          kind: "click",
          locator: {
            kind: "positional",
            base: { kind: "role", role: "button" },
            index: 0,
          },
        },
        writes: ["local:App.count", "local:App.done"],
      }),
    );
    expect(name).toBe("app_count_done");
  });

  it("uses the event kind when no locator, text, or writes are available", () => {
    const name = transitionHandleName(
      transition({
        id: "App.timer.flag.seq",
        label: { kind: "timer", key: "poll" },
        writes: [],
      }),
    );
    expect(name).toBe("app_timer");
  });
});

describe("assignTransitionHandleNames", () => {
  it("suffixes later duplicates with _2, _3, … deterministically", () => {
    const base = transition({
      id: "App.onClick.flag.seq",
      label: { kind: "click", text: "Go" },
      writes: ["local:App.flag"],
    });
    const second = transition({
      id: "App.onClick.flag.seq.abc",
      label: { kind: "click", text: "Go" },
      writes: ["local:App.flag"],
    });
    const third = transition({
      id: "App.onClick.flag.seq.def",
      label: { kind: "click", text: "Go" },
      writes: ["local:App.flag"],
    });

    expect(
      assignTransitionHandleNames([base, second, third]).map((e) => e.name),
    ).toEqual(["app_go", "app_go_2", "app_go_3"]);
  });
});
