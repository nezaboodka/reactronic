// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, trigger, cached, statusof,
  Start, Transaction, Status, Trace } from 'reactronic';

export function reactiveRender(render: (counter: number) => JSX.Element, trace?: Partial<Trace>, tran?: Transaction): JSX.Element {
  const [counter, refresh] = React.useState(0);
  const [rejsx] = React.useState(() => createRejsx(trace));
  React.useEffect(Rejsx.unmountEffect(rejsx), []);
  const jsx: JSX.Element = rejsx.jsx(counter, render, tran);
  rejsx.autorefresh(counter + 1, refresh);
  return jsx;
}

@stateful
class Rejsx {
  @cached
  jsx(counter: number, render: (counter: number) => JSX.Element, tran: Transaction | undefined): JSX.Element {
    return !tran ? render(counter) : tran.inspect(render, counter);
  }

  @trigger
  autorefresh(next: number, refresh: (next: number) => void): void {
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
    statusof(rejsx.autorefresh).configure({trace});
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
