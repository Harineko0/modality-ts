import "modality-ts/extract/wiring/install.js";
import "modality-ts/extract/frameworks/react";
import { registerEffectModelProviders } from "modality-ts/extract/engine/spi";
import { timerEffectModelProvider } from "modality-ts/extract/effect-models/timers";
import { websocketEffectModelProvider } from "modality-ts/extract/effect-models/websocket";

registerEffectModelProviders([
  timerEffectModelProvider(),
  websocketEffectModelProvider(),
]);
