export function properties() {
  return [
    {
      kind: "always",
      name: "naiveNoDoubleSubmitInvariant",
      reads: ["sys:pending"],
      predicate: (state) => state["sys:pending"].filter((op) => op.opId === "api.createTodo").length <= 1
    },
    {
      kind: "alwaysStep",
      name: "guestCannotSubmit",
      reads: ["atom:authAtom", "sys:pending"],
      predicate: (pre, step) => !(step.enqueued("api.createTodo") && pre["atom:authAtom"] === "guest")
    },
    {
      kind: "alwaysStep",
      name: "emptyDraftCannotSubmit",
      reads: ["local:App.draft", "sys:pending"],
      predicate: (pre, step) => !(step.enqueued("api.createTodo") && pre["local:App.draft"] === "empty")
    },
    {
      kind: "alwaysStep",
      name: "staleCompletionIsInert",
      reads: ["local:App.saveStatus", "local:App.draft", "sys:pending"],
      predicate: (pre, step, post) =>
        !(step.resolved("api.createTodo", "success") && pre["local:App.saveStatus"] !== "posting") ||
        post["local:App.draft"] === pre["local:App.draft"]
    }
  ];
}
