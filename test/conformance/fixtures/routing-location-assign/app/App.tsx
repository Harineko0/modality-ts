import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <button type="button" onClick={() => navigate("/settings")}>
        Settings
      </button>
      <button type="button" onClick={() => setCount(count + 1)}>
        Count {count}
      </button>
    </main>
  );
}
