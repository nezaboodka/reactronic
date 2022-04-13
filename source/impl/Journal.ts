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

export type Saver = (patch: Patch) => Promise<void>

export abstract class EditJournal extends ObservableObject {
  abstract capacity: number
  abstract autoSave: boolean
  abstract saver: Saver | undefined

  abstract readonly edits: ReadonlyArray<Patch>
  abstract readonly hasChangesToUndo: boolean
  abstract readonly hasChangesToRedo: boolean
  abstract readonly hasChangesToSave: boolean
  abstract readonly isSaving: boolean

  abstract undo(count?: number): void
  abstract redo(count?: number): void
  abstract save(): void

  abstract register(patch: Patch): void

  static create(): EditJournal { return new EditJournalImpl() }
}

export class EditJournalImpl extends EditJournal {
  private _capacity: number = 5
  private _autoSave: boolean = false
  private _saver: Saver | undefined = undefined
  private _edits: Patch[] = []
  private _position: number = 0
  private _isSaving: boolean = false
  private _saved: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._edits.length) this._edits.splice(0, this._edits.length - value) }
  get autoSave(): boolean { return this._autoSave }
  set autoSave(value: boolean) { this._autoSave = value }
  get saver(): Saver | undefined { return this._saver }
  set saver(value: Saver | undefined) { this._saver = value }

  get edits(): ReadonlyArray<Patch> { return this._edits }
  get hasChangesToUndo(): boolean { return this._edits.length > 0 && this._position > 0 }
  get hasChangesToRedo(): boolean { return this._position < this._edits.length }
  get hasChangesToSave(): boolean { return false }
  get isSaving(): boolean { return this._isSaving }

  undo(count: number = 1): void {
    Transaction.run({ hint: 'EditJournal.undo', standalone: 'isolated' }, () => {
      let i: number = this._position - 1
      while (i >= 0 && count > 0) {
        const patch = this._edits[i]
        EditJournalImpl.applyPatch(patch, true)
        i--, count--
      }
      this._position = i + 1
    })
  }

  redo(count: number = 1): void {
    Transaction.run({ hint: 'EditJournal.redo', standalone: 'isolated' }, () => {
      let i: number = this._position
      while (i < this._edits.length && count > 0) {
        const patch = this._edits[i]
        EditJournalImpl.applyPatch(patch, false)
        i++, count--
      }
      this._position = i
    })
  }

  async save(): Promise<void> {
    if (this._saver) {
      const changes = this.getChangesToSave()
      if (changes) {
        try
        {
          Transaction.standalone(() => this._isSaving = true)
          await this._saver(changes)
        }
        finally {
          Transaction.standalone(() => this._isSaving = false)
        }
        this._saved = this._position
      }
    }
  }

  private getChangesToSave(): Patch | undefined {
    let result: Patch | undefined = undefined
    const length = Math.abs(this._position - this._saved)
    if (length !== 0) {
      result = { hint: 'unsaved changes', objects: new Map<object, ObjectPatch>() }
      const direction = Math.sign(this._position - this._saved)
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
        i++
      }
    }
    return result
  }

  register(p: Patch): void {
    Transaction.run({ hint: 'EditJournal.remember', standalone: 'isolated' }, () => {
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
