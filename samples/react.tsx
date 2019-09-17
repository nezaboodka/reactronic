// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import * as React from 'react';
import { stateful, trigger, cached, statusof,
  Start, Transaction, Status, Trace } from 'reactronic';

export function reactiveRender(render: (ordinal: number) => JSX.Element, trace?: Partial<Trace>, tran?: Transaction): JSX.Element {
  const [ordinal, refresh] = React.useState(0);
  const [rejsx] = React.useState(() => createRejsx(trace));
  React.useEffect(Rejsx.unmountEffect(rejsx), []);
  const jsx: JSX.Element = rejsx.jsx(ordinal, render, tran);
  rejsx.refresh(ordinal + 1, refresh);
  return jsx;
}

@stateful
class Rejsx {
  @cached
  jsx(ordinal: number, render: (ordinal: number) => JSX.Element, tran: Transaction | undefined): JSX.Element {
    return !tran ? render(ordinal) : tran.inspect(render, ordinal);
  }

  @trigger
  refresh(next: number, refresh: (next: number) => void): void {
    if (statusof(this.jsx).isInvalid)
      refresh(next);
  }

  static unmountEffect(rejsx: Rejsx): React.EffectCallback {
    return () => {
      // did mount
      return () => {
        // will unmount
        Status.unmount(rejsx);
      };
    };
  }
}

function createRejsx(trace?: Partial<Trace>): Rejsx {
  const dbg = Status.isTraceOn && Status.trace.hints
    ? trace === undefined || trace.hints !== false
    : trace !== undefined && trace.hints === true;
  const hint = dbg ? getComponentName() : "createRejsx";
  return Transaction.runAs(hint, Start.InsideParentTransaction, trace, undefined,
    doCreateRejsx, hint, trace);
}

function doCreateRejsx(hint: string | undefined, trace: Trace | undefined): Rejsx {
  const rejsx = new Rejsx();
  if (hint)
    Status.setTraceHint(rejsx, hint);
  if (trace) {
    statusof(rejsx.jsx).configure({trace});
    statusof(rejsx.refresh).configure({trace});
  }
  return rejsx;
}

function getComponentName(): string {
  const error = new Error();
  const stack = error.stack || "";
  const lines = stack.split("\n");
  const i = lines.findIndex(x => x.indexOf(".reactiveRender") >= 0) || 6;
  let result: string = lines[i + 1] || "";
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1];
  return `<${result}>`;
}
