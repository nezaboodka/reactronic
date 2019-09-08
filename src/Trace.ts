
export interface Trace {
  readonly silent: boolean;
  readonly hints: boolean;
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly monitors: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly invalidations: boolean;
  readonly gc: boolean;
}
