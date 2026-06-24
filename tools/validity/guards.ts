export interface ConformanceSignalCounts {
  total: number;
  reproduced: number;
  notReproduced: number;
}

export interface MutationSignalCounts {
  mutantsTotal: number;
  killed: number;
  preserved: number;
}

export interface MetamorphicSignalCounts {
  variantsTotal: number;
  stable: number;
  divergent: number;
}

export function hasNoConformanceSignal(
  counts: ConformanceSignalCounts,
): boolean {
  return counts.total > 0 && counts.reproduced + counts.notReproduced === 0;
}

// Error and survived mutants are not oracle signal: neither outcome proves the
// mutant was killed nor that behavior was intentionally preserved.
export function hasNoMutationSignal(counts: MutationSignalCounts): boolean {
  return (
    counts.mutantsTotal > 0 && counts.killed === 0 && counts.preserved === 0
  );
}

export function hasNoMetamorphicSignal(
  counts: MetamorphicSignalCounts,
): boolean {
  return counts.variantsTotal > 0 && counts.stable + counts.divergent === 0;
}
