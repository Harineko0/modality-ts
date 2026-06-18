import { useState } from "react";

export function Panel() {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" onClick={() => setOpen(true)}>
      Panel {String(open)}
    </button>
  );
}
