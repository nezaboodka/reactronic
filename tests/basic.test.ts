// The below copyright notice and the license permission notice
// shall be included in all copies or substantial portions.
// Copyright (C) 2017-2019 Yury Chetyrko <ychetyrko@gmail.com>
// License: https://raw.githubusercontent.com/nezaboodka/reactronic/master/LICENSE

import test from 'ava';
import { Transaction, Cache, Reactronic as R, Kind, cacheof, nonreactive, standalone } from '../source/reactronic';
import { Person, tracing, nop } from './common';
import { DemoModel, DemoView, output } from './basic';

const expected: string[] = [
  "Filter: Jo",
  "Filter: Jo",
  "John's children: Billy, Barry, Steve",
  "Filter: ",
  "John Smith's children: Barry, William Smith, Steven Smith",
  "Kevin's children: Britney",
  // "Filter: Jo",
  // "John's children: Billy, Barry, Steve",
];

test("basic", t => {
  R.triggersAutoStartDisabled = true;
  R.triggersAutoStartDisabled = false;
  R.setTrace(tracing.off);
  R.setTrace(tracing.noisy);
  // Simple transactions
  const app = Transaction.run("app", () => new DemoView(new DemoModel()));
  try {
    t.is(app.model.methodOfStatefulBase(), "methodOfStatefulBase");
    t.notThrows(() => DemoView.test());
    const rendering = cacheof(app.render);
    t.is(rendering.isInvalid, false);
    app.model.loadUsers();
    const daddy: Person = app.model.users[0];
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    t.is(rendering.isInvalid, false);
    const stamp = rendering.stamp;
    app.render();
    t.is(rendering.stamp, stamp);
    // Multi-part transaction
    const tran1 = new Transaction("tran1");
    tran1.run(() => {
      t.throws(() => tran1.commit(), "cannot commit transaction having active workers");
      app.model.shared = app.shared = tran1.hint;
      daddy.age += 2; // causes no execution of DemoApp.render
      daddy.name = "John Smith"; // causes execution of DemoApp.render upon commit
      daddy.children[0].name = "Barry"; // Barry
      daddy.children[1].name = "William Smith"; // Billy
      daddy.children[2].name = "Steven Smith"; // Steve
      t.is(daddy.name, "John Smith");
      t.is(daddy.age, 40);
      t.is(Transaction.outside(() => daddy.age), 38);
      t.is(standalone(() => daddy.age), 38);
      t.is(nonreactive(() => daddy.age), 40);
      t.is(daddy.children.length, 3);
      app.userFilter = "Jo"; // set to the same value
    });
    t.is(app.model.shared, tran1.hint);
    t.is(daddy.name, "John");
    t.is(tran1.inspect(() => daddy.name), "John Smith");
    t.throws(() => tran1.inspect(() => { daddy.name = "Forbidden"; }), "cannot make changes during transaction inspection");
    t.is(daddy.age, 38);
    t.is(daddy.children.length, 3);
    t.is(rendering.isInvalid, false);
    tran1.run(() => {
      t.is(daddy.age, 40);
      daddy.age += 5;
      app.userFilter = "";
      if (daddy.emails) {
        daddy.emails[0] = "daddy@mail.com";
        daddy.emails.push("someone@mail.io");
      }
      daddy.attributes.set("city", "London");
      daddy.attributes.set("country", "United Kingdom");
      const x = daddy.children[1];
      x.parent = null;
      x.parent = daddy;
      t.is(daddy.name, "John Smith");
      t.is(daddy.age, 45);
      t.is(daddy.children.length, 3);
    });
    t.is(rendering.isInvalid, false);
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    t.is(daddy.attributes.size, 0);
    tran1.commit(); // changes are applied, reactions are executed
    t.is(rendering.isInvalid, false);
    t.not(rendering.stamp, stamp);
    t.is(daddy.name, "John Smith");
    t.is(daddy.age, 45);
    t.is(daddy.attributes.size, 2);
    // Protection from modification outside of transaction
    t.throws(() => {
      if (daddy.emails)
        daddy.emails.push("dad@mail.com");
    }, "stateful property #26˙Person.emails can only be modified inside transaction");
    t.throws(() => tran1.run(/* istanbul ignore next */ () => { /* nope */ }), "cannot run transaction that is already sealed");
    // // Undo transaction
    // tran1.undo();
    // t.is(daddy.name, "John");
    // t.is(daddy.age, 38);
    // Check protection and error handling
    t.throws(() => { cacheof(daddy.setParent).configure({latency: 0}); },
      "given method is not a reactronic cache");
    t.throws(() => { console.log(cacheof(daddy.setParent).config.monitor); },
      "given method is not a reactronic cache");
    const tran2 = new Transaction("tran2");
    t.throws(() => tran2.run(() => { throw new Error("test"); }), "test");
    t.throws(() => tran2.commit(),
      "cannot commit transaction that is already canceled: Error: test");
    const tran3 = new Transaction("tran3");
    t.throws(() => tran3.run(() => {
      tran3.cancel(new Error("test"));
      tran3.run(nop);
    }), "test");
    t.throws(() => tran3.commit(),
      "cannot commit transaction that is already canceled: Error: test");
    // Other
    t.is(rendering.config.kind, Kind.Cached);
    t.is(rendering.error, undefined);
    t.is(R.getTraceHint(app), "DemoView");
    R.setTraceHint(app, "App");
    t.is(R.getTraceHint(app), "App");
    t.deepEqual(Object.getOwnPropertyNames(app.model), [/*"shared",*/ "title", "users"]);
    t.is(Object.getOwnPropertyDescriptors(app.model).title.writable, true);
  }
  finally { // cleanup
    Cache.unmount(app, app.model);
  }
  const n: number = Math.max(output.length, expected.length);
  for (let i = 0; i < n; i++) {
    if (R.isTraceOn && !R.trace.silent) console.log(`actual[${i}] = ${output[i]},    expected[${i}] = ${expected[i]}`);
    t.is(output[i], expected[i]);
  }
});
