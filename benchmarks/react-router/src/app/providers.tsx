import { Provider as JotaiProvider } from "jotai";
import { RouterProvider } from "react-router-dom";
import { SWRConfig } from "swr";
import { router } from "./router.js";

const fetcher = async (key: string | readonly unknown[]) => {
  if (Array.isArray(key)) {
    return { bucket: key[0], value: "some" };
  }
  return { bucket: key, value: "some" };
};

export function AppProviders() {
  return (
    <JotaiProvider>
      <SWRConfig
        value={{ fetcher, dedupingInterval: 0, provider: () => new Map() }}
      >
        <RouterProvider router={router} />
      </SWRConfig>
    </JotaiProvider>
  );
}
