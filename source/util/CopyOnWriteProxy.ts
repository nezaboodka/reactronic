// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Utils } from '../util/Utils'
import { misuse } from '../util/Dbg'
import { R_COPY_ON_WRITE } from './CopyOnWrite'
import { CopyOnWriteArray, CopyOnWrite } from '../util/CopyOnWriteArray'
import { CopyOnWriteSet } from '../util/CopyOnWriteSet'
import { CopyOnWriteMap } from '../util/CopyOnWriteMap'
import { Member, Handle, Observable } from '../impl/Data'

export class CopyOnWriteProxy implements ProxyHandler<CopyOnWrite<any>> {
  static readonly global: CopyOnWriteProxy = new CopyOnWriteProxy()

  getPrototypeOf(binding: CopyOnWrite<any>): object | null {
    return Object.getPrototypeOf(binding.payload)
  }

  get(binding: CopyOnWrite<any>, m: Member, receiver: any): any {
    const a: any = binding.readable(receiver, m === 'raw' || m === R_COPY_ON_WRITE)
    return a[m]
  }

  set(binding: CopyOnWrite<any>, m: Member, value: any, receiver: any): boolean {
    const a: any = binding.writable(receiver)
    return a[m] = value
  }

  static seal(observable: Observable | symbol, proxy: any, m: Member): void {
    if (observable instanceof Observable) {
      const v = observable.value
      if (Array.isArray(v) || v instanceof Array) {
        if (v instanceof CopyOnWriteArray && !Array.isArray(v)) {
          throw misuse(`${Handle.getHint(proxy, false)}.${m.toString()} collection cannot be reused from another property without cloning`)
        }
        else if (!Object.isFrozen(v)) {
          if (observable.isField)
            observable.value = new Proxy(CopyOnWriteArray.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Object.freeze(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Set) {
        /*if (v instanceof CopyOnWriteSet) {
          throw misuse(`${Hints.getHint(proxy)}.${m.toString()} collection cannot be reused from another property without cloning`)
        }
        else*/ if (!Object.isFrozen(v)) {
          if (observable.isField)
            observable.value = new Proxy(CopyOnWriteSet.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Utils.freezeSet(v) // just freeze without copy-on-write hooks
        }
      }
      else if (v instanceof Map) {
        /*if (v instanceof CopyOnWriteMap) {
          throw misuse(`${Hints.getHint(proxy)}.${m.toString()} collection cannot be reused from another property without cloning`)
        }
        else*/ if (!Object.isFrozen(v)) {
          if (observable.isField)
            observable.value = new Proxy(CopyOnWriteMap.seal(proxy, m, v), CopyOnWriteProxy.global)
          else
            Utils.freezeMap(v) // just freeze without copy-on-write hooks
        }
      }
    }
  }
}
