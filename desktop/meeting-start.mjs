// Keep the notice and storage lifecycle tied to the single start that owns it.
export async function startMeeting({ meetings, controller, payload = {} }) {
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
      created = meetings.begin({
        preferences: controller.preferences,
        title: payload.title,
        people: payload.people,
        groupCall: payload.groupCall === true,
        prior: Array.isArray(payload.prior) ? payload.prior : [],
        notice: payload.notice,
        withoutSaving: payload.withoutSaving === true,
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
    return await controller.command("start", {
      source,
      consent: true,
      backend: payload.backend,
      transcriptId: payload.transcriptId,
    });
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
