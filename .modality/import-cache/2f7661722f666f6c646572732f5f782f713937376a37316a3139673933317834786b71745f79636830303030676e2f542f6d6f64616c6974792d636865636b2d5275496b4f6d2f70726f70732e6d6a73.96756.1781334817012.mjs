export const properties = [
        { kind: "reachableFrom", name: "flagCannotReturnFalse", when: state => state.flag === true, goal: state => state.flag === false, reads: ["flag"] }
      ];