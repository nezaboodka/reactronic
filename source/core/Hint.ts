// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import { Utils } from '../util/all'
import {Record, FieldKey, Handle, R_HANDLE } from './Data'

// Hint

export class Hint {
  static setHint<T>(obj: T, hint: string | undefined): T {
    if (hint) {
      const h = Utils.get<Handle>(obj, R_HANDLE)
      if (h)
        h.hint = hint
    }
    return obj
  }

  static getHint(obj: object): string | undefined {
    const h = Utils.get<Handle>(obj, R_HANDLE)
    return h ? h.hint : undefined
  }

  static handle(h: Handle | undefined, field?: FieldKey | undefined, stamp?: number, tran?: number, typeless?: boolean): string {
    const obj = h === undefined
      ? "blank"
      : (typeless
        ? (stamp === undefined ? `#${h.id}` : `v${stamp}t${tran}#${h.id}`)
        : (stamp === undefined ? `#${h.id} ${h.hint}` : `v${stamp}t${tran}#${h.id} ${h.hint}`))
    return field !== undefined ? `${obj}.${field.toString()}` : obj
  }

  static record(r: Record, field?: FieldKey, typeless?: boolean): string {
    const h = Utils.get<Handle | undefined>(r.data, R_HANDLE)
    return Hint.handle(h, field, r.creator.timestamp, r.creator.id, typeless)
  }

  static conflicts(conflicts: Record[]): string {
    return conflicts.map(ours => {
      const items: string[] = []
      ours.conflicts.forEach((theirs: Record, field: FieldKey) => {
        items.push(Hint.conflictingFieldHint(field, ours, theirs))
      })
      return items.join(", ")
    }).join(", ")
  }

  static conflictingFieldHint(field: FieldKey, ours: Record, theirs: Record): string {
    return Hint.record(theirs, field)
  }
}
