// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { ReactiveObject } from './Hooks'
import { ObjectHandle, ObjectSnapshot, Meta, PatchSet, DataPatch, Subscription } from './Data'
import { Changeset, EMPTY_SNAPSHOT } from './Changeset'
import { Transaction } from './Transaction'
import { Sealant } from '../util/Sealant'

export type Saver = (patch: PatchSet) => Promise<void>

export abstract class Journal extends ReactiveObject {
  abstract capacity: number
  abstract readonly edits: ReadonlyArray<PatchSet>
  abstract readonly unsaved: PatchSet
  abstract readonly canUndo: boolean
  abstract readonly canRedo: boolean

  abstract edited(patch: PatchSet): void
  abstract saved(patch: PatchSet): void
  abstract undo(count?: number): void
  abstract redo(count?: number): void

  static create(): Journal { return new JournalImpl() }
}

export class JournalImpl extends Journal {
  private _capacity: number = 5
  private _edits: PatchSet[] = []
  private _unsaved: PatchSet = { hint: 'unsaved', objects: new Map<object, DataPatch>() }
  private _position: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._edits.length) this._edits.splice(0, this._edits.length - value) }
  get edits(): ReadonlyArray<PatchSet> { return this._edits }
  get unsaved(): PatchSet { return this._unsaved }
  get canUndo(): boolean { return this._edits.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._edits.length }

  edited(p: PatchSet): void {
    Transaction.run({ hint: 'EditJournal.edited', standalone: 'isolated' }, () => {
      const items = this._edits = this._edits.toMutable()
      if (items.length >= this._capacity)
        items.shift()
      else
        items.splice(this._position)
      this.mergePatchToUnsaved(p, false)
      items.push(p)
      this._position = items.length
    })
  }

  saved(patch: PatchSet): void {
    if (this._unsaved === patch)
      this._unsaved = { hint: 'unsaved', objects: new Map<object, DataPatch>() }
    else
      throw new Error('not implemented')
  }

  undo(count: number = 1): void {
    Transaction.run({ hint: 'Journal.undo', standalone: 'isolated' }, () => {
      let i: number = this._position - 1
      while (i >= 0 && count > 0) {
        const patch = this._edits[i]
        JournalImpl.applyPatch(patch, true)
        this.mergePatchToUnsaved(patch, true)
        i--, count--
      }
      this._position = i + 1
    })
  }

  redo(count: number = 1): void {
    Transaction.run({ hint: 'Journal.redo', standalone: 'isolated' }, () => {
      let i: number = this._position
      while (i < this._edits.length && count > 0) {
        const patch = this._edits[i]
        JournalImpl.applyPatch(patch, false)
        this.mergePatchToUnsaved(patch, false)
        i++, count--
      }
      this._position = i
    })
  }

  static buildPatch(hint: string, items: Map<ObjectHandle, ObjectSnapshot>): PatchSet {
    const patch: PatchSet = { hint, objects: new Map<object, DataPatch>() }
    items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
      const op: DataPatch = { data: {}, former: {} }
      const former = os.former.snapshot !== EMPTY_SNAPSHOT ? os.former.snapshot.data : undefined
      os.changes.forEach(m => {
        op.data[m] = unseal(os.data[m])
        if (former)
          op.former[m] = unseal(former[m])
      })
      if (!former) {
        delete op.data[Meta.Revision] // object restore
        op.former[Meta.Revision] = Meta.Undefined
      }
      patch.objects.set(h.proxy, op)
    })
    return patch
  }

  static applyPatch(patch: PatchSet, undoing: boolean): void {
    const ctx = Changeset.edit()
    patch.objects.forEach((dp: DataPatch, obj: object) => {
      const h = Meta.get<ObjectHandle>(obj, Meta.Handle)
      const data = undoing ? dp.former : dp.data
      if (data[Meta.Revision] !== Meta.Undefined) {
        for (const m in data) {
          const value = data[m]
          const os: ObjectSnapshot = ctx.getEditableSnapshot(h, m, value)
          if (os.changeset === ctx) {
            os.data[m] = new Subscription(value)
            const existing: any = os.former.snapshot.data[m]
            Changeset.markEdited(existing, value, existing !== value, os, m, h)
          }
        }
      }
      else
        Changeset.doDispose(ctx, h)
    })
  }

  mergePatchToUnsaved(patch: PatchSet, undoing: boolean): void {
    const unsaved = this._unsaved
    patch.objects.forEach((dp: DataPatch, obj: object) => {
      let merged = unsaved.objects.get(obj)
      if (!merged)
        unsaved.objects.set(obj, merged = { data: {}, former: {} })
      const data = undoing ? dp.former : dp.data
      const former = undoing ? dp.data : dp.former
      for (const m in data) {
        const value = data[m]
        if (value !== merged.former[m]) {
          merged.data[m] = value
          if (m in merged.former === false)
            merged.former[m] = former[m]
        }
        else {
          delete merged.data[m]
          delete merged.former[m]
          if (Object.keys(merged.data).length === 0)
            unsaved.objects.delete(obj)
        }
      }
    })
  }
}

function unseal(subscription: Subscription): any {
  const result = subscription.content
  const createCopy = result?.[Sealant.CreateCopy] as () => any
  return createCopy !== undefined ? createCopy.call(result) : result
}
