// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, trigger, cached, statusof, offside, Transaction, Status, Trace } from 'reactronic';

export function reactiveRender(render: (counter: number) => JSX.Element, trace?: Partial<Trace>): JSX.Element {
  const [args, refresh] = React.useState(() => Rejsx.create(trace));
  args.refresh = refresh; // just in case React will change refresh on each rendering
  React.useEffect(Rejsx.unmountEffect(args.rejsx), []);
  return args.rejsx.jsx(args, render);
}

type RenderArgs = {
  rejsx: Rejsx;
  counter: number;
  refresh: (next: RenderArgs) => void;
};

@stateful
class Rejsx {
  @cached
  jsx(args: RenderArgs, render: (counter: number) => JSX.Element): JSX.Element {
    return render(args.counter);
  }

  @trigger
  keepfresh(): void {
    const s = statusof(this.jsx);
    const args: RenderArgs | undefined = s.args ? s.args[0] : undefined;
    if (args && s.isInvalid)
      offside(args.refresh, {rejsx: this, counter: args.counter + 1, refresh: undef});
  }

  static create(trace?: Partial<Trace>): RenderArgs {
    const dbg = Status.isTraceOn && Status.trace.hints
      ? trace === undefined || trace.hints !== false
      : trace !== undefined && trace.hints === true;
    const hint = dbg ? getComponentName() : "<rejsx>";
    return Transaction.runAs<RenderArgs>(hint, false,
      trace, undefined, Rejsx.doCreate, hint, trace);
  }

  private static doCreate(hint: string | undefined, trace: Trace | undefined): RenderArgs {
    const rejsx = new Rejsx();
    if (hint)
      Status.setTraceHint(rejsx, hint);
    if (trace) {
      statusof(rejsx.jsx).configure({trace});
      statusof(rejsx.keepfresh).configure({trace});
    }
    return {rejsx, counter: 0, refresh: undef};
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

function undef(next: RenderArgs): void {
  throw new Error("refresh callback is undefined");
}
