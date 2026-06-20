import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/posts/$postId")({
  component: PostDetailPage,
});

function PostDetailPage() {
  return <p>Post detail</p>;
}
