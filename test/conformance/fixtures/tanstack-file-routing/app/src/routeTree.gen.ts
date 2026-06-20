import { Route as rootRouteImport } from "./routes/__root";
import { Route as indexRouteImport } from "./routes/index";
import { Route as postsRouteImport } from "./routes/posts";
import { Route as postsPostIdRouteImport } from "./routes/posts.$postId";

const rootRoute = rootRouteImport.update({
  id: "__root",
} as never);

const indexRoute = indexRouteImport.update({
  id: "/",
  path: "/",
  getParentRoute: () => rootRoute,
} as never);

const postsRoute = postsRouteImport.update({
  id: "/posts",
  path: "/posts",
  getParentRoute: () => rootRoute,
} as never);

const postsPostIdRoute = postsPostIdRouteImport.update({
  id: "/posts/$postId",
  path: "/posts/$postId",
  getParentRoute: () => postsRoute,
} as never);

export const routeTree = rootRoute._addFileChildren({
  IndexRoute: indexRoute,
  PostsRoute: postsRoute,
  PostsPostIdRoute: postsPostIdRoute,
});
