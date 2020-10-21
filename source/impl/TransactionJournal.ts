// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Stateful } from './Hooks'
import { Handle, Record, Meta, Patch, ObjectPatch, Observable } from './Data'
import { NIL, Snapshot } from './Snapshot'
import { Transaction } from './Transaction'
import { Sealant } from '../util/Sealant'

export abstract class TransactionJournal extends Stateful {
  abstract capacity: number
  abstract readonly items: ReadonlyArray<Patch>
  abstract readonly canUndo: boolean
  abstract readonly canRedo: boolean

  abstract undo(count?: number): void
  abstract redo(count?: number): void
  abstract remember(patch: Patch): void

  static create(): TransactionJournal { return new TransactionJournalImpl() }
}

export class TransactionJournalImpl extends TransactionJournal {
  private _capacity: number = 5
  private _items: Patch[] = []
  private _position: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._items.length) this._items.splice(0, this._items.length - value) }
  get items(): ReadonlyArray<Patch> { return this._items }
  get canUndo(): boolean { return this._items.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._items.length }

  remember(p: Patch): void {
    Transaction.runAs({ hint: 'UndoRedeLog.remember', spawn: true }, () => {
      if (this._items.length >= this._capacity)
        this._items.mutable.shift()
      else
        this._items.mutable.splice(this._position)
      this._items.mutable.push(p)
      this._position = this._items.length
    })
  }

  undo(count: number = 1): void {
    Transaction.runAs({ hint: 'UndoRedeLog.undo', spawn: true }, () => {
      let i: number = this._position - 1
      while (i >= 0 && count > 0) {
        const patch = this._items[i]
        TransactionJournalImpl.applyPatch(patch, true)
        i--, count--
      }
      this._position = i + 1
    })
  }

  redo(count: number = 1): void {
    Transaction.runAs({ hint: 'UndoRedeLog.redo', spawn: true }, () => {
      let i: number = this._position
      while (i < this._items.length && count > 0) {
        const patch = this._items[i]
        TransactionJournalImpl.applyPatch(patch, false)
        i++, count--
      }
      this._position = i
    })
  }

  static createPatch(hint: string, changeset: Map<Handle, Record>): Patch {
    const patch: Patch = { hint, objects: new Map<object, ObjectPatch>() }
    changeset.forEach((r: Record, h: Handle) => {
      const p: ObjectPatch = { changes: {}, old: {} }
      const old = r.prev.record !== NIL ? r.prev.record.data : undefined
      r.changes.forEach(m => {
        p.changes[m] = unpack(r.data[m])
        if (old)
          p.old[m] = unpack(old[m])
      })
      if (!old) {
        p.changes[Meta.Disposed] = undefined // object restore
        p.old[Meta.Disposed] = Meta.Disposed // object dispose
      }
      patch.objects.set(h.proxy, p)
    })
    return patch
  }

  static applyPatch(patch: Patch, undo: boolean): void {
    const ctx = Snapshot.writer()
    patch.objects.forEach((p: ObjectPatch, obj: object) => {
      const h = Meta.get<Handle>(obj, Meta.Handle)
      const data = undo ? p.old : p.changes
      if (data[Meta.Disposed] !== Meta.Disposed) {
        for (const m in data) {
          const value = data[m]
          const r: Record = ctx.writable(h, m, value)
          if (r.snapshot === ctx) {
            r.data[m] = new Observable(value)
            const v: any = r.prev.record.data[m]
            Snapshot.markChanged(r, m, value, v !== value)
          }
        }
      }
      else
        Snapshot.doDispose(ctx, h)
    })
  }
}

function unpack(observable: Observable): any {
  let result = observable.value
  const unseal = result?.[Sealant.Unseal] as () => any
  if (unseal)
    result = unseal.call(result)
  return result
}
