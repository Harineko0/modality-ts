import type { Value } from "modality-ts/core";

export interface EnvironmentEventConfig {
  webSockets?: readonly WebSocketEnvironmentConfig[];
}

export interface WebSocketEnvironmentConfig {
  id?: string;
  url?: string;
  messages?: readonly WebSocketMessageVariant[];
}

export interface WebSocketMessageVariant {
  type: string;
  bind?: Record<string, Value>;
}
