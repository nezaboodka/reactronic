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

export abstract class RxNode<T = any> {
  abstract readonly key: string
  abstract readonly driver: RxNodeDriver<T>
  abstract readonly declaration: Readonly<RxNodeDecl<T>>
  abstract readonly level: number
  abstract readonly owner: RxNode
  abstract element: T
  abstract readonly host: RxNode
  abstract readonly children: MergeListReader<RxNode>
  abstract readonly slot: MergedItem<RxNode<T>> | undefined
  abstract readonly stamp: number
  abstract readonly outer: RxNode
  abstract readonly context: RxNodeContext | undefined
  abstract readonly isInitialUpdate: boolean
  abstract priority?: Priority
  abstract childrenShuffling: boolean
  abstract strictOrder: boolean
  abstract has(mode: Mode): boolean
  abstract configureReactronic(options: Partial<MemberOptions>): MemberOptions
}

// RxNodeDecl

export interface RxNodeDecl<T = unknown> {
  preset?: RxNodeDecl<T>
  key?: string
  mode?: Mode
  triggers?: unknown
  specify?: Delegate<T>
  create?: Delegate<T>
  initialize?: Delegate<T>
  update?: Delegate<T>
  finalize?: Delegate<T>
}

// RxNodeDriver

export interface RxNodeDriver<T> {
  readonly name: string,
  readonly isPartitionSeparator: boolean,
  readonly predefine?: SimpleDelegate<T>

  allocate(node: RxNode<T>): T
  initialize(element: T): void
  mount(element: T): void
  update(element: T): void | Promise<void>
  finalize(element: T, isLeader: boolean): boolean
}

// RxNodeContext

export interface RxNodeContext<T extends Object = Object> {
  value: T
}
