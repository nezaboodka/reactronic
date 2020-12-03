// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE
// By contributing, you agree that your contributions will be
// automatically licensed under the license referred above.

import test from 'ava'
import { Transaction as Tran, Reactronic as R, ObservableObject } from 'api'
import { TestingTraceLevel } from './brief'

class Serializable extends ObservableObject {
  text: string = ''
  array?: Array<Serializable> = undefined
}

test('serializing', t => {
  R.setTraceMode(true, TestingTraceLevel)
  const serializable = Tran.run(() => {
    const s1 = new Serializable()
    s1.text = 's1'
    const s2 = new Serializable()
    s2.text = 's2'
    s2.array = []
    s2.array.push(s1)
    return s2
  })
  try {
    const obj = JSON.parse(JSON.stringify(serializable))
    t.assert(Array.isArray(obj.array))
  }
  finally {
  }
})
