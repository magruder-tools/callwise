const read = (id) => document.getElementById(id)?.value || "";
const checked = (id) => document.getElementById(id)?.checked === true;
export function createMeetingUi({
  root,
  ui,
  state,
  command,
  render,
  clipboard,
  flushEdits,
}) {
  const edits = new Map();
  let audioContext,
    sources = [];
  async function saveNotes(id) {
    const pending = edits.get(id);
    if (!pending || pending.saving) return;
    clearTimeout(pending.timer);
    pending.saving = true;
    const value = pending.text;
    try {
      const result = await command("meeting.notes", {
        meetingId: id,
        text: value,
        version: pending.version,
        lineTimes: pending.lineTimes,
      });
      pending.version = result.version;
      if (pending.text === value) edits.delete(id);
      else {
        pending.saving = false;
        pending.timer = setTimeout(() => void saveNotes(id), 600);
      }
    } catch {
      pending.saving = false;
      pending.failed = true;
    }
    ui.notesSaving = edits.size > 0;
    render();
  }
  async function flushNotes() {
    for (const [id, p] of edits) {
      if (p.saving) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return flushNotes();
      }
      await saveNotes(id);
      if (edits.get(id)?.failed)
        throw new Error(
          "Your latest notes could not be saved. Keep this window open and copy them before continuing.",
        );
    }
  }
  function stopPlayback() {
    for (const s of sources)
      try {
        s.stop();
      } catch {}
    sources = [];
    void audioContext?.close();
    audioContext = null;
  }
  async function play(startMs) {
    stopPlayback();
    audioContext = new AudioContext();
    await audioContext.resume();
    const context = audioContext,
      m = state.get().meetings.current;
    const data = await command("desktop.meeting.audio", {
      meetingId: m.id,
      startMs,
      durationMs: 30000,
    });
    if (context !== audioContext) return;
    if (!data.chunks.length) {
      stopPlayback();
      throw new Error("No retained audio is available at this point.");
    }
    const decoded = await Promise.all(
      data.chunks.map(async (c) => ({
        ...c,
        buffer: await context.decodeAudioData(
          Uint8Array.from(atob(c.audio), (ch) => ch.charCodeAt(0)).buffer,
        ),
      })),
    );
    if (context !== audioContext) return;
    const now = context.currentTime + 0.1;
    for (const c of decoded) {
      const source = context.createBufferSource();
      source.buffer = c.buffer;
      source.connect(context.destination);
      const offset = Math.max(0, (startMs - c.startMs) / 1000),
        delay = Math.max(0, (c.startMs - startMs) / 1000),
        length = Math.min(
          c.buffer.duration - offset,
          (data.endMs - Math.max(c.startMs, startMs)) / 1000,
        );
      if (length > 0) {
        source.start(now + delay, offset, length);
        sources.push(source);
      }
    }
  }
  function startPayload() {
    const s = state.get();
    return {
      source: s.preferences.preferredSource || "audio",
      backend: s.preferences.preferredBackend || "openai",
      title: ui.meetingTitle || read("meeting-title"),
      people: (ui.meetingPeople || read("meeting-people"))
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
      groupCall: !!ui.groupCall,
      prior: ui.prior || [],
      withoutSaving: !!ui.withoutSaving,
      consent: true,
    };
  }
  async function filterHistory() {
    ui.historyQuery = read("meeting-search");
    ui.historyPerson = read("history-person");
    ui.historyFrom = read("history-from");
    ui.historyOpenActions = checked("history-open-actions");
    ui.searchResults = await command("meeting.search", {
      query: ui.historyQuery,
      filters: {
        person: ui.historyPerson,
        from: ui.historyFrom
          ? new Date(`${ui.historyFrom}T00:00:00`).getTime()
          : undefined,
        openActions: ui.historyOpenActions,
      },
    });
    render();
  }
  root.addEventListener("input", (event) => {
    const node = event.target,
      m = state.get()?.meetings?.current;
    if (node.id === "meeting-title") ui.meetingTitle = node.value;
    if (node.id === "meeting-people") ui.meetingPeople = node.value;
    if (node.id === "transcript-search") {
      ui.transcriptQuery = node.value;
      render();
    }
    if (node.dataset.meetingNotes && m) {
      const id = node.dataset.meetingNotes,
        prior = edits.get(id);
      const p = prior || {
        version: m.notes.version,
        lineTimes: m.notes.lineTimes || [],
      };
      p.text = node.value;
      p.failed = false;
      const line =
        node.value.slice(0, node.selectionStart).split("\n").length - 1;
      if (!p.lineTimes.some((t) => t.line === line))
        p.lineTimes.push({
          line,
          ms: state.get().activeTimeMs || m.durationMs || 0,
        });
      clearTimeout(p.timer);
      p.timer = setTimeout(() => void saveNotes(id), 600);
      edits.set(id, p);
      ui.notesSaving = true;
      const label = document.getElementById("notes-save-status");
      if (label) label.textContent = "Saving…";
    }
  });
  root.addEventListener("change", (event) => {
    const node = event.target;
    if (node.id.startsWith("action-confirm-")) {
      ui.actionConfirmations ||= {};
      ui.actionConfirmations[node.id] = node.checked;
    }
    if (node.id === "group-call") ui.groupCall = node.checked;
    if (node.dataset.prior) {
      const selected = new Set(ui.prior || []);
      node.checked
        ? selected.add(node.dataset.prior)
        : selected.delete(node.dataset.prior);
      if (selected.size > 3) {
        node.checked = false;
        return;
      }
      ui.prior = [...selected];
    }
    if (node.dataset.exportAction) {
      const selected = new Set(ui.exportActions || []);
      node.checked
        ? selected.add(node.dataset.exportAction)
        : selected.delete(node.dataset.exportAction);
      ui.exportActions = [...selected];
      render();
    }
    if (node.dataset.meetingTitle)
      void command("meeting.edit", {
        meetingId: node.dataset.meetingTitle,
        title: node.value,
      });
  });
  root.addEventListener("submit", (event) => {
    if (event.target.id === "meeting-search-form") {
      event.preventDefault();
      void filterHistory();
    }
    if (event.target.id === "meeting-question-form") {
      event.preventDefault();
      const question = read("meeting-question");
      if (question.trim() && !ui.askingHistory) {
        ui.askingHistory = true;
        render();
        void command("meeting.ask", { question })
          .then((answer) => {
            ui.historyAnswer = answer;
          })
          .catch((error) => {
            ui.notice = error.message;
          })
          .finally(() => {
            ui.askingHistory = false;
            render();
          });
      }
    }
  });
  const meetingCommand = (name, payload = {}) =>
    command(name, {
      meetingId: state.get()?.meetings?.current?.id,
      ...payload,
    });
  async function act(action, node) {
    const s = state.get(),
      m = s.meetings?.current;
    switch (action) {
      case "m-start":
        await flushEdits();
        ui.startPayload = startPayload();
        ui.noticeConfirmed = false;
        ui.noticeSheet = await command("meeting.notice.preview");
        render();
        break;
      case "m-notice-confirm":
        ui.noticeConfirmed = node.checked;
        render();
        break;
      case "m-without-saving":
        ui.withoutSaving = node.checked;
        break;
      case "m-copy-notice":
        await clipboard(ui.noticeSheet.text);
        break;
      case "m-cancel-notice":
        ui.noticeSheet = null;
        render();
        break;
      case "m-confirm-start":
        if (!ui.noticeConfirmed || ui.startingMeeting) return;
        ui.startingMeeting = true;
        render();
        try {
          await command("start", {
            ...ui.startPayload,
            notice: {
              confirmed: true,
              method: read("notice-method"),
              configHash: ui.noticeSheet.configHash,
              presentedAt: ui.noticeSheet.presentedAt,
            },
          });
          ui.noticeSheet = null;
          ui.screen = "live";
        } finally {
          ui.startingMeeting = false;
          render();
        }
        break;
      case "m-notes-only":
        await flushEdits();
        await command("start", {
          ...startPayload(),
          source: "manual",
          captureMode: "notes-only",
        });
        ui.screen = "live";
        render();
        break;
      case "m-ready":
        await flushNotes();
        stopPlayback();
        if (["running", "paused", "finishing"].includes(s.status)) {
          await command("meeting.active");
          ui.screen = "live";
        } else {
          await command("new", { clearContext: true });
          ui.screen = "ready";
          ui.meetingTitle = "";
          ui.meetingPeople = "";
          ui.prior = [];
        }
        render();
        break;
      case "m-history":
        await flushNotes();
        stopPlayback();
        ui.screen = "history";
        ui.searchResults = null;
        render();
        break;
      case "m-open":
        await flushNotes();
        stopPlayback();
        await command("meeting.open", { id: node.dataset.id });
        ui.screen = "recap";
        ui.exportActions = [];
        ui.focusRef = "";
        ui.transcriptQuery = "";
        render();
        break;
      case "m-apply-filters":
        await filterHistory();
        break;
      case "m-notebook-tab":
        ui.notebookTab = node.dataset.tab;
        render();
        break;
      case "m-ref":
        ui.focusRef = node.dataset.ref;
        ui.transcriptQuery = "";
        ui.notebookTab = "transcript";
        ui.transcriptLimit = Math.max(
          500,
          (m?.segments.findIndex((r) => r.id === ui.focusRef) || 0) + 10,
        );
        render();
        requestAnimationFrame(() =>
          document
            .getElementById(`tr-${ui.focusRef}`)
            ?.scrollIntoView({ block: "center", behavior: "smooth" }),
        );
        break;
      case "m-more-transcript":
        ui.transcriptLimit = (ui.transcriptLimit || 500) + 500;
        render();
        break;
      case "m-edit-segment":
        ui.editSegmentId = node.dataset.id;
        render();
        break;
      case "m-cancel-segment":
        ui.editSegmentId = null;
        render();
        break;
      case "m-save-segment":
        await meetingCommand("meeting.segment", {
          segmentId: node.dataset.id,
          text: read(`segment-edit-${node.dataset.id}`),
          speakerKey: read("segment-speaker"),
        });
        ui.editSegmentId = null;
        render();
        break;
      case "m-save-people":
        await meetingCommand("meeting.edit", {
          people: read("saved-meeting-people")
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        });
        break;
      case "m-rename-speaker":
        await meetingCommand("meeting.speaker", {
          speakerKey: node.dataset.id,
          name: read(`speaker-name-${node.dataset.id}`),
        });
        break;
      case "m-merge-speakers":
        await meetingCommand("meeting.merge", {
          from: read("speaker-from"),
          into: read("speaker-into"),
        });
        break;
      case "m-enhance":
        await flushNotes();
        await meetingCommand("meeting.generate", { task: "enhance" });
        break;
      case "m-recap":
        await flushNotes();
        await meetingCommand("meeting.generate", { task: "recap" });
        break;
      case "m-cancel-enhance":
        await meetingCommand("meeting.cancel", { task: "enhance" });
        break;
      case "m-cancel-recap":
        await meetingCommand("meeting.cancel", { task: "recap" });
        break;
      case "m-adopt-enhanced":
        await meetingCommand("meeting.adopt", { kind: "enhanced" });
        break;
      case "m-adopt-recap":
        await meetingCommand("meeting.adopt", { kind: "recap" });
        break;
      case "m-save-enhanced":
        await meetingCommand("meeting.document", {
          kind: "notes:enhanced",
          text: read(`enhanced-${m.id}`),
        });
        break;
      case "m-edit-bullet":
        ui.editRecap = node.dataset.id;
        render();
        break;
      case "m-save-bullet":
        await meetingCommand("meeting.document", {
          kind: "recap",
          section: node.dataset.section,
          id: node.dataset.id,
          text: read(`edit-bullet-${node.dataset.id}`),
        });
        ui.editRecap = null;
        render();
        break;
      case "m-add-action":
        await meetingCommand("meeting.action", {
          text: "New action",
          state: "proposed",
        });
        break;
      case "m-cancel-history":
        await command("meeting.ask.cancel");
        break;
      case "m-save-action":
        await meetingCommand("meeting.action", {
          id: node.dataset.id,
          text: read(`action-text-${node.dataset.id}`),
          owner: read(`action-owner-${node.dataset.id}`),
          due: read(`action-due-${node.dataset.id}`),
          confirmOwner:
            checked(`action-confirm-owner-${node.dataset.id}`) ||
            read(`action-owner-${node.dataset.id}`) !==
              (m.actions.find((a) => a.id === node.dataset.id)?.owner?.name ||
                "") ||
            m.actions.find((a) => a.id === node.dataset.id)?.owner
              ?.confirmed === true,
          confirmDue:
            checked(`action-confirm-due-${node.dataset.id}`) ||
            read(`action-due-${node.dataset.id}`) !==
              (m.actions.find((a) => a.id === node.dataset.id)?.due?.date ||
                m.actions.find((a) => a.id === node.dataset.id)?.due?.text ||
                "") ||
            m.actions.find((a) => a.id === node.dataset.id)?.due?.confirmed ===
              true,
          state: "confirmed",
        });
        break;
      case "m-complete-action":
        await meetingCommand("meeting.action", {
          id: node.dataset.id,
          completed: node.dataset.completed === "true",
        });
        break;
      case "m-dismiss-action":
        await meetingCommand("meeting.action", {
          id: node.dataset.id,
          state: "dismissed",
        });
        break;
      case "m-restore-action":
        await meetingCommand("meeting.action", {
          id: node.dataset.id,
          state: "proposed",
        });
        break;
      case "m-repeat-notice":
        await meetingCommand("meeting.notice", { confirmed: true });
        ui.notice = "Notice shared again.";
        render();
        break;
      case "m-objection":
        await meetingCommand("meeting.notice", { objection: true });
        ui.objectionSheet = true;
        render();
        break;
      case "m-objection-keep":
      case "m-objection-delete": {
        const objected = m?.id;
        // Capture is already paused. Save queued or in-flight notes before the
        // continuation copies them and, for Delete, removes the original meeting.
        await flushNotes();
        await meetingCommand("meeting.objection.resolve", {
          meetingId: objected,
          choice: action === "m-objection-delete" ? "delete" : "keep",
        });
        ui.objectionSheet = false;
        await command("new", { clearContext: true });
        await command("start", {
          source: "manual",
          captureMode: "notes-only",
          continueFrom: objected,
        });
        ui.screen = "live";
        render();
        break;
      }
      case "m-export-notes":
      case "m-export-reminders":
        await flushNotes();
        ui.appleExport = await meetingCommand("desktop.meeting.apple.preview", {
          destination: action === "m-export-notes" ? "notes" : "reminders",
          actionIds: ui.exportActions || [],
        });
        render();
        break;
      case "m-cancel-export":
        ui.appleExport = null;
        render();
        break;
      case "m-save-export":
        const exportResult = await command("desktop.meeting.apple.save", {
          token: ui.appleExport.token,
          destinationId: read("export-destination"),
          update: checked("update-export"),
          confirm: true,
        });
        ui.appleExport = null;
        ui.notice = exportResult.existing
          ? "An existing export was found. Choose Update to replace its content."
          : "Saved to your selected Apple app.";
        render();
        break;
      case "m-export-file":
      case "m-export-json":
        await flushNotes();
        await meetingCommand("desktop.meeting.export", {
          format: action === "m-export-json" ? "json" : "markdown",
        });
        break;
      case "m-archive-open":
        await meetingCommand("desktop.meeting.archive.open", {
          meetingId: m.id,
        });
        break;
      case "m-archive-choose":
        await command("desktop.meeting.archive.choose");
        break;
      case "m-archive-retry":
        await command("desktop.meeting.archive.retry");
        break;
      case "m-play":
        await play(Number(node.dataset.start) || 0);
        break;
      case "m-stop-playback":
        stopPlayback();
        break;
      case "m-delete":
        ui.deleteMeeting = m.id;
        render();
        break;
      case "m-cancel-delete":
        ui.deleteMeeting = null;
        render();
        break;
      case "m-confirm-delete":
        await command("meeting.delete", {
          meetingId: ui.deleteMeeting,
          confirm: true,
        });
        ui.deleteMeeting = null;
        ui.screen = "history";
        render();
        break;
      case "m-assets":
        await command("desktop.meeting.assets", { download: true });
        break;
      case "m-calendar":
        ui.calendar = await command("desktop.meeting.calendar");
        render();
        break;
      case "m-calendar-select": {
        const event = ui.calendar[Number(node.dataset.index)];
        ui.meetingTitle = event.title;
        ui.meetingPeople = event.people.join(", ");
        ui.calendar = null;
        render();
        break;
      }
      case "m-retention":
        if (!checked("confirm-retention"))
          throw new Error(
            "Confirm that the new limits apply to existing meetings.",
          );
        await command("configure", {
          meetingRetentionDays: Number(read("meeting-retention")),
          audioRetentionDays: Number(read("audio-retention")),
          confirmRetention: true,
        });
        ui.notice = "Retention limits saved.";
        render();
        break;
      case "m-backup":
        {
          const backup = await command("desktop.meeting.backup", {
            passphrase: read("backup-passphrase"),
          });
          document.getElementById("backup-passphrase").value = "";
          if (backup?.missingAudio) {
            ui.notice = `Backup saved. ${backup.missingAudio} audio ${backup.missingAudio === 1 ? "piece was" : "pieces were"} already missing from this Mac and couldn't be included.`;
            render();
          }
        }
        break;
      case "m-restore":
        if (!checked("confirm-restore"))
          throw new Error("Confirm restoring into an empty library first.");
        await flushNotes();
        const passphrase = read("backup-passphrase");
        document.getElementById("backup-passphrase").value = "";
        const restored = await command("desktop.meeting.restore", {
          passphrase,
          confirm: true,
        });
        if (restored.restored) {
          ui.notice = "Backup restored. Your meeting library is ready.";
          render();
        }
        break;
      case "m-assistant-claude":
      case "m-assistant-codex":
        ui.assistantPreview = await command(
          "desktop.meeting.assistant.preview",
          { target: action === "m-assistant-claude" ? "claude" : "codex" },
        );
        render();
        break;
      case "m-assistant-install":
        await command("desktop.meeting.assistant.install", {
          target: ui.assistantPreview.target,
          confirm: true,
        });
        ui.assistantPreview = null;
        ui.notice =
          "Connection saved. Reload that assistant’s Callwise connection to use it.";
        render();
        break;
      case "m-assistant-cancel":
        ui.assistantPreview = null;
        render();
        break;
      case "m-coach":
        ui.notebookTab = "coach";
        render();
        break;
      case "m-stage-select": {
        // View an earlier card until a newer one arrives.
        const fast = s.cards.filter(
          (c) => c.status !== "dismissed" && c.lane !== "strategy" && c.kind !== "bigger_picture",
        );
        ui.stageSelect = { id: node.dataset.id, latestId: fast.at(-1)?.id };
        render();
        break;
      }
      case "m-stage-latest":
        ui.stageSelect = null;
        render();
        break;
      case "m-coach-floating":
        await command("desktop.meeting.coach");
        break;
    }
  }
  return { act, flushNotes, stopPlayback };
}
