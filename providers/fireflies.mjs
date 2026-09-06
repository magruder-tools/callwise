export function normalizeFireflies(event, expectedId) {
  if (
    !event ||
    event.transcript_id !== expectedId ||
    typeof event.chunk_id !== "string" ||
    typeof event.text !== "string"
  )
    return null;
  return {
    id: `fireflies:${event.transcript_id}:${event.chunk_id}`,
    text: event.text,
    speaker: event.speaker_name || "Speaker",
    channel: "meeting",
    startMs: Math.max(0, Number(event.start_time) || 0) * 1000,
    final: true,
  };
}
export class FirefliesClient {
  constructor({ apiKey, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
    this.socket = null;
    this.generation = 0;
  }
  async graphql(query, variables = {}, signal) {
    if (!this.apiKey)
      throw new Error(
        "Fireflies is optional. Add FIREFLIES_API_KEY later to connect it.",
      );
    const response = await this.fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Fireflies returned HTTP ${response.status}. Check your plan and API access.`,
      );
    const data = await response.json();
    if (data.errors?.length)
      throw new Error(
        "Fireflies could not complete this query. Check meeting access and API availability.",
      );
    return data.data;
  }
  async importTranscript(id, signal) {
    const data = await this.graphql(
      "query($id: String!) { transcript(id: $id) { id title sentences { text speaker_name start_time } } }",
      { id },
      signal,
    );
    const t = data.transcript;
    if (!t) throw new Error("That Fireflies transcript was not found.");
    return {
      id: `fireflies:${t.id}`,
      title: t.title || "Fireflies meeting",
      kind: "meeting",
      text: (t.sentences || [])
        .map((s) => `${s.speaker_name || "Speaker"}: ${s.text}`)
        .join("\n"),
    };
  }
  async connect({ transcriptId, onSegment, onStatus }) {
    this.close();
    const generation = this.generation;
    if (!this.apiKey)
      throw new Error(
        "Add your Fireflies API key before selecting this source.",
      );
    if (!transcriptId?.trim())
      throw new Error(
        "Enter the Fireflies transcript ID for the active meeting.",
      );
    const { io } = await import("socket.io-client");
    if (generation !== this.generation)
      throw new Error("Fireflies connection cancelled.");
    const socket = io("wss://api.fireflies.ai", {
      path: "/ws/realtime",
      auth: { token: `Bearer ${this.apiKey}`, transcriptId },
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 3,
      timeout: 10000,
    });
    this.socket = socket;
    socket.on("transcription.broadcast", (event) => {
      const row = normalizeFireflies(event, transcriptId);
      if (row && this.socket === socket) onSegment(row);
    });
    socket.on("disconnect", () => {
      if (this.socket === socket) onStatus("disconnected");
    });
    socket.on("connect_error", () => onStatus("connection-error"));
    socket.on("connection.error", () => onStatus("connection-error"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(
          new Error(
            "Fireflies did not authenticate in time. Check beta access and meeting ID.",
          ),
        );
      }, 12000);
      this.cancelConnect = () => {
        clearTimeout(timer);
        reject(new Error("Fireflies connection cancelled."));
      };
      socket.once("auth.success", () => {
        clearTimeout(timer);
        this.cancelConnect = null;
        onStatus("connected");
        resolve();
      });
      socket.once("auth.failed", () => {
        clearTimeout(timer);
        this.cancelConnect = null;
        socket.disconnect();
        reject(
          new Error(
            "Fireflies authentication failed. Check your key and meeting access.",
          ),
        );
      });
      socket.connect();
    });
  }
  close() {
    this.generation++;
    this.cancelConnect?.();
    this.cancelConnect = null;
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      socket.removeAllListeners();
      socket.disconnect();
    }
  }
}
