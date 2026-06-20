import { describe, expect, it } from "vitest";
import { s } from "modality-ts/core";

function App() {
  return null;
}

describe("s() accessor", () => {
  it("returns handles for component fields", () => {
    expect(s(App).phase).toMatchObject({
      __modalityVar: true,
      varId: "local:App.phase",
    });
  });

  it("extends handles with nested path segments via at()", () => {
    expect(s(App).session.at("user", "id").path).toEqual(["user", "id"]);
  });

  it("supports destructuring", () => {
    const { phase, count } = s(App);
    expect(phase.varId).toBe("local:App.phase");
    expect(count.varId).toBe("local:App.count");
  });

  it("honors idOverride", () => {
    expect(s(App, "CustomerHome").phase.varId).toBe("local:CustomerHome.phase");
  });

  it("accepts a component-like name object", () => {
    expect(s({ name: "App" }).phase.varId).toBe("local:App.phase");
  });
});
