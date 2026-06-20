import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  useNavigate,
} from "@tanstack/react-router";

function Root() {
  return <div>Root</div>;
}

function Home() {
  const navigate = useNavigate();
  return (
    <main>
      <Link to="/about">About</Link>
      <button
        type="button"
        onClick={() =>
          navigate({ to: "/items/$itemId", params: { itemId: "7" } })
        }
      >
        Go item
      </button>
    </main>
  );
}

function About() {
  return <p>About</p>;
}

function ItemDetail() {
  return <p>Item</p>;
}

const rootRoute = createRootRoute({ component: Root });
const pathlessLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_pathless",
  component: Root,
});
const indexRoute = createRoute({
  getParentRoute: () => pathlessLayoutRoute,
  path: "/",
  component: Home,
});
const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "about",
  component: About,
});
const itemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "items/$itemId",
  component: ItemDetail,
});

export const routeTree = rootRoute.addChildren([
  pathlessLayoutRoute.addChildren([indexRoute]),
  aboutRoute,
  itemRoute,
]);
export const router = createRouter({ routeTree });
