import test from "ava";
import { ReactiveCache, Transaction, Renew, Trace as T } from "../src/z.index";
import { Person } from "./common";
import { DemoModel, DemoView, output } from "./basic";

const expected: string[] = [
  "Filter: Jo",
  "John's children: Billy, Barry, Steve",
  "Filter: ",
  "John Smith's children: Barry, William Smith, Steven Smith",
  "Kevin's children: Britney",
  "Filter: Jo",
  "John's children: Billy, Barry, Steve",
];

test("basic", t => {
  T.level = process.env.AVA_DEBUG === undefined ? 6 : /* istanbul ignore next */ 3;
  // Simple actions
  const app = Transaction.run(() => new DemoView(new DemoModel()));
  try {
    t.is(ReactiveCache.getTraceHint(app), "DemoView");
    ReactiveCache.setTraceHint(app, "App");
    t.is(ReactiveCache.getTraceHint(app), "App");
    t.is(app.render.rcache.isOutdated, true);
    t.is(app.render.rcache.config.latency, Renew.OnDemand);
    app.model.loadUsers();
    const daddy: Person = app.model.users[0];
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    app.print(); // trigger first run
    t.is(app.render.rcache.isOutdated, false);
    t.is(app.render.rcache.error, undefined);
    const stamp = app.render.rcache.stamp;
    app.render();
    t.is(app.render.rcache.stamp, stamp);
    // Multi-part action
    const tran1 = new Transaction("tran1");
    tran1.run(() => {
      daddy.age += 2; // causes no execution of DemoApp.render
      daddy.name = "John Smith"; // causes execution of DemoApp.render upon action commit
      daddy.children[0].name = "Barry"; // Barry
      daddy.children[1].name = "William Smith"; // Billy
      daddy.children[2].name = "Steven Smith"; // Steve
      t.is(daddy.name, "John Smith");
      t.is(daddy.age, 40);
      t.is(daddy.children.length, 3);
      app.userFilter = "Jo"; // set to the same value
    });
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    t.is(daddy.children.length, 3);
    t.is(app.render.rcache.isOutdated, false);
    tran1.run(() => {
      t.is(daddy.age, 40);
      daddy.age += 5;
      app.userFilter = "";
      if (daddy.emails) {
        daddy.emails[0] = "daddy@mail.com";
        daddy.emails.push("someone@mail.io");
      }
      const x = daddy.children[1];
      x.parent = null;
      x.parent = daddy;
      t.is(daddy.name, "John Smith");
      t.is(daddy.age, 45);
      t.is(daddy.children.length, 3);
    });
    t.is(app.render.rcache.isOutdated, false);
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    tran1.commit(); // changes are applied, reactions are outdated/recomputed
    t.is(app.render.rcache.isOutdated, false);
    t.not(app.render.rcache.stamp, stamp);
    t.is(daddy.name, "John Smith");
    t.is(daddy.age, 45);
    // Protection from modification outside of action
    t.throws(() => {
      if (daddy.emails)
        daddy.emails.push("dad@mail.com");
    });
    t.throws(() => tran1.run(/* istanbul ignore next */ () => { /* nope */ }));
    // Undo action
    tran1.undo();
    t.is(daddy.name, "John");
    t.is(daddy.age, 38);
    // Check protection
    t.throws(() => { daddy.setParent.rcache.configure({latency: 0}); });
    t.throws(() => { console.log(daddy.setParent.rcache.config.monitor); });
  }
  finally { // cleanup
    ReactiveCache.unmount(app, app.model);
  }
  const n: number = Math.max(output.length, expected.length);
  for (let i = 0; i < n; i++)
    t.is(output[i], expected[i]);
});
