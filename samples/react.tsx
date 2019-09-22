// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, trigger, cached, statusof, offside, Transaction, Status, Trace } from 'reactronic';

export function reactiveRender(render: (counter: number) => JSX.Element, trace?: Partial<Trace>, tran?: Transaction): JSX.Element {
  const [counter, refresh] = React.useState(0);
  const [rejsx] = React.useState(() => Rejsx.create(trace));
  React.useEffect(Rejsx.unmountEffect(rejsx), []);
  const jsx: JSX.Element = rejsx.jsx({counter, render, refresh, tran});
  return jsx;
}

type JsxArgs = {
  counter: number;
  render: (counter: number) => JSX.Element;
  refresh: (counter: number) => void
  tran?: Transaction;
};

@stateful
class Rejsx {
  @cached
  jsx(args: JsxArgs): JSX.Element {
    return !args.tran ? args.render(args.counter) : args.tran.inspect(args.render, args.counter);
  }

  @trigger
  keepfresh(): void {
    const s = statusof(this.jsx);
    const args: JsxArgs | undefined = s.args ? s.args[0] : undefined;
    if (args && s.isInvalid)
      offside(args.refresh, args.counter + 1);
  }

  static create(trace?: Partial<Trace>): Rejsx {
    const dbg = Status.isTraceOn && Status.trace.hints
      ? trace === undefined || trace.hints !== false
      : trace !== undefined && trace.hints === true;
    const hint = dbg ? getComponentName() : "<rejsx>";
    return Transaction.runAs(hint, false, trace, undefined,
     Rejsx.doCreate, hint, trace);
  }

  private static doCreate(hint: string | undefined, trace: Trace | undefined): Rejsx {
    const rejsx = new Rejsx();
    if (hint)
      Status.setTraceHint(rejsx, hint);
    if (trace) {
      statusof(rejsx.jsx).configure({trace});
      statusof(rejsx.keepfresh).configure({trace});
    }
    return rejsx;
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

function getComponentName(): string {
  const error = new Error();
  const stack = error.stack || "";
  const lines = stack.split("\n");
  const i = lines.findIndex(x => x.indexOf(".reactiveRender") >= 0) || 6;
  let result: string = lines[i + 1] || "";
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1];
  return `<${result}>`;
}
