import * as React from 'react';
// import { stateful, transaction, cache, config, Renew, SeparateFrom,
//   Transaction, ReactiveCache, Dbg, Trace} from 'reactronic';
import { stateful, transaction, cache, behavior, cacheof,
  Renew, SeparateFrom, Transaction, Cache, Trace} from '../src/z.index';

export function reactiveRender(render: (revision: number) => JSX.Element, trace?: Partial<Trace>, tran?: Transaction): JSX.Element {
  const restore = Cache.trace;
  if (trace)
    Cache.setTrace(trace);
  try {
    const [jsx] = React.useState(() => createJsx(trace));
    const [revision, refresh] = React.useState(0);
    React.useEffect(unmountEffect(jsx), []);
    return jsx.render(revision, render, refresh, tran);
  }
  finally {
    if (trace)
      Cache.setTrace(restore);
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
    if (cacheof(this.jsx).isInvalid)
      refresh(nextRevision);
  }
}

function createJsx(trace?: Partial<Trace>): Jsx {
  const dbg = Cache.trace.transactions && (trace === undefined || trace.transactions !== false);
  const hint = dbg ? getComponentName() : undefined;
  return Transaction.runAs<Jsx>(hint ? `${hint}` : 'new-jsx', SeparateFrom.Reaction, trace, () => {
    let jsx = new Jsx();
    if (hint)
      Cache.setTraceHint(jsx, hint);
    if (trace) {
      cacheof(jsx.render).configure({trace});
      cacheof(jsx.jsx).configure({trace});
      cacheof(jsx.trigger).configure({trace});
    }
    return jsx;
  });
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

function getComponentName(): string | undefined {
  const error = new Error();
  const stack = error.stack || "";
  const lines = stack.split("\n");
  const i = lines.findIndex(x => x.indexOf(".reactiveRender") >= 0) || 6;
  let result: string = lines[i + 1] || "";
  result = (result.match(/^\s*at\s*(\S+)/) || [])[1];
  return `<${result}>`;
}
