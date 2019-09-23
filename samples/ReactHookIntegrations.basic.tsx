// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, stateless, trigger, cached, statusof, offstage, Transaction, Status } from 'reactronic';

export function reactiveRender(render: () => JSX.Element): JSX.Element {
  const [req, refresh] = React.useState(Rx.create);
  const rx = req.rx;
  React.useEffect(Rx.unmountEffect(rx), []);
  rx.refresh = refresh; // just in case React will change refresh on each rendering
  return rx.jsx(render);
}

type RenderRequest = {
  rx: Rx;
};

@stateful
class Rx {
  @stateless refresh?: (next: RenderRequest) => void = undefined;

  @cached
  jsx(render: () => JSX.Element): JSX.Element {
    return render();
  }

  @trigger
  keepfresh(): void {
    if (statusof(this.jsx) && this.refresh)
      offstage(this.refresh, {rx: this});
  }

  static create(): RenderRequest {
    const hint = "<rx>";
    return Transaction.runAs<RenderRequest>(hint, false,
      undefined, undefined, Rx.doCreate);
  }

  private static doCreate(): RenderRequest {
    const rx = new Rx();
    return {rx};
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
