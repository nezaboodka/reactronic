// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2024 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { MergeListReader, MergedItem } from '../util/MergeList.js'
import { MemberOptions } from '../Options.js'

// Delegates

export type Delegate<T> = (element: T, base: () => void) => void
export type SimpleDelegate<T = unknown, R = void> = (element: T) => R

// Enums

export enum Mode {
  Default = 0,
  IndependentUpdate = 1,
  ManualMount = 2,
}

export const enum Priority {
  Realtime = 0,
  Normal = 1,
  Background = 2
}

// RxNode

export interface RxNode<E = unknown> {
  readonly key: string
  readonly driver: RxNodeDriver<E>
  readonly declaration: Readonly<RxNodeDecl<E>>
  readonly level: number
  readonly owner: RxNode
  element: E
  readonly host: RxNode
  readonly children: MergeListReader<RxNode>
  readonly seat: MergedItem<RxNode<E>> | undefined
  readonly stamp: number
  readonly outer: RxNode
  readonly context: RxNodeContext | undefined
  priority?: Priority
  childrenShuffling: boolean
  strictOrder: boolean
  has(mode: Mode): boolean
  configureReactronic(options: Partial<MemberOptions>): MemberOptions
}

// RxNodeDecl

export interface RxNodeDecl<E = unknown> {
  preset?: RxNodeDecl<E>
  key?: string
  mode?: Mode
  triggers?: unknown
  initialize?: Delegate<E>
  update?: Delegate<E>
  finalize?: Delegate<E>
}

// RxNodeDriver

export interface RxNodeDriver<E = unknown> {
  readonly name: string,
  readonly isPartitionSeparator: boolean,
  readonly predefine?: SimpleDelegate<E>

  allocate(node: RxNode<E>): E
  initialize(node: RxNode<E>): void
  mount(node: RxNode<E>): void
  update(node: RxNode<E>): void | Promise<void>
  finalize(node: RxNode<E>, isLeader: boolean): boolean
}

// RxNodeContext

export interface RxNodeContext<T extends Object = Object> {
  value: T
}
