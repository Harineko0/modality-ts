import "modality-ts/extract/frameworks/react";
import "modality-ts/extract/engine/pipeline";
import { timerEffectPlugin } from "modality-ts/extract/effect-models/timers";
import { websocketEffectPlugin } from "modality-ts/extract/effect-models/websocket";
import { registerEffectPlugins } from "modality-ts/extract/engine/spi";

registerEffectPlugins([timerEffectPlugin(), websocketEffectPlugin()]);
