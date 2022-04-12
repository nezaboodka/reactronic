// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { ObservableObject } from './Hooks'
import { ObjectHolder, ObjectRevision, Meta, Patch, ObjectPatch, Observable } from './Data'
import { Snapshot, ROOT_REV } from './Snapshot'
import { Transaction } from './Transaction'
import { Sealant } from '../util/Sealant'

export abstract class TransactionJournal extends ObservableObject {
  abstract capacity: number
  abstract readonly isSaving: boolean
  abstract readonly edits: ReadonlyArray<Patch>
  abstract readonly canUndo: boolean
  abstract readonly canRedo: boolean

  abstract undo(count?: number): void
  abstract redo(count?: number): void
  abstract getUnsaved(): Patch | undefined
  abstract beginSave(): void
  abstract endSave(success: boolean): void

  abstract register(patch: Patch): void

  static create(): TransactionJournal { return new TransactionJournalImpl() }
}

export class TransactionJournalImpl extends TransactionJournal {
  private _capacity: number = 5
  private _isSaving: boolean = false
  private _edits: Patch[] = []
  private _position: number = 0
  private _saved: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._edits.length) this._edits.splice(0, this._edits.length - value) }
  get isSaving(): boolean { return this._isSaving }
  get edits(): ReadonlyArray<Patch> { return this._edits }
  get canUndo(): boolean { return this._edits.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._edits.length }

  undo(count: number = 1): void {
    Transaction.run({ hint: 'TransactionJournal.undo', standalone: 'isolated' }, () => {
      let i: number = this._position - 1
      while (i >= 0 && count > 0) {
        const patch = this._edits[i]
        TransactionJournalImpl.applyPatch(patch, true)
        i--, count--
      }
      this._position = i + 1
    })
  }

  redo(count: number = 1): void {
    Transaction.run({ hint: 'TransactionJournal.redo', standalone: 'isolated' }, () => {
      let i: number = this._position
      while (i < this._edits.length && count > 0) {
        const patch = this._edits[i]
        TransactionJournalImpl.applyPatch(patch, false)
        i++, count--
      }
      this._position = i
    })
  }

  getUnsaved(): Patch | undefined {
    let result: Patch | undefined = undefined
    const direction = Math.sign(this._position - this._saved)
    const length = Math.abs(this._position - this._saved)
    if (length !== 0) {
      result = { hint: 'unsaved changes', objects: new Map<object, ObjectPatch>() }
      let i = 0
      while (i < length) {
        const patch = this._edits[this._position + direction * (i + 1)]
        patch.objects.forEach((p, obj) => {
          // WIP:
          // let objPatch = result!.objects.get(obj)
          // if (!objPatch)
          //   result!.objects.set(obj, objPatch = { current: {}, former: p.current })
          // p.current
          // p.former
        })
        // ...
        i += direction
      }
    }
    return result
  }

  beginSave(): void {
    this._isSaving = true
  }

  endSave(success: boolean): void {
    if (success)
      this._saved = this._position
    this._isSaving = false
  }

  register(p: Patch): void {
    Transaction.run({ hint: 'TransactionJournal.remember', standalone: 'isolated' }, () => {
      const items = this._edits = this._edits.toMutable()
      if (items.length >= this._capacity)
        items.shift()
      else
        items.splice(this._position)
      items.push(p)
      this._position = items.length
    })
  }

  static buildPatch(hint: string, changeset: Map<ObjectHolder, ObjectRevision>): Patch {
    const patch: Patch = { hint, objects: new Map<object, ObjectPatch>() }
    changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
      const p: ObjectPatch = { current: {}, former: {} }
      const old = r.prev.revision !== ROOT_REV ? r.prev.revision.data : undefined
      r.changes.forEach((episode, m) => {
        p.current[m] = unseal(r.data[m])
        if (old)
          p.former[m] = unseal(old[m])
      })
      if (!old) {
        delete p.current[Meta.Disposed] // object restore
        p.former[Meta.Disposed] = Meta.Disposed // object disposed at episode 0
      }
      patch.objects.set(h.proxy, p)
    })
    return patch
  }

  static applyPatch(patch: Patch, undo: boolean): void {
    const ctx = Snapshot.edit()
    patch.objects.forEach((p: ObjectPatch, obj: object) => {
      const h = Meta.get<ObjectHolder>(obj, Meta.Holder)
      const data = undo ? p.former : p.current
      if (data[Meta.Disposed] === undefined) {
        for (const m in data) {
          const value = data[m]
          const r: ObjectRevision = ctx.getEditableRevision(h, m, value)
          if (r.snapshot === ctx) {
            r.data[m] = new Observable(value)
            const v: any = r.prev.revision.data[m]
            Snapshot.markEdited(v, value, v !== value, r, m, h)
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
  const createCopy = result?.[Sealant.CreateCopy] as () => any
  return createCopy !== undefined ? createCopy.call(result) : result
}
