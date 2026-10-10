import assert from "node:assert/strict";
import { app } from "electron";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";
const advice = {
  speak: true,
  kind: "say",
  lead: "Start with the real example, explain your actions, and put the measured result in context.",
  points: [
    {
      label: "Situation",
      text: "Explain the starting point and the original constraint from the notes.",
    },
    {
      label: "Action",
      text: "Describe the specific changes you made and why those changes mattered.",
    },
    {
      label: "Result",
      text: "Use the actual numbers and explain how the result was measured.",
    },
  ],
  sourceIds: [],
  covers: [],
};
export async function verifyPanel({ controller, panel, win, artifacts }) {
  const engine = controller.engine;
  const js = (source) => panel.webContents.executeJavaScript(source);
  const capture = async (name) =>
    writeFileSync(
      path.join(artifacts, name + ".png"),
      (await panel.webContents.capturePage()).toPNG(),
    );
  await controller.command("start", { source: "demo" });
  controller.stopInputs();
  engine.settings.quiet = true;
  engine.prep = null;
  engine.cards = [];
  engine.transcript.clear();
  engine.source = "manual";
  engine.emitState();
  await wait(250);
  panel.setSize(440, 232);
  await wait(250);
  const quietHeight = panel.getBounds().height;
  assert.ok(quietHeight <= 240, `Quiet height: ${quietHeight}`);
  await capture("quiet");
  engine.providers.fast = { generate: async () => advice };
  await engine.run("fast", "Tell me about an example.");
  await wait(250);
  await capture("arriving");
  const current = engine.cards.at(-1);
  current.sources = [
    {
      id: "a",
      title: "Approved example",
      excerpt: "Synthetic source evidence.",
    },
    {
      id: "b",
      title: "Measurement notes",
      excerpt: "Synthetic measurement details.",
    },
  ];
  engine.cards.push({
    id: "slow",
    lane: "strategy",
    status: "new",
    lead: "Keep the outcome in the context of the original constraint.",
  });
  for (const width of [340, 440, 640]) {
    panel.setSize(width, panel.getBounds().height);
    engine.emitState();
    await wait(300);
    const result = await js(`(() => {
      const nodes = [...document.querySelectorAll('.lead,.points li,.bigger-picture summary,.sources summary,.ask-row,.live-status')];
      return { overflow: document.documentElement.scrollWidth > innerWidth + 1, clipped: nodes.filter(n => { const r=n.getBoundingClientRect(); return r.bottom>innerHeight+1||r.right>innerWidth+1||r.top<0; }).map(n=>n.textContent) };
    })()`);
    assert.equal(result.overflow, false, `${width}px overflow`);
    assert.deepEqual(result.clipped, [], `${width}px full content clipped`);
    await capture(`full-${width}`);
  }
  panel.setSize(440, panel.getBounds().height);
  engine.emitState();
  await wait(250);
  const earlier = panel.getBounds();
  engine.error("A temporary audio interruption.", {
    condition: "capture:system",
    lifetimeMs: null,
  });
  for (let i = 0; i < 20; i++) {
    engine.emitState();
    await wait(20);
  }
  await wait(150);
  const noticeHeight = await js(
    `document.querySelector('[data-region="notice"]').getBoundingClientRect().height`,
  );
  assert.ok(
    Math.abs(panel.getBounds().height - earlier.height - noticeHeight) <= 2,
    "notice height accumulates",
  );
  assert.equal(panel.getBounds().y, earlier.y, "top edge moved");
  await capture("notice");
  engine.clearErrors();
  await wait(250);
  assert.ok(
    Math.abs(panel.getBounds().height - earlier.height) <= 2,
    "notice did not shrink",
  );
  for (let i = 0; i < 50; i++)
    engine.ingest({
      id: `row-${i}`,
      speaker: "Them",
      text: `Recorded sentence ${i}.`,
      startMs: i * 2000,
    });
  await js(`document.querySelector('[data-action="transcript"]').click()`);
  await wait(200);
  assert.equal(
    await js(`document.querySelectorAll('.transcript-inline > p').length`),
    40,
  );
  await js(`document.querySelector('.transcript-inline').scrollTop = 20`);
  engine.ingest({
    id: "partial",
    speaker: "Them",
    text: "A continuing partial remark",
    final: false,
    startMs: 100000,
  });
  await wait(100);
  assert.equal(
    await js(`document.querySelector('.transcript-inline').scrollTop`),
    20,
    "transcript scroll jumped",
  );
  await capture("transcript-open");
  await js(`document.querySelector('[data-action="transcript"]').click()`);
  await wait(250);
  assert.ok(
    Math.abs(panel.getBounds().height - earlier.height) <= 2,
    "transcript did not shrink",
  );
  // Native synthetic input requires a key window, unlike renderer DOM clicks.
  // showInactive() deliberately keeps the real call panel from stealing focus.
  if (process.platform === "darwin") app.focus({ steal: true });
  await wait(100);
  win.hide();
  panel.show();
  panel.focus();
  panel.webContents.focus();
  await wait(100);
  assert.equal(
    panel.isFocused(),
    true,
    "Native input test needs a focused panel",
  );
  console.log("Smoke: panel focused for native input acceptance.");
  await js(
    `window.__stableCard=document.querySelector('.coach-card'); window.__animations=0; window.__opacities=[]; window.__stableCard.addEventListener('animationstart',()=>window.__animations++); window.__opacityTimer=setInterval(()=>window.__opacities.push(getComputedStyle(window.__stableCard).opacity),16); const q=document.querySelector('#question');q.value='Keep my selection';q.focus();q.select();`,
  );
  let updates = 0;
  const talker = setInterval(
    () =>
      engine.ingest({
        id: "partial",
        speaker: "Them",
        text: `A continuing partial remark ${updates++}`,
        final: false,
        startMs: 100000,
      }),
    125,
  );
  const originalCommand = controller.command;
  let pins = 0;
  controller.command = function (name, payload) {
    if (name === "card.pin") pins++;
    return originalCommand.call(this, name, payload);
  };
  try {
    await wait(600);
    assert.deepEqual(
      await js(
        `(() => { const q=document.querySelector('#question');return [q.selectionStart,q.selectionEnd]; })()`,
      ),
      [0, 17],
    );
    for (let i = 0; i < 40; i++) {
      const p = await js(
        `(() => { const r=document.querySelector('[data-action="pin"]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`,
      );
      panel.webContents.sendInputEvent({
        type: "mouseDown",
        ...p,
        button: "left",
        clickCount: 1,
      });
      await wait(90);
      panel.webContents.sendInputEvent({
        type: "mouseUp",
        ...p,
        button: "left",
        clickCount: 1,
      });
      await wait(10);
    }
    assert.equal(pins, 40, `native presses lost: ${pins}/40 registered`);
    const stability = await js(
      `(() => { clearInterval(window.__opacityTimer); return {same:window.__stableCard===document.querySelector('.coach-card'), animations:window.__animations, opaque:window.__opacities.every(x=>x==='1')}; })()`,
    );
    assert.deepEqual(stability, { same: true, animations: 0, opaque: true });
  } finally {
    clearInterval(talker);
    controller.command = originalCommand;
  }
  await wait(200);
  let finish;
  engine.providers.fast = {
    generate: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  };
  const before = await js(
    `document.querySelector('[data-region="card"]').innerHTML`,
  );
  const checking = engine.run("fast", "", {
    origin: "auto",
    trigger: { speaker: "Them", text: "A remark", kind: null },
  });
  await wait(100);
  await capture("checking-quietly");
  assert.equal(
    await js(`document.querySelector('[data-region="card"]').innerHTML`),
    before,
  );
  await wait(1500);
  finish({ speak: false });
  await checking;
  await wait(100);
  assert.equal(
    await js(`document.querySelector('[data-region="card"]').innerHTML`),
    before,
  );
  engine.providers.fast = {
    generate: async ({ onPartial }) => {
      for (let i = 1; i <= 60; i++) {
        onPartial({ ...advice, lead: advice.lead.slice(0, i) });
        await wait(17);
      }
      return advice;
    },
  };
  const streaming = engine.run("fast", "Explain my real actions.");
  await wait(150);
  await js(
    `window.__streamOpacity=[];window.__streamTimer=setInterval(()=>{const n=document.querySelector('.coach-card.streaming');if(n) window.__streamOpacity.push(getComputedStyle(n).opacity);},16);`,
  );
  await streaming;
  assert.equal(
    await js(
      `(() => {clearInterval(window.__streamTimer);return window.__streamOpacity.length>20&&window.__streamOpacity.every(x=>x==='1');})()`,
    ),
    true,
  );
  engine.error("Five-second notice.", { lifetimeMs: 5000 });
  await wait(5200);
  assert.equal(
    await js(`document.body.textContent.includes('Five-second notice.')`),
    false,
  );
  await controller.command("pause");
  await js(`document.querySelector('[data-action="resume"]').click()`);
  await wait(200);
  const clean =
    "The browser demo does not connect to accounts or record audio. Open the desktop app for live mode.";
  assert.equal(
    await js(
      `document.body.textContent.split(${JSON.stringify(clean)}).length-1`,
    ),
    1,
  );
  assert.equal(
    await js(
      `document.body.textContent.includes('Error invoking remote method')`,
    ),
    false,
  );
  await controller.command("new", { clearContext: true });
  console.log(
    "Panel acceptance passed: quiet sizing, full cards at three widths, shrink after notices/transcript, 40/40 native presses, stable selection/card/opacity, quiet checks, streaming and timed expiry.",
  );
}
export async function verifyReady({ controller, panel, win, artifacts }) {
  const capture = async (window, name) =>
    writeFileSync(
      path.join(artifacts, name + ".png"),
      (await window.webContents.capturePage()).toPNG(),
    );
  const js = (source) => win.webContents.executeJavaScript(source);
  win.showInactive();
  for (let i = 0; i < 8; i++)
    await controller.command("context.add", {
      title: `Evidence ${i + 1} with a long explanatory filename.pdf`,
      text: `Synthetic evidence item ${i + 1}.`,
    });
  for (const [width, height] of [
    [720, 560],
    [580, 480],
  ]) {
    win.setSize(width, height);
    await wait(200);
    assert.equal(
      await js(
        `['consent','start'].every(id=>{const r=document.getElementById(id).getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;})`,
      ),
      true,
    );
    await capture(win, `ready-crowded-${width}`);
  }
  win.setSize(720, 560);
  await js(
    `window.__goal=document.querySelector('#goal');window.__goal.value='Keep my goal draft';window.__goal.focus();window.__goal.select();`,
  );
  controller.engine.error("A temporary preparation notice.");
  await wait(100);
  assert.equal(
    await js(
      `window.__goal===document.querySelector('#goal')&&window.__goal.value==='Keep my goal draft'&&window.__goal.selectionEnd===18`,
    ),
    true,
  );
  controller.engine.clearErrors();
  const demoOnly = controller.demoOnly,
    config = controller.config,
    factory = controller.transcriberFactory;
  controller.demoOnly = false;
  controller.config = { ...config, openaiKey: "SMOKE_TEST_ONLY" };
  try {
    controller.transcriberFactory = (options) => ({
      connect: async () => {
        const error = Object.assign(
          new Error("OpenAI didn't accept this key."),
          { action: "replace-key" },
        );
        options.onStatus("failed", error);
        throw error;
      },
      close() {},
    });
    await js(
      `document.querySelector('#consent').click();document.querySelector('#start').click();`,
    );
    await wait(200);
    assert.equal(controller.connecting, false);
    assert.equal(
      await js(
        `document.body.textContent.split("OpenAI didn't accept this key.").length-1`,
      ),
      1,
    );
    assert.equal(await js(`document.querySelector('#start').disabled`), false);
    await capture(win, "start-wrong-key");
    controller.engine.clearErrors();
    controller.transcriberFactory = (options) => ({
      connect: async () => {
        const error = new Error(
          "Couldn't reach OpenAI. Check your internet connection.",
        );
        options.onStatus("failed", error);
        throw error;
      },
      close() {},
    });
    await js(`document.querySelector('#start').click()`);
    await wait(200);
    assert.equal(controller.connecting, false);
    await capture(win, "start-no-internet");
    controller.engine.clearErrors();
    controller.transcriberFactory = () => {
      let finish;
      return {
        connect: () =>
          new Promise((r) => {
            finish = r;
          }),
        close() {
          finish?.();
        },
      };
    };
    await js(`document.querySelector('#start').click()`);
    await wait(150);
    assert.equal(
      await js(`document.querySelector('[data-action="cancel-start"]')!==null`),
      true,
    );
    await capture(win, "start-connecting-cancel");
    await js(`document.querySelector('[data-action="cancel-start"]').click()`);
    await wait(100);
    assert.equal(controller.connecting, false);
  } finally {
    controller.demoOnly = demoOnly;
    controller.config = config;
    controller.transcriberFactory = factory;
  }
  await controller.command("new", { clearContext: true });
  await controller.command("configure", {
    goal: "My real interview setup",
    mode: "interview",
  });
  await controller.command("context.add", {
    title: "My real notes",
    text: "Verified original experience.",
  });
  await wait(200);
  await capture(win, "practice-before");
  await controller.command("practice");
  await wait(200);
  await capture(panel, "practice-sample");
  await controller.command("end");
  await wait(100);
  await controller.command("new", { clearContext: true });
  await wait(200);
  assert.equal(controller.engine.settings.goal, "My real interview setup");
  assert.equal(controller.engine.context.list()[0].title, "My real notes");
  await capture(win, "practice-restored");
  console.log(
    "Ready acceptance passed: crowded controls visible at two sizes, stable goal selection, single clean wrong-key message, no-internet recovery, Cancel, and Practice restoration.",
  );
}
