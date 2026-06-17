import { useState } from "react";

export function Home() {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount(count + 1)}>
      Home {count}
    </button>
  );
}
