import { useQuery } from "@tanstack/react-query";

export function App() {
  const todos = useQuery({
    queryKey: ["todos"],
    queryFn: async () => ["a"],
  });

  return <span data-testid="todos">{String(todos.data)}</span>;
}
