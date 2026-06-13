export function properties() {
  return [
    {
      kind: "always",
      name: "noDoubleSubmit",
      reads: ["sys:pending"],
      predicate: (state) => state["sys:pending"].filter((op) => op.opId === "api.placeOrder").length <= 1
    },
    {
      kind: "always",
      name: "guestCannotReachAdmin",
      reads: ["sys:route", "atom:authAtom"],
      predicate: (state) => !(state["sys:route"] === "/admin" && state["atom:authAtom"] === "guest")
    },
    {
      kind: "always",
      name: "guestDoesNotSeeUserCache",
      reads: ["atom:authAtom", "swr:api_user:data"],
      predicate: (state) => !(state["atom:authAtom"] === "guest" && state["swr:api_user:data"] !== null)
    }
  ];
}
