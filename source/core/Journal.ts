// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2024 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { Isolation } from "../Options.js"
import { ObservableObject } from "./Mvcc.js"
import { ObjectHandle, ObjectVersion, Meta, PatchSet, ValuePatch, FieldVersion, FieldKey } from "./Data.js"
import { Changeset, EMPTY_OBJECT_VERSION } from "./Changeset.js"
import { Transaction } from "./Transaction.js"
import { Sealant } from "../util/Sealant.js"

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
  private _unsaved: PatchSet = new Map<object, Map<FieldKey, ValuePatch>>()
  private _position: number = 0

  get capacity(): number { return this._capacity }
  set capacity(value: number) { this._capacity = value; if (value < this._edits.length) this._edits.splice(0, this._edits.length - value) }
  get edits(): ReadonlyArray<PatchSet> { return this._edits }
  get unsaved(): PatchSet { return this._unsaved }
  get canUndo(): boolean { return this._edits.length > 0 && this._position > 0 }
  get canRedo(): boolean { return this._position < this._edits.length }

  edited(p: PatchSet): void {
    Transaction.run({ hint: "EditJournal.edited", isolation: Isolation.disjoinFromOuterAndInnerTransactions }, () => {
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
      this._unsaved = new Map<object, Map<FieldKey, ValuePatch>>()
    else
      throw new Error("not implemented")
  }

  undo(count: number = 1): void {
    Transaction.run({ hint: "Journal.undo", isolation: Isolation.disjoinFromOuterAndInnerTransactions }, () => {
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
    Transaction.run({ hint: "Journal.redo", isolation: Isolation.disjoinFromOuterAndInnerTransactions }, () => {
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

  static buildPatch(hint: string, items: Map<ObjectHandle, ObjectVersion>): PatchSet {
    const patch: PatchSet = new Map<object, Map<FieldKey, ValuePatch>>()
    items.forEach((ov: ObjectVersion, h: ObjectHandle) => {
      const op = new Map<FieldKey, ValuePatch>()
      const former = ov.former.objectVersion !== EMPTY_OBJECT_VERSION ? ov.former.objectVersion.data : undefined
      ov.changes.forEach(fk => {
        const vp: ValuePatch = {
          fieldKey: fk, patchKind: "update",
          freshContent: unseal(ov.data[fk]), formerContent: undefined,
        }
        if (former)
          vp.formerContent = unseal(former[fk])
        op.set(fk, vp)
      })
      if (!former) {
        const vp: ValuePatch = {
          fieldKey: Meta.Revision, patchKind: "remove",
          freshContent: Meta.Undefined, formerContent: undefined,
        }
        op.set(Meta.Revision, vp)
      }
      patch.set(h.proxy, op)
    })
    return patch
  }

  static applyPatch(patch: PatchSet, undoing: boolean): void {
    const ctx = Changeset.edit()
    patch.forEach((op: Map<FieldKey, ValuePatch>, obj: object) => {
      const h = Meta.get<ObjectHandle>(obj, Meta.Handle)
      const rev = op.get(Meta.Revision)
      const disposed = rev && (undoing ? rev.formerContent : rev.freshContent) === Meta.Undefined
      // const data = undoing ? op.former : op.data
      if (!disposed) {
        op.forEach((vp, fk) => {
          const content = undoing ? vp.formerContent : vp.freshContent
          const ov: ObjectVersion = ctx.getEditableObjectVersion(h, fk, content)
          if (ov.changeset === ctx) {
            ov.data[fk] = new FieldVersion(content)
            const existing: any = ov.former.objectVersion.data[fk]
            Changeset.markEdited(existing, content, existing !== content, ov, fk, h)
          }
        })
      }
      else
        Changeset.doDispose(ctx, h)
    })
  }

  mergePatchToUnsaved(patch: PatchSet, undoing: boolean): void {
    const unsaved = this._unsaved = this._unsaved.toMutable()
    patch.forEach((op: Map<FieldKey, ValuePatch>, obj: object) => {
      let result = unsaved.get(obj)
      if (!result)
        unsaved.set(obj, result = new Map<FieldKey, ValuePatch>())
      op.forEach((vp, fk) => {
        let merged = result!.get(fk)
        if (!merged)
          result!.set(fk, merged = {
            fieldKey: fk, patchKind: "update",
            freshContent: undefined, formerContent: undefined,
          })
        const value = undoing ? vp.formerContent : vp.freshContent
        const former = undoing ? vp.freshContent : vp.formerContent
        if (value !== merged.formerContent) {
          merged.freshContent = value
          merged.formerContent = former
        }
        else {
          result!.delete(fk)
          if (result!.size === 0)
            unsaved.delete(obj)
        }
      })
    })
  }
}

function unseal(fv: FieldVersion): any {
  const result = fv.content
  const createCopy = result?.[Sealant.CreateCopy] as () => any
  return createCopy !== undefined ? createCopy.call(result) : result
}
