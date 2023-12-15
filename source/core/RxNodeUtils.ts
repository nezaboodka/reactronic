// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2019-2024 Nezaboodka Software <contact@nezaboodka.com>
// License: https://raw.githubusercontent.com/nezaboodka/verstak/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

export function emitLetters(n: number): string {
  if (n < 0)
    throw new Error(`emitLetters: argument (${n}) should not be negative or zero`)
  let result = ''
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
  const stack = error.stack || ''
  Error.stackTraceLimit = restore
  const lines = stack.split('\n')
  let i = lines.findIndex(x => x.indexOf('.acquire') >= 0)
  i = i >= 0 ? i + 2 : 5
  let caller = extractFunctionAndLocation(lines[i])
  let location = caller
  if (caller.func.endsWith('.update')) {
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
  const match = s.match(/(?:\s*at\s+)?(?:(\S+)\s\()?(?:.*?)([^\/\(\):]+)(?:(:|\d)*\)?)$/)
  return {
    func: match?.[1] || '',
    file: match?.[2] || '',
  }
}
