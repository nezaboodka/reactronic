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
