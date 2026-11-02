import {
  escape as e,
  header,
  button as b,
  check,
  section,
} from "../components/common.mjs";
import { meters } from "../components/meters.mjs";
import { chips } from "../components/chips.mjs";
const attr = (id) => `data-id="${e(id)}"`;
const time = (ms) =>
  `${Math.floor((ms || 0) / 60000)}:${String(Math.floor((ms || 0) / 1000) % 60).padStart(2, "0")}`;
const field = (id, label, value = "", extra = "") =>
  `<label class="field" for="${id}"><span>${e(label)}</span><input id="${id}" value="${e(value)}" ${extra}></label>`;
function language(s) {
  const current = s.preferences.language || "en-US",
    available = s.desktop?.native?.supportedLocales || [current];
  return `<label class="field"><span>Meeting language</span><select id="language" data-pref="language">${[
    ...new Set([current, ...available].map((v) => v.replace("_", "-"))),
  ]
    .sort()
    .map(
      (v) =>
        `<option value="${e(v)}" ${v === current ? "selected" : ""}>${e(v.replace("_", "-"))}</option>`,
    )
    .join("")}</select></label>`;
}
export function meetingReady(s, ui) {
  const recent = s.meetings.library.slice(0, 5),
    p = s.preferences;
  return `${header(s)}<main class="meeting-ready"><div class="eyebrow">YOUR MEETINGS, ON YOUR MAC</div><h1>Be here.<br><span>Keep the useful parts.</span></h1><p class="intro-copy">Notes, a live transcript, and clear follow-ups. No meeting bot or transcription account.</p><div class="setup-grid"><section class="setup-card"><h2>A new conversation</h2>${field("meeting-title", "Meeting title", ui.meetingTitle || "", 'maxlength="200" placeholder="What are we talking about?"')}${field("meeting-people", "People", ui.meetingPeople || "", 'maxlength="3000" placeholder="Names, separated by commas"')}${language(s)}<label class="check"><input id="group-call" type="checkbox" ${ui.groupCall ? "checked" : ""}><span>Identify speakers in a group call</span></label><p class="help">You and Them labels are always available. Group labels can be renamed after the meeting.</p><label class="field"><span>What do you want to get out of it?</span><input id="goal" data-pref="goal" value="${e(s.settings.goal)}" maxlength="2000" placeholder="Optional: the decision, question or outcome"></label><div class="meeting-options">${check("retainAudio", "Keep an encrypted audio recording", !!p.retainAudio, "pref-switch")}${check("liveHelp", "Optional live AI coaching", !!p.liveHelp, "pref-switch")}<p class="help">${p.liveHelp ? "Uses your configured AI service. Conversation text may be sent to OpenAI." : "Local transcription and notes work with live coaching off."}</p></div><div class="row">${b("m-start", s.connecting ? "Starting…" : "Start meeting", { className: "primary large", disabled: !!s.connecting })}${b("m-notes-only", "Just take notes", { className: "text-button" })}</div>${s.meetings.locked ? check("without-saving", "Start without saving — this meeting will be lost when Callwise closes", false, "m-without-saving") : '<p class="help private-caption">Saved encrypted on this Mac. Audio recording is off unless you choose it.</p>'}</section><aside class="setup-card setup-context"><h2>Bring a little context</h2><p class="help">Choose up to three past meetings, or add your own materials. ${p.liveHelp ? "Selected recaps, decisions and confirmed actions will be shared with your AI service." : ""}</p>${recent.length ? recent.map((m) => `<label class="prior-meeting"><input type="checkbox" data-prior="${e(m.id)}" ${(ui.prior || []).includes(m.id) ? "checked" : ""}><span><strong>${e(m.title)}</strong><small>${new Date(m.createdAt).toLocaleDateString()} · ${e(m.people.join(", ") || "Private meeting")}</small></span></label>`).join("") : '<div class="empty-small">Your saved meetings will appear here.</div>'}<div id="drop-zone" class="drop-zone">${b("import", "Add files")}${b("paste", "Paste notes", { className: "text-button" })}${chips(s.context)}</div>${ui.paste ? '<form id="material-form" class="inline-form"><label>Title<input id="material-title" value="Notes"></label><label>Materials<textarea id="material-text" rows="5" maxlength="2000000"></textarea></label><button type="submit">Add notes</button></form>' : ""}<div class="context-footer">${b("m-calendar", "Use a calendar event", { className: "text-button" })}${b("m-history", "All meetings →", { className: "text-button" })}</div>${ui.calendar?.length ? `<div class="calendar-options">${ui.calendar.map((v, i) => b("m-calendar-select", v.title, { attrs: `data-index="${i}"` })).join("")}</div>` : ""}</aside></div><footer class="meeting-ready-footer"><span class="local-badge">● ${s.desktop?.native?.speech && s.desktop.native.installedLocales?.some((l) => l.replace("_", "-") === (p.language || "en-US").replace("_", "-")) ? "Local speech ready" : "Set up local speech in Settings"}</span>${b("practice", "Try a sample conversation", { className: "text-button" })}</footer></main>${noticeSheet(ui)}`;
}
function noticeSheet(ui) {
  if (!ui.noticeSheet) return "";
  return `<dialog id="meeting-notice" class="meeting-dialog"><span class="eyebrow">BEFORE LISTENING STARTS</span><h1>Let everyone know.</h1><p>Read this aloud or post it in the call chat, and get everyone’s agreement.</p><blockquote>${e(ui.noticeSheet.text)}</blockquote>${b("m-copy-notice", "Copy notice")}<p class="help">Copying does not send this to the call. Callwise cannot verify that participants heard or saw it.</p><label class="field"><span>I shared it by</span><select id="notice-method"><option value="spoken">Speaking aloud</option><option value="chat">Posting in the call chat</option><option value="platform">The meeting platform’s notice</option></select></label>${check("notice-confirmed", "I shared this notice with everyone on the call and they agreed", !!ui.noticeConfirmed, "m-notice-confirm")}<div class="row">${b("m-cancel-notice", "Cancel")}${b("m-confirm-start", "Start listening", { className: "primary", disabled: !ui.noticeConfirmed || ui.startingMeeting })}</div></dialog>`;
}
function refs(ids) {
  return `<span class="evidence-refs">${(ids || [])
    .slice(0, 8)
    .map((id) =>
      b("m-ref", "Source", {
        className: "source-chip",
        attrs: `data-ref="${e(id)}"`,
        title: `Show transcript ${id}`,
      }),
    )
    .join("")}</span>`;
}
function recapSection(title, key, items, ui) {
  return `<section class="recap-section"><h3>${title}</h3>${items?.length ? items.map((item) => (ui.editRecap === item.id ? `<textarea id="edit-bullet-${e(item.id)}" rows="3">${e(item.text)}</textarea>${b("m-save-bullet", "Save", { attrs: `${attr(item.id)} data-section="${key}"` })}` : `<div class="recap-bullet"><p>${e(item.text)}</p>${refs(item.refs)}${b("m-edit-bullet", "Edit", { className: "text-button small", attrs: attr(item.id) })}</div>`)).join("") : '<p class="help">Nothing identified yet.</p>'}</section>`;
}
function actions(m, ui) {
  return `<section class="action-section"><div class="section-heading"><h2>Follow-ups</h2>${b("m-add-action", "Add an action", { className: "text-button" })}</div>${
    m.actions
      .filter((a) => a.state !== "dismissed")
      .map(
        (a) =>
          `<div class="meeting-action ${a.completed ? "completed" : ""}" data-row-id="action-${e(a.id)}"><div class="row"><input aria-label="Select action for Reminders" type="checkbox" data-export-action="${e(a.id)}" ${(ui.exportActions || []).includes(a.id) ? "checked" : ""}><input id="action-text-${e(a.id)}" class="action-text" value="${e(a.text)}" aria-label="Action text" maxlength="2000"></div><div class="action-fields">${field(`action-owner-${e(a.id)}`, a.owner?.confirmed ? "Owner" : "Owner — review suggestion", a.owner?.name || "", 'maxlength="100"')}${field(`action-due-${e(a.id)}`, a.due?.confirmed ? "Due" : "Due — review suggestion", a.due?.date || a.due?.text || "", 'maxlength="100" placeholder="YYYY-MM-DD or a note"')}</div>${check(`action-confirm-owner-${a.id}`, "Confirm owner", ui.actionConfirmations?.[`action-confirm-owner-${a.id}`] ?? !!a.owner?.confirmed)}${check(`action-confirm-due-${a.id}`, "Confirm due date", ui.actionConfirmations?.[`action-confirm-due-${a.id}`] ?? !!a.due?.confirmed)}<div class="row">${b("m-save-action", "Confirm changes", { attrs: attr(a.id), className: "text-button" })}${b("m-complete-action", a.completed ? "Reopen" : "Mark done", { attrs: `${attr(a.id)} data-completed="${!a.completed}"`, className: "text-button" })}${b("m-dismiss-action", "Dismiss", { attrs: attr(a.id), className: "text-button" })}${refs(a.refs)}</div></div>`,
      )
      .join("") ||
    '<p class="help">Actions appear here for your review. Owners and dates are never confirmed automatically.</p>'
  }${
    m.actions.some((a) => a.state === "dismissed")
      ? `<details><summary>Dismissed actions</summary>${m.actions
          .filter((a) => a.state === "dismissed")
          .map(
            (a) =>
              `<p>${e(a.text)} ${b("m-restore-action", "Restore", { attrs: attr(a.id), className: "text-button" })}</p>`,
          )
          .join("")}</details>`
      : ""
  }</section>`;
}
function transcript(m, ui) {
  const selected = ui.transcriptQuery?.toLowerCase() || "",
    rows = m.segments.filter(
      (r) => !selected || r.text.toLowerCase().includes(selected),
    );
  const visible = rows.slice(0, ui.transcriptLimit || 500);
  return `<section class="transcript-pane"><div class="section-heading"><h2>Transcript</h2><span class="help">${m.engine === "apple" ? "On-device speech" : m.engine === "legacy" ? "Imported recap" : m.engine === "manual" ? "Text input" : m.engine === "fireflies" ? "Fireflies transcript" : "Cloud speech"}</span></div><input id="transcript-search" type="search" aria-label="Find in transcript" placeholder="Find a word or phrase…" value="${e(ui.transcriptQuery || "")}"><div class="meeting-transcript" role="log" aria-live="off">${
    visible
      .map(
        (r) =>
          `<article id="tr-${e(r.id)}" data-row-id="${e(r.id)}" class="transcript-row ${r.final ? "" : "volatile"} ${r.gap ? "gap" : ""} ${ui.focusRef === r.id ? "highlight" : ""}"><div class="transcript-meta"><strong>${e(r.speaker)}${r.uncertain ? " ?" : ""}</strong><span>${time(r.startMs)}${r.overlap ? " · overlapping voices" : ""}${r.unfinalized ? " · unfinalized" : ""}</span></div>${
            ui.editSegmentId === r.id
              ? `<textarea id="segment-edit-${e(r.id)}" rows="3">${e(r.text)}</textarea><label class="field"><span>Speaker</span><select id="segment-speaker">${m.speakers
                  .filter((s) => !s.mergedInto)
                  .map(
                    (s) =>
                      `<option value="${e(s.id)}" ${r.speakerKey === s.id ? "selected" : ""}>${e(s.name || s.label)}</option>`,
                  )
                  .join(
                    "",
                  )}</select></label>${b("m-save-segment", "Save correction", { attrs: attr(r.id) })}${b("m-cancel-segment", "Cancel")}`
              : `<p>${e(r.text)}</p><div class="transcript-row-controls">${b("m-edit-segment", "Correct", { className: "text-button small", attrs: attr(r.id) })}${m.audio.length ? b("m-play", "Play from here", { className: "text-button small", attrs: `data-start="${r.startMs}"` }) : ""}</div>`
          }</article>`,
      )
      .join("") ||
    `<div class="empty-transcript"><span class="listening-orbit">◌</span><h3>${m.captureMode === "notes-only" ? "A space for your own notes." : m.status === "running" ? "Listening when the conversation begins." : "No transcript yet."}</h3><p>Words appear here as they are recognized.</p></div>`
  }</div>${visible.length < rows.length ? b("m-more-transcript", "Show more transcript", { className: "text-button" }) : ""}</section>`;
}
export function notebook(s, ui) {
  const m = s.meetings.current;
  if (!m) return meetingHistory(s, ui);
  const active =
      s.meetings.activeId === m.id &&
      ["running", "paused", "finishing"].includes(s.status),
    recording =
      active &&
      s.status === "running" &&
      m.captureMode !== "notes-only" &&
      m.engine !== "manual";
  const mobileTab = ui.notebookTab || "notes";
  return `${header(s)}<main class="notebook-view"><div class="meeting-toolbar"><div class="meeting-status"><span class="status-dot ${recording ? "recording" : ""}"></span>${recording ? (m.retainAudio ? "Transcribing · recording audio" : "Transcribing") : active ? (s.status === "finishing" ? "Saving final words…" : (m.captureMode === "notes-only" || m.engine === "manual") && s.status === "running" ? "Taking notes" : "Paused") : m.saving === false ? "Not saved — export before closing" : "Meeting saved"}<time id="call-time">${time(active ? s.activeTimeMs : m.durationMs)}</time></div><div class="row">${active ? `${s.status === "paused" ? b("resume", "Resume") : b("pause", "Pause", { disabled: s.status === "finishing" })}${b("end", "End meeting", { className: "primary", disabled: s.status === "finishing" })}` : b("m-ready", "New meeting")}${b("m-history", "History", { className: "text-button" })}</div></div>${active && m.captureMode !== "notes-only" && !["manual", "fireflies"].includes(m.engine) ? `<div class="notebook-audio-status">${meters()}<span class="help">Your voice: ${e(s.capture.mic)} · Call audio: ${e(s.capture.system)}</span></div>` : ""}<div class="meeting-title-row"><input id="saved-meeting-title" data-meeting-title="${e(m.id)}" value="${e(m.title)}" maxlength="200" aria-label="Meeting title"><p class="help">${new Date(m.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })} · ${e(m.people.join(", ") || "Add people below")}${m.interrupted ? " · interrupted session recovered" : ""}</p></div>${m.notice ? `<details class="notice-receipt"><summary>Participant notice shared ${new Date(m.notice.confirmedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · ${e(m.notice.method)}</summary><p>${e(m.notice.text)}</p><p>New participant joined? Share the notice again.</p>${b("m-repeat-notice", "I shared it again")}${active ? b("m-objection", "Someone objected — pause now", { className: "text-button" }) : ""}</details>` : '<p class="help">Notes-only meeting. Audio capture is off.</p>'}${s.meetings.warning ? `<div class="banner warning" role="status">${e(s.meetings.warning)}</div>` : ""}<nav class="notebook-tabs" aria-label="Meeting content">${[
    ["notes", "Notes & recap"],
    ["transcript", "Transcript"],
  ]
    .map(([tab, title]) =>
      b("m-notebook-tab", title, {
        attrs: `data-tab="${tab}"`,
        className: mobileTab === tab ? "selected" : "",
      }),
    )
    .join(
      "",
    )}</nav><div class="notebook-grid tab-${mobileTab}"><div class="notes-pane"><div class="section-heading"><h2>Your notes</h2><span id="notes-save-status" class="help">${ui.notesSaving ? "Saving…" : m.saving === false ? "Kept in memory" : "Saved"}</span></div><textarea id="meeting-notes-${e(m.id)}" class="meeting-notes" data-meeting-notes="${e(m.id)}" rows="10" maxlength="200000" placeholder="A thought, a question, something worth remembering…">${e(m.notes.text)}</textarea>${b(m.jobs.some((j) => j.id === "enhance" && j.status === "running") ? "m-cancel-enhance" : "m-enhance", m.jobs.some((j) => j.id === "enhance" && j.status === "running") ? "Stop enhancement" : "Enhance my notes", { className: "text-button" })}${m.enhancedDraft ? `<div class="banner">An updated version is ready for review. Your edits were kept.${b("m-adopt-enhanced", "Use new version")}</div><pre class="draft-preview">${e(m.enhancedDraft.text)}</pre>` : ""}${m.enhanced ? `<details class="enhanced-notes" open><summary>Enhanced notes · on this Mac</summary><textarea id="enhanced-${e(m.id)}" data-editor-version="${m.enhanced.version || 0}" rows="8">${e(m.enhanced.text)}</textarea>${b("m-save-enhanced", "Save edits", { className: "text-button" })}<p class="help">Your original notes remain above.</p></details>` : ""}${!active || m.recap ? `<div class="section-heading recap-heading"><h2>The useful parts</h2>${b(m.jobs.some((j) => j.id === "recap" && j.status === "running") ? "m-cancel-recap" : "m-recap", m.jobs.some((j) => j.id === "recap" && j.status === "running") ? "Stop recap" : "Refresh recap", { className: "text-button" })}</div><p class="help">${e(m.recap?.label || "Building a recap from your transcript…")}</p>${m.recapDraft ? `<div class="banner">A fresh recap is ready. Your edited recap was kept.${b("m-adopt-recap", "Use new recap")}</div><pre class="draft-preview">${e(m.recapDraft.summary.map((b) => b.text).join("\n"))}</pre>` : ""}${recapSection("Summary", "summary", m.recap?.summary, ui)}${recapSection("Decisions", "decisions", m.recap?.decisions, ui)}${recapSection("Still open", "openQuestions", m.recap?.openQuestions, ui)}` : '<div class="live-note-hint">Stay in the conversation. Your recap will be prepared when you end.</div>'}${actions(m, ui)}<details class="speaker-tools"><summary>People & speakers</summary>${field("saved-meeting-people", "People in this meeting", m.people.join(", "), 'maxlength="3000"')}${b("m-save-people", "Save people", { className: "text-button" })}${m.speakers
    .filter((sp) => !sp.mergedInto)
    .map(
      (sp) =>
        `<div class="row">${field(`speaker-name-${e(sp.id)}`, sp.label, sp.name || "", 'maxlength="100"')}${b("m-rename-speaker", "Save name", { attrs: attr(sp.id) })}</div>`,
    )
    .join(
      "",
    )}<div class="row"><label>Merge speaker<select id="speaker-from">${m.speakers.map((sp) => `<option value="${e(sp.id)}">${e(sp.name || sp.label)}</option>`).join("")}</select></label><label>Into<select id="speaker-into">${m.speakers.map((sp) => `<option value="${e(sp.id)}">${e(sp.name || sp.label)}</option>`).join("")}</select></label>${b("m-merge-speakers", "Merge")}</div></details><footer class="meeting-export"><h3>Take the next step</h3><div class="row">${b("m-export-notes", "Save to Apple Notes")}${b("m-export-reminders", "Save selected reminders", { disabled: !ui.exportActions?.length })}${b("m-export-file", "Export file")}${b("m-export-json", "Export JSON", { className: "text-button" })}${m.audio.length ? b("m-play", "Play recording", { attrs: 'data-start="0"' }) : ""}${b("m-stop-playback", "Stop playback", { className: "text-button" })}${s.preferences.liveHelp && active ? b("m-coach", "Open live coaching") : ""}${!active ? b("m-delete", "Delete meeting", { className: "text-button danger" }) : ""}</div></footer></div>${transcript(m, ui)}</div></main>${exportDialog(ui)}${deleteDialog(ui)}${ui.objectionSheet ? `<dialog id="meeting-objection" class="meeting-dialog"><h2>Capture has stopped.</h2><p>Choose what to keep, then continue taking notes without transcription or recording.</p>${b("m-objection-keep", "Keep captured content; continue with notes only")}${b("m-objection-delete", "Delete transcript and audio; continue with notes only", { className: "danger" })}</dialog>` : ""}`;
}
export function meetingHistory(s, ui) {
  const rows = ui.searchResults || s.meetings.library;
  return `${header(s)}<main class="history-view"><div class="section-heading"><div><span class="eyebrow">A MEMORY YOU CAN SEARCH</span><h1>Your conversations.</h1></div>${b("m-ready", "New meeting", { className: "primary" })}</div><form id="meeting-search-form" class="history-search"><input id="meeting-search" type="search" placeholder="Find a decision, a person, a promise…" aria-label="Search meetings" value="${e(ui.historyQuery || "")}"><button type="submit">Search</button></form><div class="history-filters">${field("history-person", "Person", ui.historyPerson || "", 'maxlength="100"')}${field("history-from", "Since", ui.historyFrom || "", 'type="date"')}${check("history-open-actions", "Open follow-ups", !!ui.historyOpenActions)}${b("m-apply-filters", "Apply filters", { className: "text-button" })}</div><form id="meeting-question-form" class="history-question"><label for="meeting-question">Ask your meeting history</label><div class="row"><input id="meeting-question" placeholder="What did we agree about the launch?" maxlength="1000"><button type="submit" ${ui.askingHistory ? "disabled" : ""}>${ui.askingHistory ? "Finding evidence…" : "Ask on this Mac"}</button>${ui.askingHistory ? b("m-cancel-history", "Stop") : ""}</div></form>${ui.historyAnswer ? `<section class="history-answer"><p>${e(ui.historyAnswer.answer)}</p>${ui.historyAnswer.meetings.map((m) => b("m-open", m.title, { attrs: attr(m.id), className: "source-chip" })).join("")}<p class="help">${ui.historyAnswer.engine === "apple" ? "Generated locally. Check the linked evidence." : "Matching excerpts; no generated answer available."}</p></section>` : ""}<div class="meeting-history-list">${rows.length ? rows.map((m) => `<article class="history-meeting"><div><span class="history-date">${new Date(m.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><h2>${b("m-open", m.title, { attrs: attr(m.id), className: "text-button" })}</h2><p>${e(m.people.join(", ") || "Private meeting")} · ${time(m.durationMs)}${m.openActions ? ` · ${m.openActions} open follow-ups` : ""}</p>${(m.excerpts || []).map((x) => `<blockquote>${e(x.text)}</blockquote>`).join("")}</div>${b("m-open", "Open →", { attrs: attr(m.id), className: "text-button" })}</article>`).join("") : '<div class="empty-history"><h2>Room for the next good conversation.</h2><p>Saved meetings stay here, encrypted and searchable on your Mac.</p></div>'}</div></main>`;
}
function exportDialog(ui) {
  const p = ui.appleExport;
  if (!p) return "";
  return `<dialog id="apple-export" class="meeting-dialog"><h1>${p.destination === "notes" ? "Save meeting to Apple Notes" : "Review reminders"}</h1><p>Only the content below will be sent to the destination you choose.</p><pre class="export-preview">${e(typeof p.content === "string" ? p.content : p.content.map((a) => `${a.text}\nOwner: ${a.owner?.name || "Unassigned"}${a.owner?.confirmed ? "" : " (unconfirmed)"}\nDue: ${a.due?.text || "None"}${a.due?.confirmed ? "" : " (unconfirmed)"}`).join("\n\n"))}</pre><label class="field"><span>${p.destination === "notes" ? "Notes folder" : "Reminders list"}</span><select id="export-destination">${p.lists.map((l) => `<option value="${e(l.id)}">${e(l.title)}</option>`).join("")}</select></label>${p.destination === "notes" && p.existing.length ? check("update-export", "Update the existing Callwise note if it already exists in this folder") : ""}<p class="help">Unconfirmed owners and dates are not assigned to reminders. Export markers prevent duplicate saves.</p><div class="row">${b("m-cancel-export", "Cancel")}${b("m-save-export", "Save", { className: "primary", disabled: !p.lists.length })}</div></dialog>`;
}
function deleteDialog(ui) {
  return ui.deleteMeeting
    ? `<dialog id="delete-meeting" class="meeting-dialog"><h1>Delete this meeting?</h1><p>The saved transcript, notes, recap and audio will be removed from this Mac. Exported copies and backups stay where you saved them.</p><div class="row">${b("m-cancel-delete", "Cancel")}${b("m-confirm-delete", "Delete meeting", { className: "danger" })}</div></dialog>`
    : "";
}
export function localWelcome(s, ui) {
  const n = ui.welcomeStep || 0,
    p = s.preferences;
  const titles = [
    "A meeting notebook that stays with you.",
    "Make sure it can hear.",
    "Choose what to keep.",
    "A little extra help, if you want it.",
  ];
  const pages = [
    `<p>Transcribe on this Mac with Apple speech. Your notes, transcript and search work without an account.</p>${language(s)}<p class="local-badge">${s.desktop?.native?.speech ? "● Local speech available" : "Checking the local speech engine…"}</p><p>${e(s.desktop?.assetsProgress || "")}</p>${b("m-assets", "Prepare this language")}<p class="help">Apple Intelligence: ${s.desktop?.native?.localAI === "available" ? "ready for local recaps and enhanced notes" : "not ready; original transcript excerpts will still work"}.</p>`,
    `<p>These checks listen only while you run them.</p>${b("mic-permission", "Allow microphone")}${b("sound-mic", "Check microphone")}${b("sound-system", "Check call audio")}<p>Say “Callwise is ready for my call.”</p><p role="status">${e(s.desktop?.soundResult || "")} ${e(s.desktop?.testText || "")}</p><div class="test-meter"><b id="meter-test"></b></div>${ui.testChannel ? b("sound-stop", "Finish check") : ""}<p class="help">macOS asks for Screen & System Audio Recording. Callwise uses the audio and does not read video frames.</p>`,
    `${check("retainAudio", "Keep encrypted audio recordings", !!p.retainAudio, "pref-switch")}<p>Transcripts and notes are saved encrypted until you delete them. Retained audio defaults to 30 days. You can change either in Privacy.</p><label class="field"><span>Your participant notice introduction</span><textarea id="noticeWording" data-pref="noticeWording" rows="4" maxlength="2000">${e(p.noticeWording || "")}</textarea></label><p>Every transcribed meeting starts with a notice for you to share and confirm.</p>`,
    `${check("liveHelp", "Use optional live AI coaching", !!p.liveHelp, "pref-switch")}<p>Keep this off for a fully local meeting. Coaching can use your existing OpenAI or ChatGPT/Codex connection when you configure it.</p><p>Saved meeting access for Claude and Codex is a separate switch in Settings → Assistants.</p>`,
  ];
  return `${header(s)}<main class="welcome-view local-welcome"><span class="step-count">Step ${n + 1} of 4</span><h1>${titles[n]}</h1>${pages[n]}<div class="welcome-footer">${n ? b("welcome-back", "Back") : ""}${b(n === 3 ? "welcome-done" : "welcome-next", n === 3 ? "Ready for my first meeting" : "Continue", { className: "primary" })}${b("skip-setup", "Set up later", { className: "text-button" })}</div></main>`;
}
export function localSettings(s, ui, legacy) {
  const tabs = [
    "General",
    "Audio",
    "Recording & notice",
    "AI",
    "Assistants",
    "Apple apps",
    "Privacy",
    "Advanced",
  ];
  let body;
  const p = s.preferences;
  if (["General", "Audio", "AI", "Advanced"].includes(ui.tab)) {
    const old = legacy(s, ui),
      match = old.match(/<main class="settings-view">([\s\S]*)<\/main>/);
    body = match?.[1] || "";
    if (ui.tab === "Audio")
      body += `${section("Local speech", `${language(s)}${b("m-assets", "Prepare selected language")}<p>${e(s.desktop?.assetsProgress || "")}</p>`)}`;
    if (ui.tab === "AI")
      body = `${section("On-device notes", "<p>Apple speech transcribes your calls locally. Apple Intelligence prepares recaps and enhanced notes when available. No AI account is required.</p>")}${section("Optional cloud coaching", `${check("liveHelp", "Enable live coaching", !!p.liveHelp, "pref-switch")}<p>Uses your configured OpenAI or Codex provider and may send relevant conversation excerpts. Transcription stays local unless you change the speech engine in Advanced.</p>`)}${body}`;
    if (ui.tab === "Advanced")
      body = `${section("Speech engine", `<label class="field"><span>Transcription provider</span><select data-pref="speechEngine" id="speechEngine"><option value="apple" ${p.speechEngine !== "openai" ? "selected" : ""}>Apple — on this Mac</option><option value="openai" ${p.speechEngine === "openai" ? "selected" : ""} ${!s.config.openaiReady ? "disabled" : ""}>OpenAI — uses saved API key</option></select></label><p>No automatic cloud fallback.</p>`)}${body}`;
  } else if (ui.tab === "Recording & notice")
    body = `${section("Recording", `${check("retainAudio", "Keep an encrypted audio recording", !!p.retainAudio, "pref-switch")}<p>Audio is off by default. Notes and transcripts are saved regardless.</p>`)}${section("Participant notice", `<p>Callwise asks you to share a notice and confirm agreement before each transcribed meeting. It does not automatically announce itself in Zoom, Meet or other apps.</p><label class="field"><span>Introduction</span><textarea id="noticeWording" data-pref="noticeWording" rows="4" maxlength="2000">${e(p.noticeWording || "")}</textarea></label>`)}`;
  else if (ui.tab === "Assistants")
    body = `${section("Saved meeting access", `${check("meetingMcpEnabled", "Allow assistants to read saved Callwise meetings", !!p.meetingMcpEnabled, "pref-switch")}<p>Read-only search, meeting notes and transcript excerpts. Only completed meetings whose participant notice allowed assistant access are available. Your assistant provider can process the excerpts it requests.</p>${b("m-assistant-claude", "Connect Claude Desktop")}${b("m-assistant-codex", "Connect Codex")}<p class="help">This is separate from personal_mac. Neither assistant’s chat history is automatically copied.</p>`)}${ui.assistantPreview ? `<section class="section"><h2>Review connection</h2><p>${e(ui.assistantPreview.file)}</p><pre>${e(JSON.stringify(ui.assistantPreview.change, null, 2))}</pre><p>A backup is saved before changing only Callwise’s own entry.</p>${b("m-assistant-install", "Apply this connection", { className: "primary" })}${b("m-assistant-cancel", "Cancel")}</section>` : ""}`;
  else if (ui.tab === "Apple apps")
    body = section(
      "Your follow-ups, where you want them",
      "<p>After a meeting, choose actions and review them before saving to Reminders. Save a meeting to a Notes folder you select. Permission is requested only when you use that action.</p><p>Exports include a stable marker to prevent duplicate notes and reminders. Existing personal notes are not used as an AI handoff workspace.</p>",
    );
  else
    body = `${section("Your meeting library", "<p>Meeting content is encrypted on this Mac with a key protected by your keychain. Search indexes stay in memory. No background listening or automatic cloud transcription.</p>")}<section class="section"><h2>Retention</h2><label class="field"><span>Keep transcripts and notes</span><select id="meeting-retention">${[
      [0, "Until I delete them"],
      [30, "30 days"],
      [90, "90 days"],
      [365, "1 year"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${p.meetingRetentionDays === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label><label class="field"><span>Keep retained audio</span><select id="audio-retention">${[
      [0, "Until I delete it"],
      [7, "7 days"],
      [30, "30 days"],
      [90, "90 days"],
    ]
      .map(
        ([v, l]) =>
          `<option value="${v}" ${p.audioRetentionDays === v ? "selected" : ""}>${l}</option>`,
      )
      .join(
        "",
      )}</select></label>${check("confirm-retention", "Apply these retention limits to existing meetings too")}${b("m-retention", "Apply retention")}</section>${section("Backup & restore", `${field("backup-passphrase", "Backup passphrase — at least 12 characters", "", 'type="password" autocomplete="new-password" maxlength="300"')}${b("m-backup", "Save encrypted backup")}${check("confirm-restore", "Restore into an empty library; existing meetings are not replaced")}${b("m-restore", "Restore backup")}<p>Keep the passphrase safe. It is not stored by Callwise.</p>`)}${section("Delete local data", `${b("delete-everything", "Delete all Callwise data", { className: "danger", disabled: ["running", "paused", "finishing"].includes(s.status) })}`)}`;
  return `${header(s, "Settings")}<div class="settings-layout"><nav aria-label="Settings sections">${tabs.map((t) => b("settings-tab", t, { attrs: `data-tab="${e(t)}"`, className: ui.tab === t ? "selected" : "" })).join("")}${b("close-settings", "Done", { className: "text-button" })}</nav><main class="settings-view">${body}</main></div>`;
}
