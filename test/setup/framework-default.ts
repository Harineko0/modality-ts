import { extendFrameworkWithTsUnwrap } from "../../src/extract/engine/ts/framework-ts-bridge.js";
import { registerFrameworkPlugin } from "modality-ts/extract/engine/spi";
import "modality-ts/extract/engine/pipeline";
import { timerEffectPlugin } from "modality-ts/extract/plugins/effect/timers";
import { websocketEffectPlugin } from "modality-ts/extract/plugins/effect/websocket";
import { registerEffectPlugins } from "modality-ts/extract/engine/spi";
import { reactFramework } from "modality-ts/extract/plugins/framework/react";
import { unwrapReactHookFormHandler } from "modality-ts/extract/plugins/framework/react-hook-form/unwrap";

const framework = extendFrameworkWithTsUnwrap(
  reactFramework(),
  unwrapReactHookFormHandler,
);
registerFrameworkPlugin(framework);

registerEffectPlugins([timerEffectPlugin(), websocketEffectPlugin()]);
