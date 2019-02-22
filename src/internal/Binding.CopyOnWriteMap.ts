import { Binding, R, W } from "./Binding";
export { Binding } from "./Binding";

export class CopyOnWriteMap<K, V> extends Map<K, V> {
  clear(): void { W<Map<K, V>>(this).clear(); }
  delete(key: K): boolean { return W<Map<K, V>>(this).delete(key); }
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void { R<Map<K, V>>(this).forEach(callbackfn, thisArg); }
  get(key: K): V | undefined { return R<Map<K, V>>(this).get(key); }
  has(key: K): boolean { return R<Map<K, V>>(this).has(key); }
  set(key: K, value: V): this { W<Map<K, V>>(this).set(key, value); return this; }
  get size(): number { return R<Map<K, V>>(this).size; }

  static seal<K, V>(owner: any, prop: PropertyKey, map: Map<K, V>): Binding<Map<K, V>> {
    return Binding.seal(owner, prop, map, CopyOnWriteMap.prototype, CopyOnWriteMap.clone);
  }

  static clone<K, V>(map: Map<K, V>): Map<K, V> {
    return new Map<K, V>(map);
  }
}
