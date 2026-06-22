import type { HandlerWrapperProvider } from "../../engine/spi/index.js";
import { unwrapReactHookFormHandler } from "./unwrap.js";

export function reactHookFormSource(): HandlerWrapperProvider {
  return {
    id: "react-hook-form",
    version: "0.1.0",
    packageNames: ["react-hook-form"],
    kind: "handler-wrapper",
    unwrapHandler: unwrapReactHookFormHandler,
  };
}

export default reactHookFormSource;
