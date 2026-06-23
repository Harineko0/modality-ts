/**
 * Opaque language-semantic context passed from language frontends to plugins.
 * Core extraction code treats this as an abstract port; concrete frontends
 * provide richer structural fields for plugins that understand that language.
 */
// biome-ignore lint/suspicious/noExplicitAny: language plugins refine this opaque port structurally.
export type SemanticTypeContext = Record<string, any>;
