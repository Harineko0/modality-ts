export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false },
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true }
      ];