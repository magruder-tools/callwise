import test from "node:test";
import assert from "node:assert/strict";
import { SuggestionFocus } from "../ui/suggestion-focus.mjs";
const card = (id, more = {}) => ({
  id,
  lane: "fast",
  origin: "auto",
  status: "new",
  expiresAt: 0,
  ...more,
});
test("new arrivals become current and ordinary snapshots preserve a history selection", () => {
  const f = new SuggestionFocus(),
    a = card("a");
  f.sync("s", [a]);
  f.sync("s", [a, card("b"), card("c")]);
  assert.equal(f.current.fast.id, "c");
  assert.equal(f.pending("fast").length, 0);
  f.select("fast", "a");
  f.sync("s", [a, card("b"), card("c")]);
  assert.equal(f.current.fast.id, "a");
  f.sync("s", [a, card("b"), card("c"), card("d")]);
  assert.equal(f.current.fast.id, "d");
  f.navigate("fast", "previous");
  assert.equal(f.current.fast.id, "c");
  f.navigate("fast", "next");
  assert.equal(f.current.fast.id, "d");
});
test("kept cards survive proactive arrivals but typed questions and help hotkeys always become current", () => {
  const f = new SuggestionFocus(),
    a = card("a", { status: "accepted" });
  f.sync("s", [a]);
  f.sync("s", [a, card("b")]);
  assert.equal(f.current.fast.id, "a");
  assert.equal(f.pending("fast").length, 1);
  f.sync("s", [a, card("b"), card("typed", { origin: "asked" })]);
  assert.equal(f.current.fast.id, "typed");
  assert.equal(f.pending("fast").length, 0);
  f.sync("s", [
    a,
    card("typed", { origin: "asked", status: "accepted" }),
    card("hotkey", { origin: "hotkey" }),
  ]);
  assert.equal(f.current.fast.id, "hotkey");
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
