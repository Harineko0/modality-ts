/**
 * Author-facing branded numeric aliases for finite integer domains.
 *
 * Extraction resolves these to `boundedInt` domains with the corresponding
 * overflow policy. `Short` is signed 16-bit (`-32768..32767`).
 */
export type Bounded<Min extends number, Max extends number> = number & {
  readonly __modalityBounded: { min: Min; max: Max };
};

export type Wrapping<Min extends number, Max extends number> = number & {
  readonly __modalityWrapping: { min: Min; max: Max };
};

/** Unsigned 8-bit integer (`0..255`), wrapping overflow. */
export type Uint8 = Wrapping<0, 255>;

/** Alias for {@link Uint8}. */
export type Byte = Uint8;

/** Unsigned 16-bit integer (`0..65535`), wrapping overflow. */
export type Uint16 = Wrapping<0, 65535>;

/** Signed 16-bit integer (`-32768..32767`), wrapping overflow. */
export type Short = Wrapping<-32768, 32767>;
