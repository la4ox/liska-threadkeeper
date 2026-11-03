export type ProviderBlockWorkProvider = 'claude' | 'deepseek';
export type ProviderContentLimitKind = 'bytes' | 'occurrences' | 'blocks' | 'work';

export interface ProviderBlockWorkCounters {
  occurrences: number;
  blocks: number;
  workUnits: number;
}

export const PROVIDER_CONTENT_MAX_BYTES = 32 * 1024 * 1024;
export const PROVIDER_CONTENT_MAX_OCCURRENCES = 250_000;
export const PROVIDER_CONTENT_MAX_BLOCKS = 250_000;
/** One shared ceiling for capture plus up to two destination rebuilds; no phase gets a reset. */
export const PROVIDER_CONTENT_MAX_WORK_UNITS = 2_000_000;

const MAXIMUMS: Readonly<Record<ProviderContentLimitKind, number>> = {
  bytes: PROVIDER_CONTENT_MAX_BYTES,
  occurrences: PROVIDER_CONTENT_MAX_OCCURRENCES,
  blocks: PROVIDER_CONTENT_MAX_BLOCKS,
  work: PROVIDER_CONTENT_MAX_WORK_UNITS,
};

/** Stable fail-closed outcome shared by provider preflight, inventory, and normalization. */
export class ProviderContentLimitError extends Error {
  readonly code = 'provider-content-limit-exceeded';
  readonly counters: Readonly<ProviderBlockWorkCounters>;

  constructor(
    readonly provider: ProviderBlockWorkProvider,
    readonly limit: ProviderContentLimitKind,
    readonly maximum: number,
    readonly observed: number,
    counters: ProviderBlockWorkCounters
  ) {
    super(
      `${provider === 'claude' ? 'Claude' : 'DeepSeek'} provider content exceeded its aggregate ${limit} limit (${observed} > ${maximum}).`
    );
    this.name = 'ProviderContentLimitError';
    this.counters = Object.freeze({ ...counters });
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Mutable operation scope. A caller may pass one scope through repeated raw traversals. */
export class ProviderBlockWorkBudget {
  readonly counters: ProviderBlockWorkCounters = { occurrences: 0, blocks: 0, workUnits: 0 };

  constructor(readonly provider: ProviderBlockWorkProvider) {}

  beginTraversal(): ProviderBlockTraversalBudget {
    return new ProviderBlockTraversalBudget(this);
  }

  spendWork(units = 1): void {
    this.assertIncrement('work', units);
    this.counters.workUnits += units;
    this.assertWithin('work', this.counters.workUnits);
  }

  private assertIncrement(limit: ProviderContentLimitKind, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ProviderContentLimitError(
        this.provider,
        limit,
        MAXIMUMS[limit],
        Number.POSITIVE_INFINITY,
        this.counters
      );
    }
  }

  private assertWithin(limit: ProviderContentLimitKind, observed: number): void {
    const maximum = MAXIMUMS[limit];
    if (observed > maximum) {
      throw new ProviderContentLimitError(this.provider, limit, maximum, observed, this.counters);
    }
  }
}

/** Per-public-traversal input/output ceilings backed by one operation-wide work counter. */
export class ProviderBlockTraversalBudget {
  readonly counters: ProviderBlockWorkCounters;

  constructor(readonly operation: ProviderBlockWorkBudget) {
    this.counters = { occurrences: 0, blocks: 0, workUnits: operation.counters.workUnits };
  }

  get provider(): ProviderBlockWorkProvider {
    return this.operation.provider;
  }

  admitOccurrences(count = 1): void {
    this.assertIncrement('occurrences', count);
    this.counters.occurrences += count;
    this.assertWithin('occurrences', this.counters.occurrences);
  }

  recordBlocks(count = 1): void {
    this.assertIncrement('blocks', count);
    this.counters.blocks += count;
    this.assertWithin('blocks', this.counters.blocks);
  }

  spendWork(units = 1): void {
    try {
      this.operation.spendWork(units);
      this.counters.workUnits = this.operation.counters.workUnits;
    } catch (error) {
      if (error instanceof ProviderContentLimitError && error.limit === 'work') {
        throw new ProviderContentLimitError(
          this.provider,
          'work',
          error.maximum,
          error.observed,
          this.snapshot()
        );
      }
      throw error;
    }
  }

  private assertIncrement(limit: ProviderContentLimitKind, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ProviderContentLimitError(
        this.provider,
        limit,
        MAXIMUMS[limit],
        Number.POSITIVE_INFINITY,
        this.snapshot()
      );
    }
  }

  private assertWithin(limit: ProviderContentLimitKind, observed: number): void {
    const maximum = MAXIMUMS[limit];
    if (observed > maximum) {
      throw new ProviderContentLimitError(this.provider, limit, maximum, observed, this.snapshot());
    }
  }

  private snapshot(): ProviderBlockWorkCounters {
    return { ...this.counters, workUnits: this.operation.counters.workUnits };
  }
}

export function providerBlockWorkBudget(
  provider: ProviderBlockWorkProvider,
  budget?: ProviderBlockWorkBudget
): ProviderBlockWorkBudget {
  if (budget === undefined) return new ProviderBlockWorkBudget(provider);
  if (budget.provider !== provider) {
    throw new TypeError(`Expected a ${provider} provider content budget.`);
  }
  return budget;
}

/** Per-artifact byte guard; unlike traversal counters this is deliberately not cumulative. */
export function assertProviderContentBytes(
  provider: ProviderBlockWorkProvider,
  bytes: Uint8Array,
  budget?: ProviderBlockWorkBudget
): ProviderBlockWorkBudget {
  const scope = providerBlockWorkBudget(provider, budget);
  if (bytes.byteLength > PROVIDER_CONTENT_MAX_BYTES) {
    throw new ProviderContentLimitError(
      provider,
      'bytes',
      PROVIDER_CONTENT_MAX_BYTES,
      bytes.byteLength,
      scope.counters
    );
  }
  return scope;
}

export function rethrowProviderContentLimit(error: unknown): void {
  if (error instanceof ProviderContentLimitError) throw error;
}
