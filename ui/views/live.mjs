import { escape, button, icon } from "../components/common.mjs";
import { card } from "../components/card.mjs";
import { meters } from "../components/meters.mjs";
export function live(s, ui) {
  const own = (r) =>
    r.channel === "mic" ||
    [
      "you",
      "matt",
      "matthew",
      "me",
      (s.settings.userName || "").toLowerCase(),
    ].includes(r.speaker.toLowerCase());
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
  return `<main class="live-view"><header class="live-status"><span class="status ${s.status === "running" && !reconnect ? "on" : "waiting"}"><i class="light"></i>${status}</span><time id="call-time">00:00</time>${meters()}<div class="live-actions">${button(s.status === "paused" ? "resume" : "pause", "", { iconName: s.status === "paused" ? "play" : "pause", title: s.status === "paused" ? "Resume listening" : "Pause", className: "icon-button" })}${button("end", "", { iconName: "end", title: "End call", className: "icon-button end" })}${button("settings", "", { iconName: "settings", title: "Settings", className: "icon-button" })}</div></header>${failed ? button("retry-audio", "Retry audio", { className: "text-button" }) : ""}${s.source === "demo" ? '<p class="sample-label">Sample call. No recording or API calls.</p>' : ""}${s.prep?.myPoints?.length ? `<div class="coverage">${button("coverage", `${s.covered.length} of ${s.prep.myPoints.length} covered`, { className: "text-button" })}${ui.coverage ? `<ul>${s.prep.myPoints.map((p) => `<li class="${s.covered.includes(p.id) ? "covered" : ""}">${escape(p.text)}</li>`).join("")}</ul>` : ""}</div>` : ""}${card(s, ui)}<button type="button" class="caption" data-action="transcript" aria-expanded="${ui.transcript}"><span>Them</span> ${escape(caption?.text || "Their latest words will appear here.")}</button>${
    ui.transcript
      ? `<section class="transcript-inline" aria-label="Transcript">${s.transcript.map((r) => `<p class="${r.gap ? "gap" : ""}"><strong>${escape(r.speaker)}</strong> ${escape(r.text)}${!r.final ? "…" : ""}</p>`).join("")}${
          s.cards.some((c) => c.late)
            ? `<h3>Late suggestions</h3>${s.cards
                .filter((c) => c.late)
                .map((c) => `<p>${escape(c.lead)} <small>Late</small></p>`)
                .join("")}`
            : ""
        }</section>`
      : ""
  }<form id="ask-form" class="ask-row"><label for="question" class="sr-only">Ask anything</label><input id="question" name="question" placeholder="Ask anything" maxlength="3000" autocomplete="off"><button type="submit" class="icon-button" aria-label="Ask question">${icon("send")}</button>${button("help", "Help me now", { className: "help-now" })}</form>${s.preferences.debug ? debug(s) : ""}</main>`;
}
function debug(s) {
  const values = s.latencies
      .filter((x) => x.firstPaintAt !== null)
      .map((x) => x.firstPaintAt - x.turnEndedAt)
      .sort((a, b) => a - b),
    last = s.latencies.at(-1);
  return `<aside class="debug">First words: ${last ? Math.round(last.firstPaintAt - last.turnEndedAt) : "–"} ms · median ${values.length ? Math.round(values[Math.floor(values.length / 2)]) : "–"} ms · ${s.metrics.fastCalls} fast / ${s.metrics.strategyCalls} deep</aside>`;
}
