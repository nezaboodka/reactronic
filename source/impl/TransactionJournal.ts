// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { ObservableObject } from './Hooks'
import { ObjectHolder, ObjectRevision, Meta, Patch, ObjectPatch, Observable } from './Data'
import { NIL, Snapshot } from './Snapshot'
import { Transaction } from './Transaction'
import { Sealant } from '../util/Sealant'

export abstract class TransactionJournal extends ObservableObject {
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
    Transaction.runAs({ hint: 'TransactionJournal.remember', spawn: true }, () => {
      const items = this._items = this._items.toMutable()
      if (items.length >= this._capacity)
        items.shift()
      else
        items.splice(this._position)
      items.push(p)
      this._position = items.length
    })
  }

  undo(count: number = 1): void {
    Transaction.runAs({ hint: 'TransactionJournal.undo', spawn: true }, () => {
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
    Transaction.runAs({ hint: 'TransactionJournal.redo', spawn: true }, () => {
      let i: number = this._position
      while (i < this._items.length && count > 0) {
        const patch = this._items[i]
        TransactionJournalImpl.applyPatch(patch, false)
        i++, count--
      }
      this._position = i
    })
  }

  static createPatch(hint: string, changeset: Map<ObjectHolder, ObjectRevision>): Patch {
    const patch: Patch = { hint, objects: new Map<object, ObjectPatch>() }
    changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
      const p: ObjectPatch = { changes: {}, old: {} }
      const old = r.prev.revision !== NIL ? r.prev.revision.data : undefined
      r.changes.forEach(m => {
        p.changes[m] = unseal(r.data[m])
        if (old)
          p.old[m] = unseal(old[m])
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
    const ctx = Snapshot.writable()
    patch.objects.forEach((p: ObjectPatch, obj: object) => {
      const h = Meta.get<ObjectHolder>(obj, Meta.Holder)
      const data = undo ? p.old : p.changes
      if (data[Meta.Disposed] !== Meta.Disposed) {
        for (const m in data) {
          const value = data[m]
          const r: ObjectRevision = ctx.findWritableRevision(h, m, value)
          if (r.snapshot === ctx) {
            r.data[m] = new Observable(value)
            const v: any = r.prev.revision.data[m]
            Snapshot.markChanged(value, v !== value, r, m)
          }
        }
      }
      else
        Snapshot.doDispose(ctx, h)
    })
  }
}

function unseal(observable: Observable): any {
  const result = observable.value
  const clone = result?.[Sealant.Clone] as () => any
  return clone ? clone.call(result) : result
}
