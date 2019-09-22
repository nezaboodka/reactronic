// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, stateless, trigger, cached, statusof, resultof, offside, Transaction, Status, Trace } from 'reactronic';

export function reactiveRender(render: (counter: number) => JSX.Element, trace?: Partial<Trace>): JSX.Element {
  const [req, refresh] = React.useState(() => Rejsx.create(trace));
  req.rejsx.counter = req.counter;
  req.rejsx.refresh = refresh; // just in case React will change refresh on each rendering
  React.useEffect(Rejsx.unmountEffect(req.rejsx), []);
  return req.rejsx.jsx(render);
}

type RenderRequest = {
  rejsx: Rejsx;
  counter: number;
};

@stateful
class Rejsx {
  @stateless counter: number = 0;
  @stateless refresh: (next: RenderRequest) => void = undef;

  @cached
  jsx(render: (counter: number) => JSX.Element): JSX.Element {
    return render(this.counter);
  }

  @trigger
  keepfresh(): void {
    const status = statusof(this.jsx);
    if (status.isInvalid && this.refresh !== undef)
      offside(this.refresh, {rejsx: this, counter: this.counter + 1});
  }

  static create(trace?: Partial<Trace>): RenderRequest {
    const dbg = Status.isTraceOn && Status.trace.hints
      ? trace === undefined || trace.hints !== false
      : trace !== undefined && trace.hints === true;
    const hint = dbg ? getComponentName() : "<rejsx>";
    return Transaction.runAs<RenderRequest>(hint, false,
      trace, undefined, Rejsx.doCreate, hint, trace);
  }

  private static doCreate(hint: string | undefined, trace: Trace | undefined): RenderRequest {
    const rejsx = new Rejsx();
    if (hint)
      Status.setTraceHint(rejsx, hint);
    if (trace) {
      statusof(rejsx.jsx).configure({trace});
      statusof(rejsx.keepfresh).configure({trace});
    }
    return {rejsx, counter: 0};
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

function undef(next: RenderRequest): void {
  throw new Error("refresh callback is undefined");
}
