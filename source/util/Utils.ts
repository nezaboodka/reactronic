// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export type F<T> = (...args: any[]) => T

export class Utils {
  static freezeSet<T>(obj?: Set<T>): Set<T> | undefined {
    if (obj instanceof Set) {
      const pd = { configurable: false, enumerable: false, get: UNDEF, set: UNDEF }
      Object.defineProperty(obj, "add", pd)
      Object.defineProperty(obj, "delete", pd)
      Object.defineProperty(obj, "clear", pd)
      Object.freeze(obj)
    }
    return obj
  }

  static freezeMap<K, V>(obj?: Map<K, V>): Map<K, V> | undefined {
    if (obj instanceof Map) {
      const pd = { configurable: false, enumerable: false, get: UNDEF, set: UNDEF }
      Object.defineProperty(obj, "set", pd)
      Object.defineProperty(obj, "delete", pd)
      Object.defineProperty(obj, "clear", pd)
      Object.freeze(obj)
    }
    return obj
  }

  static copyAllMembers(source: any, target: any): any {
    for (const m of Object.getOwnPropertyNames(source))
      target[m] = source[m]
    for (const m of Object.getOwnPropertySymbols(source))
      target[m] = source[m]
    return target
  }

  // static clone(obj: any): any {
  //   const cloned = Object.create(Object.getPrototypeOf(obj))
  //   const descriptors = Object.getOwnPropertyDescriptors(obj)
  //   Object.defineProperties(cloned, descriptors)
  //   return cloned
  // }

  // static copyAllMembers(source: any, target: any): void {
  //   const descriptors = Object.getOwnPropertyDescriptors(source)
  //   Object.defineProperties(target, descriptors)
  // }
}

/* istanbul ignore next */
export function UNDEF(...args: any[]): never {
  throw new Error("this method should never be called")
}

/* istanbul ignore next */
export async function all(promises: Array<Promise<any>>): Promise<any[]> {
  let error: any
  const result = await Promise.all(promises.map(x => x.catch(e => { error = error || e; return e })))
  if (error)
    throw error
  return result
}

/* istanbul ignore next */
export function pause<T>(timeout: number): Promise<T> {
  return new Promise(function(resolve: any): void {
    setTimeout(resolve.bind(null, () => resolve), timeout)
  })
}

export function proceedSyncOrAsync<T>(result: T | Promise<T>, success: (v: any) => T, failure: (e: any) => T): T | Promise<T> {
  let r: T | Promise<T>
  if (result instanceof Promise)
    r = result.then(
      v => success(v),
      e => failure(e))
  else
    r = success(result)
  return r
}

export function emitLetters(n: number): string {
  if (n < 0)
    throw new Error(`emitLetters: argument (${n}) should not be negative or zero`)
  let result = ""
  while (n >= 0) {
    const r = n % 26
    n = Math.floor(n / 26) - 1
    result = String.fromCharCode(65 + r) + result
  }
  return result
}

export function objectHasMember<T>(obj: any, member: string): obj is T {
  return obj === Object(obj) && !Array.isArray(obj) && member in obj
}

export function getCallerInfo(prefix: string): string {
  const restore = Error.stackTraceLimit = 20
  const error = new Error()
  const stack = error.stack || ""
  Error.stackTraceLimit = restore
  const lines = stack.split("\n")
  let i = lines.findIndex(x => x.indexOf(".declare") >= 0)
  i = i >= 0 ? i + 2 : 5
  let caller = extractFunctionAndLocation(lines[i])
  let location = caller
  if (caller.func.endsWith(".update")) {
    i = i - 1
    caller = extractFunctionAndLocation(lines[i])
    location = extractFunctionAndLocation(lines[i + 1])
  }
  else {
    while (!caller.func && i > 0) {
      i = i - 1
      caller = extractFunctionAndLocation(lines[i])
    }
    location = extractFunctionAndLocation(lines[i + 1])
  }
  const result = `${prefix}·${caller.func}@${location.file}`
  return result
}

function extractFunctionAndLocation(s: string): { func: string, file: string } {
  // const match = s.match(/(?:\s*at\s+)?(?:\S+\s\(|@)?(?:.*?)([^\/\(\):]+)(?:(:|\d)*\)?)$/)
  const match = s.match(/(?:\s*at\s+)?(?:(\S+)\s\()?(?:.*?)([^\/\(\)]+)(?:(:|\d)*\)?)$/)
  return {
    func: match?.[1] || "",
    file: match?.[2] || "",
  }
}
