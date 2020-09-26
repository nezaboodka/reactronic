// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2016-2020 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava'
import { Transaction as Tran, Reactronic as R, Stateful } from 'api'
import { TestingLogLevel } from './brief'

class Serializable extends Stateful {
  text: string = ''
  array?: Array<Serializable> = undefined
}

test('serializing', t => {
  R.setLoggingMode(true, TestingLogLevel)
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
