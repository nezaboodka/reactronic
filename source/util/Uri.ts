// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2025 Nezaboodka Software <contact@nezaboodka.by>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import { misuse } from "./Dbg.js"

export interface UriComponents {
  scheme: string
  authority?: string
  path?: string
  query?: string
  fragment?: string
}

export class Uri implements UriComponents {
  private static readonly regexp = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/

  readonly scheme: string
  readonly authority: string
  readonly path: string
  readonly query: string
  readonly fragment: string

  protected constructor(scheme: string, authority?: string, path?: string, query?: string, fragment?: string) {
    this.scheme = scheme
    this.authority = authority ?? ""
    this.path = path ?? ""
    this.query = query ?? ""
    this.fragment = fragment ?? ""
    validateUri(this)
  }

  equalsTo(uri: Uri): boolean {
    return this.scheme === uri.scheme &&
      this.authority === uri.authority &&
      this.path === uri.path &&
      this.query === uri.query &&
      this.fragment === uri.fragment
  }

  toString(): string {
    let result = `${this.scheme}://${this.authority}${this.path}`
    if (this.query) {
      result += `?${this.query}`
    }
    if (this.fragment) {
      result += `#${this.fragment}`
    }
    return result
  }

  static parse(value: string): Uri {
    let result
    const match = Uri.regexp.exec(value)
    if (!match) {
      result = new Uri("")
    }
    else {
      result = new Uri(match[2] ?? "", match[4] ?? "", match[5] ?? "", match[7] ?? "", match[9] ?? "")
    }
    return result
  }

  static from(components: UriComponents): Uri {
    return new Uri(components.scheme, components.authority, components.path, components.query, components.fragment)
  }
}

const SCHEME_PATTERN = /^\w[\w\d+.-]*$/
const SINGLE_SLASH_START = /^\//
const DOUBLE_SLASH_START = /^\/\//

function validateUri(uri: Uri, strict?: boolean): void {
  if (!uri.scheme && strict) {
    throw misuse(`Scheme is missing: {scheme: "", authority: "${uri.authority}", path: "${uri.path}", query: "${uri.query}", fragment: "${uri.fragment}"}`)
  }
  if (uri.scheme && !SCHEME_PATTERN.test(uri.scheme)) {
    throw misuse("Scheme contains illegal characters.")
  }
  if (uri.path) {
    if (uri.authority) {
      if (!SINGLE_SLASH_START.test(uri.path)) {
        throw misuse("If a URI contains an authority component, then the path component must either be empty or begin with a slash character ('/').")
      }
    } else {
      if (DOUBLE_SLASH_START.test(uri.path)) {
        throw misuse("If a URI does not contain an authority component, then the path cannot begin with two slash characters ('//').")
      }
    }
  }
}
