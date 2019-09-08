import * as React from 'react';
// import { stateful, transaction, cache, config, Renew, SeparateFrom,
//   Transaction, ReactiveCache, Dbg, Trace} from 'reactronic';
import { stateful, transaction, cache, behavior, cacheof,
  Renew, SeparateFrom, Transaction, Cache, Trace} from '../src/z.index';

let renderings: number = 0;

export function reactiveRender(render: (revision: number) => JSX.Element, trace?: Partial<Trace>, tran?: Transaction): JSX.Element {
  const restore = trace ? Cache.pushTrace(trace) : Cache.trace;
  try {
    renderings++;
    const [jsx] = React.useState(() => createJsx(trace));
    const [revision, refresh] = React.useState(0);
    React.useEffect(unmountEffect(jsx), []);
    return jsx.render(revision, render, refresh, tran);
  }
  finally {
    renderings--;
    Cache.trace = restore;
  }
}

@stateful
class Jsx {
  @transaction
  render(revision: number, doRender: (revision: number) => JSX.Element, refresh: (nextRevision: number) => void, tran: Transaction | undefined): JSX.Element {
    const jsx: JSX.Element = this.jsx(revision, doRender, tran);
    this.trigger(revision + 1, refresh);
    return jsx;
  }

  @cache
  jsx(revision: number, render: (revision: number) => JSX.Element, tran: Transaction | undefined): JSX.Element {
    return !tran ? render(revision) : tran.inspect(render, revision);
  }

  @cache @behavior(Renew.Immediately)
  trigger(nextRevision: number, refresh: (nextRevision: number) => void): void {
    if (cacheof(this.jsx).isInvalid) {
      if (renderings < 1)
        refresh(nextRevision);
      else
        setTimeout(refresh, 0, nextRevision);
    }
  }
}

function createJsx(trace?: Partial<Trace>): Jsx {
  const dbg = Cache.trace.hints
    ? trace === undefined || trace.hints !== false
    : trace !== undefined && trace.hints === true;
  const hint = dbg ? getComponentName() : "Jsx.ctor";
  return Transaction.runAs<Jsx>(hint, SeparateFrom.Reaction, trace,
    runCreateJsx, hint, trace);
}

function runCreateJsx(hint: string | undefined, trace: Trace | undefined): Jsx {
  const jsx = new Jsx();
  if (hint)
    Cache.setTraceHint(jsx, hint);
  if (trace) {
    cacheof(jsx.render).configure({trace});
    cacheof(jsx.jsx).configure({trace});
    cacheof(jsx.trigger).configure({trace});
  }
  return jsx;
}

function unmountEffect(jsx: Jsx): React.EffectCallback {
  return () => {
    // did mount
    return () => {
      // will unmount
      Cache.unmount(jsx);
    };
  };
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
