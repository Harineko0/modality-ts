export const properties = [
        { kind: "always", name: "flagStartsFalseOnly", predicate: state => state.flag === false, reads: ["flag"] }
      ];