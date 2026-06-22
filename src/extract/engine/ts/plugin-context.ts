import type { SemanticTypeContext } from "../../lang/ts/semantic-type-context.js";
import type {
  ChannelCtx,
  DiscoverCtx,
  ExtractCtx,
  TypeCtx,
} from "../spi/index.js";

export type DiscoverCtxWithTypes = DiscoverCtx & {
  types?: SemanticTypeContext;
};

export type TypeCtxWithTypes = TypeCtx & { types?: SemanticTypeContext };

export type ChannelCtxWithTypes = ChannelCtx & { types?: SemanticTypeContext };

export type ExtractCtxWithTypes = ExtractCtx & { types?: SemanticTypeContext };
