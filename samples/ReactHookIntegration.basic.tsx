// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import * as React from 'react';
import { stateful, stateless, trigger, cached, statusof, offstage, Transaction, Status } from 'reactronic';

type ReactState = { rx: Rx; };

export function reactiveRender(render: () => JSX.Element): JSX.Element {
  const [state, refresh] = React.useState<ReactState>(Rx.create);
  const rx = state.rx;
  rx.refresh = refresh; // just in case React will change refresh on each rendering
  React.useEffect(Rx.unmountEffect(rx), []);
  return rx.jsx(render);
}

@stateful
class Rx {
  @stateless refresh?: (next: ReactState) => void = undefined;

  @cached
  jsx(render: () => JSX.Element): JSX.Element {
    return render();
  }

  @trigger
  keepfresh(): void {
    if (statusof(this.jsx).isInvalid && this.refresh)
      offstage(this.refresh, {rx: this});
  }

  static create(): ReactState {
    return Transaction.runAs<ReactState>("<rx>", false, undefined, undefined, Rx.doCreate);
  }

  private static doCreate(): ReactState {
    return {rx: new Rx()};
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
