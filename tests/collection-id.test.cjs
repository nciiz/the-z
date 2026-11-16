const { test } = require("node:test");
const assert = require("node:assert");

/**
 * اختبار عزل `_id` داخل طبقة Collection:
 * - `_id` يُخزَّن في عمود الصف وليس داخل JSONB.
 * - التحديث/الحذف يجب أن يطابق `_id` مع `guildId` معًا.
 * - محاولة تعديل صف سيرفر آخر بمعرّف الصف لا تنجح.
 */
test("Collection: _id matching stays scoped to guildId", async (t) => {
  const poolModule = require("../shared/dist/db/pool.js");
  const originalGetPool = poolModule.getPool;

  const tables = new Map();
  const rowsFor = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };

  const fakePool = {
    async query(sql, params = []) {
      const insert = sql.match(/INSERT INTO (\w+)/i);
      if (insert) {
        const table = insert[1];
        rowsFor(table).push({ id: params[0], key_id: params[1], data: JSON.parse(params[2]) });
        return { rows: [] };
      }

      const select = sql.match(/SELECT id, data FROM (\w+)/i);
      if (select) {
        return { rows: rowsFor(select[1]).map(({ id, data }) => ({ id, data })) };
      }

      const update = sql.match(/UPDATE (\w+)/i);
      if (update) {
        const row = rowsFor(update[1]).find((r) => r.id === params[2]);
        if (row) {
          row.data = JSON.parse(params[0]);
          row.key_id = params[1];
        }
        return { rows: [] };
      }

      const del = sql.match(/DELETE FROM (\w+)/i);
      if (del) {
        const table = del[1];
        tables.set(table, rowsFor(table).filter((r) => r.id !== params[0]));
        return { rows: [] };
      }

      return { rows: [] };
    }
  };

  poolModule.getPool = () => fakePool;
  t.after(() => {
    poolModule.getPool = originalGetPool;
  });

  const { Collection } = require("../shared/dist/db/collection.js");
  const items = new Collection("test_isolation_items", "guildId", () => ({}));

  const a = await items.create({ guildId: "guild-a", name: "a" });
  const b = await items.create({ guildId: "guild-b", name: "b" });

  assert.equal(await items.countDocuments({ _id: b._id }), 1);

  // محاولة تعديل صف السيرفر B مع تمرير guildId الخاص بالسيرفر A
  await items.findOneAndUpdate(
    { _id: b._id, guildId: "guild-a" },
    { $set: { name: "leaked" } }
  );
  const untouchedB = await items.findOne({ guildId: "guild-b" });
  assert.equal(untouchedB.name, "b");

  // التعديل الصحيح داخل نفس السيرفر يعمل
  await items.findOneAndUpdate(
    { _id: b._id, guildId: "guild-b" },
    { $set: { name: "b2" } }
  );
  const updatedB = await items.findOne({ guildId: "guild-b" });
  assert.equal(updatedB.name, "b2");

  // الحذف بمعرّف صف سيرفر آخر لا يحذف شيئًا
  await items.deleteOne({ _id: a._id, guildId: "guild-b" });
  assert.ok(await items.findOne({ guildId: "guild-a" }));

  // الحذف الصحيح داخل السيرفر يعمل
  await items.deleteOne({ _id: a._id, guildId: "guild-a" });
  assert.equal(await items.findOne({ guildId: "guild-a" }), null);
});
