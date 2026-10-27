import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalEvidence } from "./evidence.mjs";
test("replay compares immutable identities and values independently of unordered SQL scans", () => {
  const before = {
    payments: 178,
    receipts: [
      { id: "r1", hash: "a" },
      { id: "r2", hash: "b" },
    ],
    orders: [{ id: "o1", tickets: [{ id: "k" }, { id: "b" }] }],
  };
  const shuffled = {
    orders: [{ tickets: [{ id: "b" }, { id: "k" }], id: "o1" }],
    receipts: [
      { hash: "b", id: "r2" },
      { hash: "a", id: "r1" },
    ],
    payments: 178,
  };
  assert.deepEqual(canonicalEvidence(before), canonicalEvidence(shuffled));
  for (const altered of [
    { ...shuffled, payments: 179 },
    {
      ...shuffled,
      receipts: [
        { id: "r1", hash: "changed" },
        { id: "r2", hash: "b" },
      ],
    },
    {
      ...shuffled,
      orders: [{ id: "duplicate", tickets: [{ id: "k" }, { id: "b" }] }],
    },
  ])
    assert.notDeepEqual(canonicalEvidence(before), canonicalEvidence(altered));
});
