// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Stateful } from './Hooks'
import { CopyOnWriteArray } from '../util/CopyOnWriteArray'
import { CopyOnWriteSet } from '../util/CopyOnWriteSet'
import { CopyOnWriteMap } from '../util/CopyOnWriteMap'
import { Handle, Record, Meta, DataPatch, ObjectDataPatch, Observable } from './Data'
import { NIL, Snapshot } from './Snapshot'
import { Transaction } from './Transaction'

export abstract class UndoRedoLog extends Stateful {
  abstract capacity: number
  abstract readonly items: ReadonlyArray<DataPatch>
  abstract readonly canUndo: boolean
  abstract readonly canRedo: boolean

  abstract undo(count?: number): void
  abstract redo(count?: number): void
  abstract remember(patch: DataPatch): void

  static create(): UndoRedoLog { return new UndoRedoLogImpl() }
}

export class UndoRedoLogImpl extends UndoRedoLog {
  private _capacity: number = 5
  private _items: DataPatch[] = []
  private _position: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._items.length) this._items.splice(0, this._items.length - value) }
  get items(): ReadonlyArray<DataPatch> { return this._items }
  get canUndo(): boolean { return this._items.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._items.length }

  remember(p: DataPatch): void {
    Transaction.runAs({ hint: 'UndoRedeLog.remember', spawn: true }, () => {
      if (this._items.length >= this._capacity)
        this._items.shift()
      else
        this._items.splice(this._position)
      this._items.push(p)
    })
  }

  undo(count: number = 1): void {
    Transaction.runAs({ hint: 'UndoRedeLog.undo' }, () => {
      let i: number = this._position - 1
      while (i >= 0 && count > 0) {
        const patch = this._items[i]
        UndoRedoLogImpl.applyDataPatch(patch, true)
        i--, count--
      }
      this._position = i + 1
    })
  }

  redo(count: number = 1): void {
    Transaction.runAs({ hint: 'UndoRedeLog.redo' }, () => {
      let i: number = this._position
      while (i < this._items.length && count > 0) {
        const patch = this._items[i]
        UndoRedoLogImpl.applyDataPatch(patch, false)
        i++, count--
      }
      this._position = i
    })
  }

  static createDataPatch(changeset: Map<Handle, Record>): DataPatch {
    const patch: DataPatch = { objects: new Map<Handle, ObjectDataPatch>() }
    changeset.forEach((r: Record, h: Handle) => {
      const p: ObjectDataPatch = { undoData: {}, redoData: {} }
      const old = r.prev.record !== NIL ? r.prev.record.data : undefined
      r.changes.forEach(m => {
        if (old)
          p.undoData[m] = unpack(old[m])
        p.redoData[m] = unpack(r.data[m])
      })
      if (!old) {
        p.undoData[Meta.Unmount] = Meta.Unmount
        p.redoData[Meta.Unmount] = undefined
      }
      patch.objects.set(h, p)
    })
    return patch
  }

  static applyDataPatch(patch: DataPatch, undo: boolean): void {
    const ctx = Snapshot.writer()
    patch.objects.forEach((p: ObjectDataPatch, h: Handle) => {
      const data = undo ? p.undoData : p.redoData
      if (data[Meta.Unmount] !== Meta.Unmount) {
        for (const m in data) {
          const value = data[m]
          const t: Record = ctx.writable(h, m, value)
          if (t.snapshot === ctx) {
            t.data[m] = new Observable(value)
            const v: any = t.prev.record.data[m]
            Snapshot.markChanged(t, m, value, v !== value)
          }
        }
      }
      else
        Snapshot.doUnmount(ctx, h)
    })
  }
}

function unpack(observable: Observable): any {
  let result = observable.value
  // TODO: Support Array, Set, Map (all CopyOnWrite collections)
  if (result instanceof CopyOnWriteArray)
    result = new Array(...result.raw())
  else if (result instanceof CopyOnWriteSet)
    result = new Set(Set.prototype.values.call(result.raw()))
  else if (result instanceof CopyOnWriteMap) {
    const raw = result.raw()
    result = new Map(Map.prototype.entries.call(raw))
  }
  return result
}
