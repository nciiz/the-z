const { test } = require("node:test");
const assert = require("node:assert");
const { buildSqlWhere } = require("../shared/dist/db/sql.js");

test("buildSqlWhere: key_id clause for guildId index", () => {
  const q = buildSqlWhere({ guildId: "111111111111111111" }, "guildId");
  assert.ok(q.where.includes("key_id = $1"));
  assert.deepEqual(q.params, ["111111111111111111"]);
});

test("buildSqlWhere: $in → existence + ANY(text[])", () => {
  const q = buildSqlWhere({ guildId: "G", userId: { $in: ["u1", "u2"] } }, "guildId");
  assert.ok(q.where.includes("data ? $2"));
  assert.ok(q.where.includes("data->>'userId' = ANY($3::text[])"));
  assert.deepEqual(q.params, ["G", "userId", ["u1", "u2"]]);
});

test("buildSqlWhere: $nin → NOT(existence AND any)", () => {
  const q = buildSqlWhere({ userId: { $nin: ["u1"] } }, "guildId");
  assert.ok(q.where.includes("NOT ("));
  assert.ok(q.where.includes("= ANY($2::text[])"));
});

test("buildSqlWhere: $nin empty → NOT exists", () => {
  const q = buildSqlWhere({ userId: { $nin: [] } });
  assert.ok(q.where.includes("NOT (data ? $1)"));
});

test("buildSqlWhere: numeric range uses float cast (exact order semantics)", () => {
  const q = buildSqlWhere({ totalXp: { $gt: 100 } }, "guildId");
  assert.ok(/::float8 > \$3/.test(q.where));
  assert.ok(q.where.includes("~ $2"));
  assert.deepEqual(q.params, ["totalXp", "^-?\\d+(\\.\\d+)?$", 100]);

  const lt = buildSqlWhere({ totalXp: { $lt: 10 } }, "guildId");
  assert.ok(lt.where.includes("::float8 < $") && lt.params[2] === 10);
});

test("buildSqlWhere: string comparison stays text", () => {
  const q = buildSqlWhere({ name: { $eq: "zed" } });
  assert.ok(q.where.includes("data->>'name' = $2"));
  assert.deepEqual(q.params, ["name", "zed"]);
});

test("buildSqlWhere: $ne NOT() semantics (missing included)", () => {
  const q = buildSqlWhere({ status: { $ne: "open" } });
  assert.ok(q.where.includes("NOT ("));
});

test("buildSqlWhere: null value → IS NULL with existence", () => {
  const q = buildSqlWhere({ channelId: null });
  assert.ok(q.where.includes("data ? $1"));
  assert.ok(q.where.includes("IS NULL"));
});

test("buildSqlWhere: _id is left to JS (stored outside JSONB)", () => {
  const q = buildSqlWhere({ _id: "row-id", guildId: "G" }, "guildId");
  assert.ok(!q.where.includes("data->>'_id'"));
  assert.ok(q.where.includes("key_id = $1"));
  assert.deepEqual(q.params, ["G"]);
});

test("buildSqlWhere: UUID _id maps to the id column", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const q = buildSqlWhere({ _id: id, guildId: "G" }, "guildId");
  assert.ok(q.where.includes("id = $2"));
  assert.ok(!q.where.includes("data->>'_id'"));
  assert.deepEqual(q.params, ["G", id]);
});

test("buildSqlWhere: dot paths left to JS stage (not in SQL)", () => {
  const q = buildSqlWhere({ "selfRoles.id": "abc", guildId: "G" }, "guildId");
  assert.ok(!q.where.includes("selfRoles"));
  assert.ok(q.where.includes("key_id = $1"));
});

test("buildSqlWhere: unknown operator left to JS (no SQL)", () => {
  const q = buildSqlWhere({ guildId: "G", text: { $regex: "z" } }, "guildId");
  assert.equal(q.where, "key_id = $1");
  assert.deepEqual(q.params, ["G"]);
});

test("buildSqlWhere: empty filter → no WHERE", () => {
  const q = buildSqlWhere({});
  assert.equal(q.where, "");
  assert.deepEqual(q.params, []);
});

test("buildSqlWhere: non-simple keys (dots) are never interpolated (injection safety)", () => {
  const q = buildSqlWhere({ "x; DROP TABLE guild_configs;--": "1" });
  assert.equal(q.where, "");
});