// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import * as React from 'react';
import { stateful, transaction, reactive, cached, statusof,
  SeparatedFrom, Transaction, Status, Trace} from 'reactronic';

export function reactiveRender(render: (revision: number) => JSX.Element, trace?: Partial<Trace>, tran?: Transaction): JSX.Element {
  const restore = trace ? Status.pushTrace(trace) : Status.trace;
  try {
    const [rejsx] = React.useState(() => createRejsx(trace));
    const [revision, refresh] = React.useState(0);
    React.useEffect(Rejsx.unmountEffect(rejsx), []);
    return rejsx.render(revision, render, refresh, tran);
  }
  finally {
    Status.trace = restore;
  }
}

@stateful
class Rejsx {
  @transaction
  render(revision: number, doRender: (revision: number) => JSX.Element, refresh: (nextRevision: number) => void, tran: Transaction | undefined): JSX.Element {
    const jsx: JSX.Element = this.jsx(revision, doRender, tran);
    this.refresh(revision + 1, refresh);
    return jsx;
  }

  @cached
  jsx(revision: number, render: (revision: number) => JSX.Element, tran: Transaction | undefined): JSX.Element {
    return !tran ? render(revision) : tran.inspect(render, revision);
  }

  @reactive
  refresh(nextRevision: number, refresh: (nextRevision: number) => void): void {
    if (statusof(this.jsx).isInvalid)
      refresh(nextRevision);
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
  const dbg = Status.trace.hints
    ? trace === undefined || trace.hints !== false
    : trace !== undefined && trace.hints === true;
  const hint = dbg ? getComponentName() : "createRejsx";
  return Transaction.runAs(hint, SeparatedFrom.Reaction, trace,
    runCreateRejsx, hint, trace);
}

function runCreateRejsx(hint: string | undefined, trace: Trace | undefined): Rejsx {
  const rejsx = new Rejsx();
  if (hint)
    Status.setTraceHint(rejsx, hint);
  if (trace) {
    statusof(rejsx.render).configure({trace});
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
