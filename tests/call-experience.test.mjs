import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { CoachEngine } from "../core/engine.mjs";
import { CallController } from "../core/controller.mjs";
import { latestFamilyModel, resolveLatestModels } from "../core/model-routing.mjs";
import { sanitizeConnections } from "../core/connections.mjs";
import { OpenAIProvider } from "../providers/openai.mjs";
import { coachingFeed } from "../ui/components/coaching-feed.mjs";
import { renderRegions } from "../ui/render.mjs";
const tick = () => new Promise((r) => setImmediate(r));
const answer = { speak: true, kind: "say", lead: "I’d start by checking the actual business result.", points: [], sourceIds: [], covers: [] };
const segment = (id, text, final = true) => ({ id, text, final, speaker: "Interviewer", channel: "system" });

test("latest routing chooses stable family releases numerically and never picks another family", async () => {
  const ids = ["gpt-6-luna", "gpt-6.2-sol", "gpt-6.10-sol", "gpt-7-astra", "gpt-8-sol-preview", "gpt-9-sol-2027-01-01", "gpt-6.1-sol"];
  assert.equal(latestFamilyModel(ids, "sol"), "gpt-6.10-sol");
  assert.equal(latestFamilyModel(ids, "luna"), "gpt-6-luna");
  let requests = 0;
  const config = { openaiKey: "TEST_ONLY", autoLatestModels: true, fastModel: "old-luna", strategyModel: "old-sol", serviceTier: "fast" };
  const resolved = await resolveLatestModels(config, { fetchImpl: async () => { requests++; return Response.json({ data: ids.map((id) => ({ id })) }); } });
  assert.equal(resolved.strategyModel, "gpt-6.10-sol");
  assert.equal(resolved.serviceTier, "fast");
  const pinned = await resolveLatestModels({ ...config, autoLatestModels: false }, { fetchImpl: async () => { throw new Error("Must not request"); } });
  assert.equal(pinned.strategyModel, "old-sol");
  const offline = await resolveLatestModels(config, { fetchImpl: async () => { throw new Error("Offline"); } });
  assert.equal(offline.strategyModel, "old-sol");
  assert.match(offline.modelUpdateWarning, /Couldn’t check/);
  assert.equal(requests, 1);
  assert.equal(sanitizeConnections({ serviceTier: "fast", autoLatestModels: true }).serviceTier, "fast");
  assert.throws(() => sanitizeConnections({ serviceTier: "ultrafast" }));
});

test("both application lanes and auxiliary requests carry the chosen models and Fast tier", async () => {
  const c = new CallController({ config: { openaiKey: "TEST_ONLY", fastModel: "gpt-6-luna", strategyModel: "gpt-6.1-sol", serviceTier: "fast" }, preferences: { liveHelp: true } });
  try {
    c.mode = "manual"; c.setProviders();
    assert.equal(c.engine.providers.fast.model, "gpt-6-luna");
    assert.equal(c.engine.providers.strategy.model, "gpt-6.1-sol");
    assert.equal(c.engine.providers.fast.serviceTier, "fast");
    assert.equal(c.engine.providers.strategy.serviceTier, "fast");
    assert.equal(c.auxiliary().serviceTier, "fast");
    let body;
    const p = new OpenAIProvider({ model: "gpt-6.1-sol", serviceTier: "fast", apiKey: "TEST_ONLY", fetchImpl: async (_url, options) => {
      body = JSON.parse(options.body);
      return Response.json({ output_text: JSON.stringify(answer), model: "gpt-6.1-sol", service_tier: "default" });
    } });
    const result = await p.generate({ prompt: { input: "Synthetic test" } });
    assert.equal(body.service_tier, "fast");
    assert.equal(body.reasoning.effort, "low");
    assert.equal(result.serviceTier, "default", "actual service downgrade is reported honestly");
  } finally { c.close(); }
});

test("call coaching waits for complete speech and a quiet gap, then combines continued sentences", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const c = new CallController();
  const e = c.engine, prompts = [];
  e.providers.fast = { generate: async ({ prompt }) => { prompts.push(JSON.parse(prompt.input)); return answer; } };
  e.config.autoCoach = true;
  e.start();
  e.ingest(segment("a", "How would you deal with an unhappy client?", false));
  t.mock.timers.tick(2000); await tick();
  assert.equal(prompts.length, 0, "a question-looking partial must not start help");
  e.ingest(segment("a", "How would you deal with an unhappy client?"));
  t.mock.timers.tick(1100); await tick();
  assert.equal(prompts.length, 0);
  e.ingest(segment("b", "Especially when their leads are up but sales are flat.", false));
  t.mock.timers.tick(2000); await tick();
  assert.equal(prompts.length, 0, "continued speech resets the quiet gap");
  e.ingest(segment("b", "Especially when their leads are up but sales are flat."));
  t.mock.timers.tick(1399); await tick(); assert.equal(prompts.length, 0);
  t.mock.timers.tick(1); await tick();
  assert.equal(prompts.length, 1);
  assert.match(prompts[0].trigger.text, /unhappy client\?.*sales are flat/);
  c.close();
});

test("manual help stays immediate and pause cancels queued automatic advice", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let requests = 0;
  const e = new CoachEngine({ config: { turnPauseMs: 1400, speculatePartials: false }, providers: { fast: { generate: async () => { requests++; return answer; } } } });
  e.start(); e.ingest(segment("a", "How would you prioritize the accounts?"));
  await e.run("fast", "Help me now", { origin: "asked" });
  assert.equal(requests, 1);
  t.mock.timers.tick(2000); await tick(); assert.equal(requests, 1);
  e.ingest(segment("b", "What would you do next?")); e.pause();
  t.mock.timers.tick(2000); await tick(); assert.equal(requests, 1);
  e.end();
});

test("history keeps older questions, source disclosures and reading position when new answers arrive", () => {
  const { document } = parseHTML('<main id="root"></main>');
  const root = document.getElementById("root");
  const state = { status: "running", thinking: {}, cards: [{ id: "first", origin: "auto", lane: "fast", status: "new", lead: "A complete first sentence.", trigger: { kind: "question", text: "What did you actually do for this client?" }, points: [{ label: "My part", text: "A specific contribution" }], sources: [{ id: "src", title: "My notes", excerpt: "Verified evidence" }] }] };
  renderRegions(root, coachingFeed(state));
  const old = root.querySelector('[data-card-id="first"]');
  const history = root.querySelector(".coaching-history");
  Object.defineProperties(history, { scrollHeight: { value: 1500, configurable: true }, clientHeight: { value: 400 } });
  history.scrollTop = 160;
  old.querySelector("details").setAttribute("open", "");
  state.cards.push({ id: "second", lane: "strategy", status: "new", lead: "A deeper second thought.", more: "One useful tradeoff." });
  renderRegions(root, coachingFeed(state));
  assert.equal(root.querySelector('[data-card-id="first"]'), old);
  assert.equal(history.scrollTop, 160);
  assert.ok(old.querySelector("details").hasAttribute("open"));
  assert.equal(root.querySelectorAll(".history-card").length, 2);
  assert.match(root.textContent, /What did you actually do/);
  assert.match(root.textContent, /Deeper advice/);
});
