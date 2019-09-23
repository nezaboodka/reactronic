// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, stateless, trigger, cached, statusof, offstage, Transaction, Status, Trace } from 'reactronic';

export function reactiveRender(render: (counter: number) => JSX.Element, trace?: Partial<Trace>): JSX.Element {
  const [req, refresh] = React.useState(trace ? () => Rx.create(trace) : Rx.create);
  const rx = req.rx;
  rx.counter = req.counter;
  rx.refresh = refresh; // just in case React will change refresh on each rendering
  React.useEffect(Rx.unmountEffect(rx), []);
  return rx.jsx(render);
}

type RenderRequest = {
  rx: Rx;
  counter: number;
};

@stateful
class Rx {
  @stateless counter: number = 0;
  @stateless refresh?: (next: RenderRequest) => void;

  @cached
  jsx(render: (counter: number) => JSX.Element): JSX.Element {
    return render(this.counter);
  }

  @trigger
  keepfresh(): void {
    if (statusof(this.jsx) && this.refresh)
      offstage(this.refresh, {rx: this, counter: this.counter + 1});
  }

  static create(trace?: Partial<Trace>): RenderRequest {
    const dbg = Status.isTraceOn && Status.trace.hints
      ? trace === undefined || trace.hints !== false
      : trace !== undefined && trace.hints === true;
    const hint = dbg ? getComponentName() : "<rx>";
    return Transaction.runAs<RenderRequest>(hint, false,
      trace, undefined, Rx.doCreate, hint, trace);
  }

  private static doCreate(hint: string | undefined, trace: Trace | undefined): RenderRequest {
    const rx = new Rx();
    if (hint)
      Status.setTraceHint(rx, hint);
    if (trace) {
      statusof(rx.jsx).configure({trace});
      statusof(rx.keepfresh).configure({trace});
    }
    return {rx, counter: 0};
  }

  static unmountEffect(rx: Rx): React.EffectCallback {
    return () => {
      // did mount
      return () => {
        // will unmount
        Status.unmount(rx);
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
