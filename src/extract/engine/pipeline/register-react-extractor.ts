import {
  extractReactSourceTransitions,
  type ReactSourceTransitionOptions,
} from "../ts/react-source-transitions.js";
import { registerSourceExtractor } from "./source-extraction.js";

registerSourceExtractor("react", (sourceText, options) =>
  extractReactSourceTransitions(
    sourceText,
    options as ReactSourceTransitionOptions,
  ),
);
