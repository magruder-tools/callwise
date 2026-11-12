// Describe the choices captured for this meeting, rather than later defaults.
export function meetingProcessingStatus(meeting, status = meeting?.status) {
  if (!meeting) return [];
  const notesOnly =
    meeting.captureMode === "notes-only" || meeting.engine === "manual";
  const live = ["running", "paused", "finishing"].includes(status);
  const speech = notesOnly
    ? "Notes only"
    : meeting.engine === "apple"
      ? "Transcription: on this Mac"
      : meeting.engine === "openai"
        ? "Cloud transcription: OpenAI"
        : meeting.engine === "fireflies"
          ? "Cloud transcript: Fireflies"
          : "Transcription provider: unknown";
  const audio = live
    ? meeting.retainAudio && !notesOnly
      ? status === "running"
        ? "Audio recording: on"
        : "Audio recording: paused"
      : "Audio recording: off"
    : meeting.retainAudio && !notesOnly
      ? "Audio retention: enabled"
      : "Audio recording: off";
  const coaching = meeting.liveHelp
    ? live
      ? "Cloud coaching: enabled"
      : "Cloud coaching: was enabled"
    : "Cloud coaching: off";
  return [
    speech,
    audio,
    coaching,
    ...(meeting.folderArchived
      ? ["Recording archived in iCloud Drive"]
      : meeting.iCloudArchive
        ? ["iCloud archive: pending after meeting"]
        : []),
    ...(meeting.driveArchived
      ? ["Recording archived in Google Drive"]
      : meeting.driveArchive
        ? ["Google Drive archive: pending after meeting"]
        : []),
    ...(meeting.assistantAccess
      ? ["Assistant access: allowed after meeting"]
      : []),
  ];
}
