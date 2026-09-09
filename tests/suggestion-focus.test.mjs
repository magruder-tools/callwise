import test from "node:test";
import assert from "node:assert/strict";
import { SuggestionFocus } from "../ui/suggestion-focus.mjs";
const card = (id, more = {}) => ({
  id,
  lane: "fast",
  status: "new",
  expiresAt: 0,
  ...more,
});
test("reading survives expiry, new arrivals, and ordinary snapshots", () => {
  const f = new SuggestionFocus();
  const a = card("a");
  f.sync("s", [a]);
  f.sync("s", [a, card("b"), card("c")]);
  assert.equal(f.current.fast.id, "a");
  assert.equal(f.pending("fast").length, 2);
  f.advance("fast");
  assert.equal(f.current.fast.id, "c");
  assert.equal(f.pending("fast").length, 0);
  f.select("fast", "a");
  f.sync("s", [a, card("b"), card("c")]);
  assert.equal(f.current.fast.id, "a");
});
test("feedback and new sessions do not resurrect dismissed or previous-session advice", () => {
  const f = new SuggestionFocus();
  f.sync("s", [card("a")]);
  f.sync("s", [card("a", { status: "dismissed" }), card("b")]);
  assert.equal(f.current.fast.id, "b");
  f.sync("s", [card("b", { status: "accepted" })]);
  assert.equal(f.current.fast.status, "accepted");
  f.dismiss("fast");
  f.sync("s", [card("b", { status: "accepted" })]);
  assert.equal(f.current.fast, null);
  f.sync("new", []);
  assert.equal(f.current.fast, undefined);
  assert.equal(f.pending("fast").length, 0);
});
