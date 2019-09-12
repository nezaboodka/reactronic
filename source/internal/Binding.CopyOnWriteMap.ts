// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.

// Copyright (c) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>

import { Binding, R, W } from './Binding';
export { Binding } from './Binding';

export abstract class CopyOnWriteMap<K, V> extends Map<K, V> {
  clear(): void { super.clear.call(W<Map<K, V>>(this)); }
  delete(key: K): boolean { return super.delete.call(W<Map<K, V>>(this), key); }
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void { super.forEach.call(R<Map<K, V>>(this), callbackfn, thisArg); }
  get(key: K): V | undefined { return super.get.call(R<Map<K, V>>(this), key); }
  has(key: K): boolean { return super.has.call(R<Map<K, V>>(this), key); }
  set(key: K, value: V): this { super.set.call(W<Map<K, V>>(this), key, value); return this; }
  get size(): number { return super.size; }
  entries(): IterableIterator<[K, V]> { return super.entries.call(R<Map<K, V>>(this)); }
  keys(): IterableIterator<K> { return super.keys.call(R<Map<K, V>>(this)); }
  values(): IterableIterator<V> { return super.values.call(R<Map<K, V>>(this)); }

  static seal<K, V>(owner: any, prop: PropertyKey, map: Map<K, V>): Binding<Map<K, V>> {
    return Binding.seal(owner, prop, map, CopyOnWriteMap.prototype, CopyOnWriteMap.clone);
  }

  static clone<K, V>(map: Map<K, V>): Map<K, V> {
    return new Map<K, V>(Map.prototype.entries.call(map));
  }
}
