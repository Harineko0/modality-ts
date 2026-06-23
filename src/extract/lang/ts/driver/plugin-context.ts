import type { SemanticTypeContext } from "../semantic-type-context.js";
import type {
  ChannelCtx,
  DiscoverCtx,
  ExtractCtx,
  TypeCtx,
} from "../../../engine/spi/index.js";

export type DiscoverCtxWithTypes = DiscoverCtx & {
  types?: SemanticTypeContext;
};

export type TypeCtxWithTypes = TypeCtx & { types?: SemanticTypeContext };

export type ChannelCtxWithTypes = ChannelCtx & { types?: SemanticTypeContext };

export type ExtractCtxWithTypes = ExtractCtx & { types?: SemanticTypeContext };
