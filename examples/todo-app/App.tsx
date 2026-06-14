import { useState } from "react";
import { atom, useSetAtom } from "jotai";
import useSWR from "swr";

export const authAtom = atom<"guest" | "user">("guest");
type TodosData = "empty" | "some";

export function App() {
  const setAuth = useSetAtom(authAtom);
  const [draft, setDraft] = useState<"empty" | "nonEmpty">("empty");
  const [saveStatus, setSaveStatus] = useState<"idle" | "posting" | "failed">(
    "idle",
  );
  const { data } = useSWR<TodosData>("/api/todos", api.fetchTodos);

  return (
    <main>
      <button type="button" onClick={() => setAuth("user")}>
        Login
      </button>
      <button
        type="button"
        onClick={() => {
          setAuth("guest");
          setDraft("empty");
          setSaveStatus("idle");
        }}
      >
        Logout
      </button>
      <label>
        New todo
        <input
          data-testid="draft"
          onChange={(event) => setDraft(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={saveStatus === "posting"}
        onClick={async () => {
          setSaveStatus("posting");
          await api.createTodo();
          setDraft("empty");
          setSaveStatus("idle");
        }}
      >
        Add
      </button>
      <output>{draft}</output>
      <output>{saveStatus}</output>
      <output>{data}</output>
    </main>
  );
}
