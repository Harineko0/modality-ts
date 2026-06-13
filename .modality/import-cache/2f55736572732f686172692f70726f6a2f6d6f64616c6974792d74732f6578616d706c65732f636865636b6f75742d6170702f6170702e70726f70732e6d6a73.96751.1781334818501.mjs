export function properties() {
  return [
    {
      kind: "always",
      name: "guestCannotReachSuccess",
      reads: ["local:App.auth", "local:App.step"],
      predicate: (state) => !(state["local:App.auth"] === "guest" && state["local:App.step"] === "success")
    },
    {
      kind: "alwaysStep",
      name: "orderSuccessMatchesUser",
      reads: ["local:App.auth", "local:App.userId", "local:App.step", "sys:pending"],
      predicate: (_pre, step, post) =>
        !(step.resolved("api.submitOrder", "success") && post["local:App.step"] === "success") ||
        (post["local:App.auth"] === "user" && step.op?.args.userId === post["local:App.userId"])
    },
    {
      kind: "alwaysStep",
      name: "orderSuccessMatchesCart",
      reads: ["local:App.auth", "local:App.plan", "local:App.step", "sys:pending"],
      predicate: (_pre, step, post) =>
        !(step.resolved("api.submitOrder", "success") && post["local:App.step"] === "success" && post["local:App.auth"] === "user") ||
        step.op?.args.plan === post["local:App.plan"]
    },
    {
      kind: "alwaysStep",
      name: "staleFailureDoesNotMutateGuestStatus",
      reads: ["local:App.auth", "local:App.submitStatus", "sys:pending"],
      predicate: (pre, step, post) =>
        !(step.resolved("api.submitOrder", "error") && pre["local:App.auth"] === "guest") ||
        post["local:App.submitStatus"] === pre["local:App.submitStatus"]
    },
    {
      kind: "alwaysStep",
      name: "invalidQuoteCannotEnterBilling",
      reads: ["local:App.quoteStatus", "local:App.step"],
      predicate: (pre, _step, post) =>
        !(pre["local:App.quoteStatus"] === "invalid" && post["local:App.step"] === "billing")
    },
    {
      kind: "reachableFrom",
      name: "reviewCanReachSuccess",
      reads: ["local:App.auth", "local:App.step", "local:App.submitStatus"],
      when: (state) =>
        state["local:App.auth"] === "user" &&
        state["local:App.step"] === "review" &&
        state["local:App.submitStatus"] === "idle",
      goal: (state) => state["local:App.step"] === "success"
    }
  ];
}
