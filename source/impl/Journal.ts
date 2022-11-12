// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2022 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { ObservableObject } from './Mvcc'
import { ObjectHandle, ObjectSnapshot, Meta, PatchSet, ValuePatch, Observable, MemberName } from './Data'
import { Changeset, EMPTY_SNAPSHOT } from './Changeset'
import { Transaction } from './Transaction'
import { Sealant } from '../util/Sealant'

export type Saver = (patch: PatchSet) => Promise<void>

export abstract class Journal extends ObservableObject {
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
  private _unsaved: PatchSet = new Map<object, Map<MemberName, ValuePatch>>()
  private _position: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._edits.length) this._edits.splice(0, this._edits.length - value) }
  get edits(): ReadonlyArray<PatchSet> { return this._edits }
  get unsaved(): PatchSet { return this._unsaved }
  get canUndo(): boolean { return this._edits.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._edits.length }

  edited(p: PatchSet): void {
    Transaction.run({ hint: 'EditJournal.edited', separation: 'isolated' }, () => {
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
      this._unsaved = new Map<object, Map<MemberName, ValuePatch>>()
    else
      throw new Error('not implemented')
  }

  undo(count: number = 1): void {
    Transaction.run({ hint: 'Journal.undo', separation: 'isolated' }, () => {
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
    Transaction.run({ hint: 'Journal.redo', separation: 'isolated' }, () => {
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
    const patch: PatchSet = new Map<object, Map<MemberName, ValuePatch>>()
    items.forEach((os: ObjectSnapshot, h: ObjectHandle) => {
      const op = new Map<MemberName, ValuePatch>()
      const former = os.former.snapshot !== EMPTY_SNAPSHOT ? os.former.snapshot.data : undefined
      os.changes.forEach(m => {
        const vp: ValuePatch = {
          memberName: m, patchKind: 'update',
          freshValue: unseal(os.data[m]), formerValue: undefined,
        }
        if (former)
          vp.formerValue = unseal(former[m])
        op.set(m, vp)
      })
      if (!former) {
        const vp: ValuePatch = {
          memberName: Meta.Revision, patchKind: 'remove',
          freshValue: Meta.Undefined, formerValue: undefined,
        }
        op.set(Meta.Revision, vp)
      }
      patch.set(h.proxy, op)
    })
    return patch
  }

  static applyPatch(patch: PatchSet, undoing: boolean): void {
    const ctx = Changeset.edit()
    patch.forEach((op: Map<MemberName, ValuePatch>, obj: object) => {
      const h = Meta.get<ObjectHandle>(obj, Meta.Handle)
      const rev = op.get(Meta.Revision)
      const disposed = rev && (undoing ? rev.formerValue : rev.freshValue) === Meta.Undefined
      // const data = undoing ? op.former : op.data
      if (!disposed) {
        op.forEach((vp, m) => {
          const value = undoing ? vp.formerValue : vp.freshValue
          const os: ObjectSnapshot = ctx.getEditableObjectSnapshot(h, m, value)
          if (os.changeset === ctx) {
            os.data[m] = new Observable(value)
            const existing: any = os.former.snapshot.data[m]
            Changeset.markEdited(existing, value, existing !== value, os, m, h)
          }
        })
      }
      else
        Changeset.doDispose(ctx, h)
    })
  }

  mergePatchToUnsaved(patch: PatchSet, undoing: boolean): void {
    const unsaved = this._unsaved = this._unsaved.toMutable()
    patch.forEach((op: Map<MemberName, ValuePatch>, obj: object) => {
      let result = unsaved.get(obj)
      if (!result)
        unsaved.set(obj, result = new Map<MemberName, ValuePatch>())
      op.forEach((vp, m) => {
        let merged = result!.get(m)
        if (!merged)
          result!.set(m, merged = {
            memberName: m, patchKind: 'update',
            freshValue: undefined, formerValue: undefined,
          })
        const value = undoing ? vp.formerValue : vp.freshValue
        const former = undoing ? vp.freshValue : vp.formerValue
        if (value !== merged.formerValue) {
          merged.freshValue = value
          merged.formerValue = former
        }
        else {
          result!.delete(m)
          if (result!.size === 0)
            unsaved.delete(obj)
        }
      })
    })
  }
}

function unseal(o: Observable): any {
  const result = o.content
  const createCopy = result?.[Sealant.CreateCopy] as () => any
  return createCopy !== undefined ? createCopy.call(result) : result
}
