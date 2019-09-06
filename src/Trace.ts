
export interface Trace {
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly outdating: boolean;
  readonly gc: boolean;
  readonly silent: boolean;
}
