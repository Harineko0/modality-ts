exports.setDone = (state) => ({ ...state, done: true });

exports.writeUndeclared = (state) => ({ ...state, auth: true });

exports.invalidDone = (state) => ({ ...state, done: "yes" });

let flip = false;
exports.nondeterministicDone = (state) => {
  flip = !flip;
  return { ...state, done: flip };
};
