import {
  extractReactSourceTransitions,
  type ReactSourceTransitionOptions,
} from "./react-source-transitions.js";
import { registerSourceExtractor } from "../../../engine/pipeline/source-extraction.js";

registerSourceExtractor("react", (sourceText, options) =>
  extractReactSourceTransitions(
    sourceText,
    options as ReactSourceTransitionOptions,
  ),
);
