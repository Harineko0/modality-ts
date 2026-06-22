import { registerSourceExtractor } from "../../engine/pipeline/source-extraction.js";
import {
  extractReactSourceTransitions,
  type ReactSourceTransitionOptions,
} from "../../engine/ts/react-source-transitions.js";

registerSourceExtractor("react", (sourceText, options) =>
  extractReactSourceTransitions(
    sourceText,
    options as ReactSourceTransitionOptions,
  ),
);
