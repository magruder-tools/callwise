import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
export class AppleFollowThrough {
  constructor({ meetings, native, resources, run = execFile }) {
    Object.assign(this, { meetings, native, resources, run });
    this.previews = new Map();
  }
  notes(request) {
    return new Promise((resolve, reject) => {
      const child = this.run(
        "/usr/bin/osascript",
        [
          "-l",
          "JavaScript",
          path.join(this.resources, "apple-notes.js"),
          "--stdin",
        ],
        { timeout: 30000, maxBuffer: 2 * 1048576, encoding: "utf8" },
        (error, stdout) => {
          if (error)
            return reject(
              new Error(
                "Apple Notes could not complete this export. Check Automation permission in System Settings.",
              ),
            );
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("Apple Notes returned an invalid response."));
          }
        },
      );
      child?.stdin?.on("error", () => {});
      child?.stdin?.end(JSON.stringify(request));
    });
  }
  async preview({ meetingId, destination, actionIds = [], newCopy = false }) {
    const m = this.meetings.current(meetingId);
    if (!m) throw new Error("Meeting not found.");
    if (!["notes", "reminders"].includes(destination))
      throw new Error("Choose Notes or Reminders.");
    const actions = m.actions.filter(
      (a) => actionIds.includes(a.id) && a.state !== "dismissed",
    );
    if (destination === "reminders" && !actions.length)
      throw new Error("Select the actions you want to save to Reminders.");
    const lists =
      destination === "reminders"
        ? await this.native.run("reminders", { op: "lists" })
        : await this.notes({ op: "folders" });
    const token = randomUUID(),
      content =
        destination === "notes"
          ? this.meetings.export(meetingId)
          : actions.map((a) => ({
              id: a.id,
              text: a.text,
              owner: a.owner,
              due: a.due,
              refs: a.refs,
            }));
    const value = {
      token,
      meetingId,
      destination,
      actions,
      content,
      newCopy,
      lists,
      at: Date.now(),
      fingerprint: createHash("sha256")
        .update(JSON.stringify(content))
        .digest("hex"),
    };
    this.previews.set(token, value);
    for (const [id, p] of this.previews)
      if (Date.now() - p.at > 15 * 60000) this.previews.delete(id);
    return {
      token,
      destination,
      title: m.title,
      content,
      lists,
      newCopy,
      existing: this.meetings
        .all("exports", meetingId)
        .filter((e) => e.destination === destination && e.status === "done"),
    };
  }
  async commit({ token, destinationId, confirm, update = false }) {
    const p = this.previews.get(token);
    if (
      confirm !== true ||
      !p ||
      Date.now() - p.at > 15 * 60000 ||
      !p.lists.some((l) => l.id === destinationId)
    )
      throw new Error("Review the export and choose a destination first.");
    const m = this.meetings.current(p.meetingId);
    if (!m) throw new Error("The meeting was deleted.");
    const current =
      p.destination === "notes"
        ? this.meetings.export(p.meetingId)
        : m.actions
            .filter((a) => p.actions.some((old) => old.id === a.id))
            .map((a) => ({
              id: a.id,
              text: a.text,
              owner: a.owner,
              due: a.due,
              refs: a.refs,
            }));
    if (
      createHash("sha256").update(JSON.stringify(current)).digest("hex") !==
      p.fingerprint
    )
      throw new Error(
        "The meeting changed. Review a fresh export before saving.",
      );
    const exportKey = createHash("sha256")
      .update(
        `${p.meetingId}:${p.destination}:${destinationId}:${p.newCopy ? p.token : "original"}`,
      )
      .digest("hex");
    const old = this.meetings.get("exports", p.meetingId, exportKey);
    if (old?.status === "pending")
      throw new Error("This export is already being saved.");
    if (
      old?.status === "done" &&
      p.destination === "reminders" &&
      old.fingerprint === p.fingerprint
    )
      return { existing: true, results: old.results };
    this.meetings.put("exports", p.meetingId, exportKey, {
      destination: p.destination,
      status: "pending",
      attempts: (old?.attempts || 0) + 1,
      fingerprint: p.fingerprint,
      updatedAt: Date.now(),
    });
    try {
      let results;
      if (p.destination === "notes")
        results = await this.notes({
          op: "export",
          folderId: destinationId,
          title: m.title,
          text: p.content,
          key: exportKey,
          update: update === true,
        });
      else
        results = await this.native.run("reminders", {
          op: "create",
          listId: destinationId,
          actions: p.actions.map((a) => ({
            key: `${p.meetingId}:${a.id}`,
            text: a.text,
            ...(a.due?.confirmed && a.due.date ? { dueDate: a.due.date } : {}),
            notes: `From ${m.title}\n${(a.refs || [])
              .map((id) => {
                const r = m.segments.find((r) => r.id === id);
                return r
                  ? `${Math.floor((r.startMs || 0) / 60000)}:${String(Math.floor((r.startMs || 0) / 1000) % 60).padStart(2, "0")} ${r.speaker}: ${r.text.slice(0, 250)}`
                  : "Meeting evidence";
              })
              .join(
                "\n",
              )}${a.owner?.confirmed && a.owner.name ? `\nOwner: ${a.owner.name}` : ""}`,
          })),
        });
      this.meetings.put("exports", p.meetingId, exportKey, {
        destination: p.destination,
        status: "done",
        results,
        fingerprint: p.fingerprint,
        attempts: (old?.attempts || 0) + 1,
        updatedAt: Date.now(),
      });
      this.meetings.event(p.meetingId, "export.done", {
        destination: p.destination,
      });
      this.previews.delete(token);
      return {
        saved: true,
        results,
        existing: results?.existing === true && results?.updated !== true,
      };
    } catch (error) {
      this.meetings.put("exports", p.meetingId, exportKey, {
        destination: p.destination,
        status: "failed",
        fingerprint: p.fingerprint,
        attempts: (old?.attempts || 0) + 1,
        updatedAt: Date.now(),
      });
      throw error;
    }
  }
}
