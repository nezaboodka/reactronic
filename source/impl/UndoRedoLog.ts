// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Stateful } from './Hooks'
import { Transaction } from './Transaction'
import { Patch } from './Data'

export class UndoRedoLog extends Stateful {
  private _capacity: number = 5
  private _items: Patch[] = []
  private _position: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._items.length) this._items.splice(0, this._items.length - value) }
  get items(): ReadonlyArray<Patch> { return this._items }
  get canUndo(): boolean { return this._items.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._items.length }

  remember(p: Patch): void {
    Transaction.runAs({ hint: 'UndoRedeLog.remember', spawn: true },
      UndoRedoLog.remember, this, p)
  }

  private static remember(log: UndoRedoLog, p: Patch): void {
    if (log._items.length >= log._capacity)
      log._items.shift()
    else
      log._items.splice(log._position)
    log._items.push(p)
  }

  undo(count: number = 1): void {
    let i: number = this._position - 1
    Transaction.runAs({ hint: 'UndoRedeLog.undo' }, () => {
      while (i >= 0 && count > 0) {
        // NOT IMPLEMENTED
        // const item: UndoRedoItem = this._items[i]
        // item.revert()
        i--
        count--
      }
    })
    this._position = i + 1
  }

  redo(count: number = 1): void {
    let i: number = this._position
    Transaction.runAs({ hint: 'UndoRedeLog.redo' }, () => {
      while (i < this._items.length && count > 0) {
        // NOT IMPLEMENTED
        // const t: Transaction = this._items[i]
        // this._items[i] = t.revert()
        i++
        count--
      }
    })
    this._position = i
  }
}
