// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

export interface Trace {
  readonly silent: boolean;
  readonly hints: boolean;
  readonly transactions: boolean;
  readonly methods: boolean;
  readonly steps: boolean;
  readonly monitors: boolean;
  readonly reads: boolean;
  readonly writes: boolean;
  readonly changes: boolean;
  readonly subscriptions: boolean;
  readonly invalidations: boolean;
  readonly gc: boolean;
  readonly color: number;
  readonly prefix: string;
  readonly margin: number;
}
