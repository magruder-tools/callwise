import {
  errorBanner,
  banner,
  escape,
  button,
  icon,
} from "../components/common.mjs";
import { card } from "../components/card.mjs";
import { shortcutLabel } from "../shortcuts.mjs";
import { describeAudioCapture } from "../capture.mjs";
import { meters } from "../components/meters.mjs";
export function live(s, ui) {
  const own = (r) =>
    r.channel === "mic" ||
    ["you", "me", (s.settings.userName || "").toLowerCase()].includes(
      r.speaker.toLowerCase(),
    );
  const caption = s.transcript.filter((r) => !r.gap && !own(r)).at(-1);
  const reconnect = Object.values(s.capture).includes("reconnecting");
  const failed = Object.values(s.capture).includes("failed");
  const status =
    s.status === "paused"
      ? "Paused"
      : reconnect
        ? "Reconnecting"
        : s.connecting || failed
          ? "Waiting"
          : "Listening";
  return `<main class="live-view"><header data-region="status" class="live-status" title="${escape(describeAudioCapture(s.capture))}"><span class="status ${s.thinking.fast ? "checking" : ""} ${s.status === "running" && !reconnect ? "on" : "waiting"}"><i class="light"></i>${status}</span><time id="call-time">00:00</time>${meters()}<div class="live-actions">${button(s.status === "paused" ? "resume" : "pause", "", { iconName: s.status === "paused" ? "play" : "pause", title: s.status === "paused" ? "Resume listening" : "Pause", className: "icon-button" })}${button("end", "End", { title: "End call", className: "end" })}${button("settings", "", { iconName: "settings", title: "Settings", className: "icon-button" })}</div></header><div data-region="notice">${errorBanner(s) || (ui.notice ? banner(ui.notice, "dismiss-notice", "Dismiss") : "")}</div><div data-region="card" class="card-region">${failed ? button("retry-audio", "Retry audio", { className: "text-button" }) : ""}${s.source === "demo" ? '<p class="sample-label">Sample call. No recording or API calls.</p>' : ""}${s.prep?.myPoints?.length ? `<div class="coverage">${button("coverage", `${s.covered.length} of ${s.prep.myPoints.length} covered`, { className: "text-button" })}${ui.coverage ? `<ul>${s.prep.myPoints.map((p) => `<li class="${s.covered.includes(p.id) ? "covered" : ""}">${escape(p.text)}</li>`).join("")}</ul>` : ""}</div>` : ""}${card(s, ui)}</div><div data-region="caption"><button type="button" class="caption" data-action="transcript" aria-expanded="${ui.transcript}"><span>Them</span> ${escape(caption?.text || "Their latest words will appear here.")}</button>${
    ui.transcript
      ? `<section class="transcript-inline" aria-label="Transcript">${s.transcript
          .slice(-40)
          .map(
            (r) =>
              `<p data-row-id="${escape(r.id)}" class="${r.gap ? "gap" : ""}"><strong>${escape(r.speaker)}</strong> ${escape(r.text)}${!r.final ? "…" : ""}</p>`,
          )
          .join("")}${
          s.cards.some((c) => c.late)
            ? `<h3>Late suggestions</h3>${s.cards
                .filter((c) => c.late)
                .map((c) => `<p>${escape(c.lead)} <small>Late</small></p>`)
                .join("")}`
            : ""
        }</section>`
      : ""
  }</div><form data-region="ask" id="ask-form" class="ask-row"><label for="question" class="sr-only">Ask anything</label><input id="question" name="question" placeholder="Ask anything" maxlength="3000" autocomplete="off"><button type="submit" class="icon-button" aria-label="Ask question">${icon("send")}</button>${button("help", `Help me now ${shortcutLabel(s.preferences.hotkeys?.help)}`, { className: "help-now", title: `Help me now · ${s.preferences.hotkeys?.help || "Control+Alt+Space"}` })}</form>${s.preferences.debug ? debug(s) : ""}</main>`;
}
function debug(s) {
  const values = s.latencies
      .filter((x) => x.firstPaintAt !== null)
      .map((x) => x.firstPaintAt - x.turnEndedAt)
      .sort((a, b) => a - b),
    last = s.latencies.at(-1);
  return `<aside class="debug">First words: ${last ? Math.round(last.firstPaintAt - last.turnEndedAt) : "–"} ms · median ${values.length ? Math.round(values[Math.floor(values.length / 2)]) : "–"} ms · ${s.metrics.fastCalls} fast / ${s.metrics.strategyCalls} deep</aside>`;
}
