import * as React from 'react';
// import { stateful, transaction, cache, config, Renew, SeparateFrom,
//   Transaction, ReactiveCache, Trace} from 'reactronic';
import { stateful, transaction, cache, behavior, Renew, SeparateFrom,
  Transaction, ReactiveCache, Trace} from '../src/z.index';

export function reactiveRender(render: (revision: number) => JSX.Element, tracing: number = 0, tran?: Transaction): JSX.Element {
  const [jsx] = React.useState(() => tran ? tran.view(createJsx, tracing) : createJsx(tracing));
  const [revision, refresh] = React.useState(0);
  React.useEffect(unmountEffect(jsx), []);
  return tran ? tran.view(() => jsx.render(revision, render, refresh)) : jsx.render(revision, render, refresh);
}

@stateful
class Jsx {
  @transaction
  render(revision: number, doRender: (revision: number) => JSX.Element, refresh: (nextRevision: number) => void): JSX.Element {
    const jsx: JSX.Element = this.jsx(revision, doRender);
    this.trigger(revision + 1, refresh);
    return jsx;
  }

  @cache
  jsx(revision: number, render: (revision: number) => JSX.Element): JSX.Element {
    return render(revision);
  }

  @cache @behavior(Renew.Immediately)
  trigger(nextRevision: number, refresh: (nextRevision: number) => void): void {
    if (this.jsx.rcache.isInvalidated)
      refresh(nextRevision);
  }
}

function createJsx(tracing: number): Jsx {
  const dbg = tracing !== 0 || Trace.level >= 2;
  const hint = dbg ? getComponentName() : undefined;
  return Transaction.runAs<Jsx>(dbg ? `${hint}` : "new-jsx", SeparateFrom.Reaction, 0, () => {
    let jsx = new Jsx();
    if (dbg) {
      ReactiveCache.setTraceHint(jsx, hint);
      jsx.render.rcache.configure({tracing});
      jsx.jsx.rcache.configure({tracing});
      jsx.trigger.rcache.configure({tracing});
    }
    return jsx;
  });
}

function unmountEffect(jsx: Jsx): React.EffectCallback {
  return () => {
    // did mount
    return () => {
      // will unmount
      ReactiveCache.unmount(jsx);
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
