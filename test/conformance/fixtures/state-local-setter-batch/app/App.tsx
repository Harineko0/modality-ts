import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <button
        type="button"
        onClick={() => {
          setCount(count + 1);
          setCount(count + 1);
        }}
      >
        Direct batch {count}
      </button>
      <button
        type="button"
        onClick={() => {
          setCount((current) => current + 1);
          setCount((current) => current + 1);
        }}
      >
        Functional batch {count}
      </button>
    </main>
  );
}
