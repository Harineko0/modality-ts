import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

export const Route = createFileRoute("/posts")({
  component: PostsPage,
});

export function PostsPage() {
  const [count, setCount] = useState(0);
  const navigate = useNavigate({ from: "/posts" });
  return (
    <main>
      <Link to="/posts">All posts</Link>
      <button
        type="button"
        onClick={() =>
          navigate({ to: "/posts/$postId", params: { postId: "1" } })
        }
      >
        Open post
      </button>
      <button type="button" onClick={() => setCount(count + 1)}>
        Count {count}
      </button>
    </main>
  );
}
