import { rmSync } from "node:fs";
// Keep the notice and storage lifecycle tied to the single start that owns it.
export async function startMeeting({ meetings, controller, payload = {} }) {
  if (meetings.archiveOperation) throw new Error("Wait for the restore to finish before starting a meeting.");
  if (controller.connecting || controller.drainJob)
    throw new Error("The connection is still starting or saving final words.");
  if (["running", "finishing"].includes(controller.engine.status))
    throw new Error("A meeting is already active.");
  const resuming = controller.engine.status === "paused" && meetings.activeId;
  const captureMode =
    payload.captureMode === "notes-only" ? "notes-only" : "transcribe";
  const source =
    captureMode === "notes-only"
      ? "manual"
      : payload.source || controller.preferences.preferredSource || "audio";
  if (!["audio", "manual", "fireflies"].includes(source))
    throw new Error("Choose a supported source.");
  let created;
  try {
    if (resuming) {
      const m = meetings.get("meetings", meetings.activeId);
      const originalSource =
        m.captureMode === "notes-only"
          ? "manual"
          : m.engine === "apple" || m.engine === "openai"
            ? "audio"
            : m.engine;
      if (source !== originalSource)
        throw new Error("End this meeting before changing its source.");
      if (m.objection)
        throw new Error(
          "Capture stopped after an objection. Keep notes or start a new meeting with a fresh notice.",
        );
    } else {
      // A meeting started without saving keeps its notes-only continuation unsaved too.
      const continuing =
        captureMode === "notes-only" && typeof payload.continueFrom === "string"
          ? meetings.get("meetings", payload.continueFrom)
          : null;
      created = meetings.begin({
        preferences: controller.preferences,
        title: payload.title,
        people: payload.people,
        groupCall: payload.groupCall === true,
        prior: Array.isArray(payload.prior) ? payload.prior : [],
        notice: payload.notice,
        withoutSaving:
          payload.withoutSaving === true || continuing?.saving === false,
        captureMode,
        source,
      });
      for (const id of created.prior) {
        const old = meetings.current(id);
        if (!old?.recap) continue;
        const items = [
          ...(old.recap.summary || []),
          ...(old.recap.decisions || []),
          ...old.actions.filter((a) => a.state === "confirmed"),
        ];
        controller.engine.context.add({
          id: `meeting:${id}`,
          title: old.title,
          kind: "recap",
          text: items
            .map((v) => v.text)
            .join("\n")
            .slice(0, 16000),
        });
      }
    }
    const started = await controller.command("start", {
      source,
      consent: true,
      backend: payload.backend,
      transcriptId: payload.transcriptId,
    });
    // The notes-only meeting that continues after an objection carries over title, people and (after a
    // deletion) the user's notes. A failure here must not undo the meeting that just started.
    if (
      created &&
      captureMode === "notes-only" &&
      typeof payload.continueFrom === "string"
    )
      try {
        await meetings.continueAfterObjection(created.id, payload.continueFrom);
      } catch {
        meetings.warning =
          "Your earlier notes are still in the previous meeting.";
      }
    return started;
  } catch (error) {
    if (created) {
      const m = meetings.get("meetings", created.id);
      if (m) {
        meetings.put("meetings", m.id, m.id, {
          ...m,
          status: "ended",
          interrupted: true,
          endedAt: Date.now(),
        });
        if (
          !meetings.all("segments", m.id).length &&
          !meetings.get("docs", m.id, "notes:original")?.text
        )
          await meetings.delete(m.id);
        else meetings.invalidate();
      }
    }
    throw error;
  }
}

// "Retry audio": Apple speech never marks its transcribers stopped, so a failed channel or a stopped session
// needs the same pause → resume (new capture epoch, new helper) as an OpenAI transcriber that gave up.
// A failed capture input (device) is reopened by the renderer instead.
export function speechNeedsRestart(controller) {
  return (
    [...controller.transcribers.values()].some(
      (t) => t.stopped || t.session?.stopped,
    ) ||
    ["mic", "system"].some(
      (channel) =>
        controller.capture[channel] === "failed" &&
        controller.captureInputs[channel] !== "failed",
    )
  );
}
// "Delete all" when the library couldn't be opened at launch (locked keychain, denied access): there is
// no store to reset, so remove the folder itself, or its key and database survive and reappear later.
// Returns a new empty store when one can be opened now; otherwise the next launch creates it.
export function removeUnopenedLibrary({ meetings, directory, open }) {
  if (!meetings || meetings.store) return null;
  rmSync(directory, { recursive: true, force: true });
  try {
    const store = open();
    meetings.store = store;
    meetings.warning = "";
    return store;
  } catch {
    return null;
  }
}
