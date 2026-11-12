import { createHash, randomUUID } from "node:crypto";
export function noticeConfiguration(p = {}) {
  return {
    engine: p.speechEngine || "apple",
    source: p.preferredSource || "audio",
    liveHelp: p.liveHelp === true,
    assistantAccess: p.meetingMcpEnabled === true,
    driveArchive: p.driveArchiveEnabled === true,
    iCloudArchive: p.iCloudArchiveEnabled === true,
    retainAudio:
      p.retainAudio === true &&
      (!p.preferredSource || p.preferredSource === "audio"),
    language: p.language || "en-US",
    noticeWording: String(p.noticeWording || "").slice(0, 2000),
  };
}
export function noticeText(p = {}) {
  const c = noticeConfiguration(p);
  const provider =
    c.source === "fireflies"
      ? "The meeting transcript comes from Fireflies, a cloud service."
      : c.source === "manual"
        ? "I will add conversation text manually; Callwise will not capture audio."
        : c.engine === "apple"
          ? "Transcription happens on my Mac."
          : "Audio is sent to OpenAI for transcription.";
  return `${c.noticeWording || "I use Callwise to transcribe this conversation and help with my notes."} ${provider} ${c.retainAudio ? "I will also keep an audio recording." : "I will keep the transcript and notes, without an audio recording."}${c.iCloudArchive ? " Saved audio recordings, transcript and notes will be exported to my iCloud Drive folder." : c.driveArchive ? " Saved recordings, transcript and notes will be archived in my private Google Drive." : ""}${c.liveHelp ? " While live suggestions are on, conversation text is sent to OpenAI through my configured service for live assistance." : ""}${c.assistantAccess ? " I may later ask an AI assistant to search these notes and transcript; its provider may process the excerpts it reads." : ""} Is everyone comfortable with that?`;
}
export const noticeHash = (p) =>
  createHash("sha256")
    .update(JSON.stringify(noticeConfiguration(p)))
    .digest("hex");
export function confirmNotice(p, receipt, now = Date.now()) {
  if (
    !receipt ||
    receipt.confirmed !== true ||
    !["spoken", "chat", "platform"].includes(receipt.method) ||
    receipt.configHash !== noticeHash(p) ||
    !Number.isFinite(receipt.presentedAt) ||
    now - receipt.presentedAt < 0 ||
    now - receipt.presentedAt > 15 * 60 * 1000
  )
    throw new Error(
      "Share the current notice with everyone on the call, then confirm that they agreed before starting.",
    );
  return {
    id: randomUUID(),
    method: receipt.method,
    state: "confirmed",
    text: noticeText(p),
    confirmedAt: now,
    configHash: receipt.configHash,
    repeats: [],
  };
}
