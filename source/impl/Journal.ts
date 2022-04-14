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

export abstract class Journal extends ObservableObject {
  abstract capacity: number
  abstract readonly edits: ReadonlyArray<Patch>
  abstract readonly unsaved: Patch
  abstract readonly canUndo: boolean
  abstract readonly canRedo: boolean

  abstract edited(patch: Patch): void
  abstract saved(patch: Patch): void
  abstract undo(count?: number): void
  abstract redo(count?: number): void

  static create(): Journal { return new JournalImpl() }
}

export class JournalImpl extends Journal {
  private _capacity: number = 5
  private _edits: Patch[] = []
  private _unsaved: Patch = { hint: 'unsaved', objects: new Map<object, ObjectPatch>() }
  private _position: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._edits.length) this._edits.splice(0, this._edits.length - value) }
  get edits(): ReadonlyArray<Patch> { return this._edits }
  get unsaved(): Patch { return this._unsaved }
  get canUndo(): boolean { return this._edits.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._edits.length }

  edited(p: Patch): void {
    Transaction.run({ hint: 'EditJournal.edited', standalone: 'isolated' }, () => {
      const items = this._edits = this._edits.toMutable()
      if (items.length >= this._capacity)
        items.shift()
      else
        items.splice(this._position)
      items.push(p)
      this.applyPatchToUnsaved(p, false)
      this._position = items.length
    })
  }

  saved(patch: Patch): void {
    if (this._unsaved === patch)
      this._unsaved = { hint: 'unsaved', objects: new Map<object, ObjectPatch>() }
    else
      throw new Error('not implemented')
  }

  undo(count: number = 1): void {
    Transaction.run({ hint: 'Journal.undo', standalone: 'isolated' }, () => {
      let i: number = this._position - 1
      while (i >= 0 && count > 0) {
        const patch = this._edits[i]
        JournalImpl.applyPatch(patch, true)
        this.applyPatchToUnsaved(patch, true)
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
        this.applyPatchToUnsaved(patch, false)
        i++, count--
      }
      this._position = i
    })
  }

  static buildPatch(hint: string, changeset: Map<ObjectHolder, ObjectRevision>): Patch {
    const patch: Patch = { hint, objects: new Map<object, ObjectPatch>() }
    changeset.forEach((r: ObjectRevision, h: ObjectHolder) => {
      const p: ObjectPatch = { current: {}, former: {} }
      const prev = r.prev.revision !== ROOT_REV ? r.prev.revision.data : undefined
      r.changes.forEach((episode, m) => {
        p.current[m] = unseal(r.data[m])
        if (prev)
          p.former[m] = unseal(prev[m])
      })
      if (!prev) {
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

  applyPatchToUnsaved(patch: Patch, undo: boolean): void {
    const unsaved = this._unsaved
    patch.objects.forEach((p: ObjectPatch, obj: object) => {
      let target = unsaved.objects.get(obj)
      if (!target)
        unsaved.objects.set(obj, target = { current: {}, former: {} })
      const fields = undo ? p.former : p.current
      if (fields[Meta.Disposed] === undefined) {
        for (const m in fields) {
          const value = fields[m]
          target.current[m] = value
        }
      }
      else
        target.current[Meta.Disposed] = Meta.Disposed
    })
  }
}

function unseal(observable: Observable): any {
  const result = observable.value
  const createCopy = result?.[Sealant.CreateCopy] as () => any
  return createCopy !== undefined ? createCopy.call(result) : result
}
