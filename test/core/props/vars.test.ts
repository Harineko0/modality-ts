import { describe, expect, it } from "vitest";
import { history, pending, route } from "modality-ts/vars";

describe("built-in system var handles", () => {
  it("exports real handles for stable system variables", () => {
    expect(pending.varId).toBe("sys:pending");
    expect(route.varId).toBe("sys:route");
    expect(history.varId).toBe("sys:history");
    expect(pending.at("0", "opId")).toMatchObject({
      varId: "sys:pending",
      path: ["0", "opId"],
    });
  });
});
