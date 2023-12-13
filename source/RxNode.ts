// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2024 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { MergeListReader, MergedItem } from './util/MergeList.js'
import { MemberOptions } from './Options.js'

// Delegates

export type Delegate<T> = (element: T, base: () => void) => void
export type SimpleDelegate<T = unknown, R = void> = (element: T) => R

// Enums

export enum Mode {
  Default = 0,
  PinpointUpdate = 1,
  ManualMount = 2,
}

export const enum Priority {
  Realtime = 0,
  Normal = 1,
  Background = 2
}

// RxNode

export interface RxElement {
  node: RxNode<any>
}

export interface RxNode<E extends RxElement = any> {
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
  readonly isInitialUpdate: boolean
  priority?: Priority
  childrenShuffling: boolean
  strictOrder: boolean
  has(mode: Mode): boolean
  configureReactronic(options: Partial<MemberOptions>): MemberOptions
}

// RxNodeDecl

export interface RxNodeDecl<E extends RxElement> {
  preset?: RxNodeDecl<E>
  key?: string
  mode?: Mode
  triggers?: unknown
  specify?: Delegate<E>
  create?: Delegate<E>
  initialize?: Delegate<E>
  update?: Delegate<E>
  finalize?: Delegate<E>
}

// RxNodeDriver

export interface RxNodeDriver<E extends RxElement> {
  readonly name: string,
  readonly isPartitionSeparator: boolean,
  readonly predefine?: SimpleDelegate<E>

  allocate(node: RxNode<E>): E
  initialize(element: E): void
  mount(element: E): void
  update(element: E): void | Promise<void>
  finalize(element: E, isLeader: boolean): boolean
}

// RxNodeContext

export interface RxNodeContext<T extends Object = Object> {
  value: T
}
