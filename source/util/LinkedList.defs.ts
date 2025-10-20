// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

// ExtractItemKey / ИзвлечьКлючЭлемента

export type ExtractItemKey<T = unknown> = (node: T) => string | undefined

// Mark / Отметка

export enum Mark {

  existing = 0, // существующий

  added = 1,    // добавленный

  moved = 2,    // перемещённый

  removed = 3,  // удалённый

}

// Linked / Связанное

export interface Linked<T> {

  readonly value: T

  readonly next?: Linked<T>

  readonly prev?: Linked<T>

  readonly index: number

  readonly mark: Mark

}

// CollectionReader / КоллекцияЧитаемая

export interface CollectionReader<T>
{
  count: number
  items(): Generator<T>
}

// LinkedListRenovation / РеновацияСпискаСвязанного

export interface LinkedListRenovation<T> {

  list: AbstractLinkedList<T>

  lookup(key: string | undefined): Linked<T> | undefined

  tryReuse(key: string,
    resolution?: { isDuplicate: boolean },
    error?: string): Linked<T> | undefined

  add(item: Linked<T>, before?: Linked<T>): void

  remove(item: Linked<T>): void

  move(item: Linked<T>, before: Linked<T> | undefined): void

  setMark(item: Linked<T>, value: Mark): void

  readonly currentCount: number

  current(): Generator<Linked<T>>

  readonly addedCount: number

  added(): Generator<Linked<T>>

  readonly disappearedCount: number

  disappeared(): Generator<Linked<T>>

}

// LinkedList / СписокСвязанный

export interface AbstractLinkedList<T> extends CollectionReader<Linked<T>> {

  readonly extractKey: ExtractItemKey<T>

  isStrictOrder: boolean

  readonly isRenovationInProgress: boolean

  readonly count: number

  items(): Generator<Linked<T>>

  lookup(key: string | undefined): Linked<T> | undefined

  add(item: Linked<T>): void

  remove(item: Linked<T>): void

  beginRenovation(): LinkedListRenovation<T>

  endRenovation(r: LinkedListRenovation<T>, error?: unknown): void

}
