import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { extractFile, importFiles } from "../desktop/import-files.mjs";
import { ContextStore } from "../core/context.mjs";
import {
  LiveTranscriber,
  transcriptionOptions,
} from "../providers/transcription.mjs";
import { AdaptiveVoice } from "../ui/audio-level.mjs";
function pdf(text = "") {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let value = "%PDF-1.4\n",
    offsets = [0];
  for (const [i, obj] of objects.entries()) {
    offsets.push(Buffer.byteLength(value));
    value += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  }
  const start = Buffer.byteLength(value);
  value += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return value;
}
test("PDF and Word extraction work, scanned PDFs explain pasting, and total extracted text is bounded", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "callwise-formats-"));
  try {
    const doc = path.join(dir, "notes.pdf");
    writeFileSync(doc, pdf("Approved budget is 10000 dollars."));
    assert.match(await extractFile(doc), /Approved budget is 10000/);
    const scan = path.join(dir, "scan.pdf");
    writeFileSync(scan, pdf());
    await assert.rejects(extractFile(scan), /scan.*Paste/);
    const require = createRequire(
        new URL("../node_modules/mammoth/package.json", import.meta.url),
      ),
      Zip = require("jszip"),
      zip = new Zip();
    zip.file(
      "[Content_Types].xml",
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip.file(
      "_rels/.rels",
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    );
    zip.file(
      "word/document.xml",
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A real Word note.</w:t></w:r></w:p></w:body></w:document>',
    );
    const word = path.join(dir, "notes.docx");
    writeFileSync(word, await zip.generateAsync({ type: "nodebuffer" }));
    assert.match(await extractFile(word), /A real Word note/);
    const context = new ContextStore();
    context.add({ title: "Large", text: "x".repeat(2 * 1024 * 1024 - 10) });
    const result = await importFiles([word], context, "");
    assert.equal(result.imported, 0);
    assert.match(result.skipped[0].reason, /2 MB/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
class Socket extends EventEmitter {
  static sockets = [];
  constructor() {
    super();
    this.readyState = 1;
    this.bufferedAmount = 0;
    this.messages = [];
    Socket.sockets.push(this);
  }
  send(s) {
    this.messages.push(JSON.parse(s));
  }
  close() {
    this.closed = true;
  }
  ping() {
    this.emit("pong");
  }
  ack() {
    this.emit("open");
    this.emit("message", JSON.stringify({ type: "session.updated" }));
  }
}
const pcm = (rms = 0.05) => {
  const b = Buffer.alloc(4800);
  for (let i = 0; i < b.length / 2; i++)
    b.writeInt16LE(Math.round(rms * 32767), i * 2);
  return b;
};
test("at 50 minutes a fresh session is ready before silence switches and closes the old socket", async () => {
  let now = 0;
  Socket.sockets = [];
  const t = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "system",
    WebSocketClass: Socket,
    clock: () => now,
  });
  try {
    const connected = t.connect(),
      old = Socket.sockets[0];
    old.ack();
    await connected;
    now = 50 * 60000;
    t.push(pcm(0), now);
    assert.equal(Socket.sockets.length, 2);
    const next = Socket.sockets[1];
    assert.equal(old.closed, undefined);
    next.ack();
    await new Promise((r) => setImmediate(r));
    for (let i = 0; i < 16; i++) {
      now += 100;
      t.push(pcm(0), now);
    }
    assert.equal(old.closed, true);
    assert.ok(t.delegate);
    assert.equal(t.delegate.socket, next);
    t.close();
    assert.equal(next.closed, true);
  } finally {
    t.close();
  }
});
test("voice commits at a dip after eight seconds or the hard fourteen-second boundary", async () => {
  Socket.sockets = [];
  const t = new LiveTranscriber({
    apiKey: "TEST_ONLY",
    channel: "mic",
    WebSocketClass: Socket,
  });
  try {
    const p = t.connect();
    const socket = Socket.sockets.at(-1);
    socket.ack();
    await p;
    for (let i = 0; i < 81; i++) t.push(pcm(), i * 100);
    assert.equal(
      socket.messages.filter((m) => m.type === "input_audio_buffer.commit")
        .length,
      0,
    );
    t.push(pcm(0), 8200);
    t.push(pcm(0), 8300);
    assert.equal(
      socket.messages.filter((m) => m.type === "input_audio_buffer.commit")
        .length,
      1,
    );
    for (let i = 0; i < 140; i++) t.push(pcm(), 8400 + i * 100);
    assert.equal(
      socket.messages.filter((m) => m.type === "input_audio_buffer.commit")
        .length,
      2,
    );
  } finally {
    t.close();
  }
});
test("transcription hints exclude unsafe keywords and unsupported model-specific options", () => {
  const options = transcriptionOptions("gpt-live-transcribe", {
    keywords: ["Callwise", "<instruction>", "bad\nterm"],
    languages: ["en", "invalid-code!"],
    prompt: "x".repeat(1000),
  });
  assert.deepEqual(options.keywords, ["Callwise"]);
  assert.deepEqual(options.languages, ["en"]);
  assert.equal(options.prompt.length, 800);
  assert.deepEqual(
    transcriptionOptions("other-model", { keywords: ["Callwise"] }),
    { model: "other-model" },
  );
});
test("adaptive voice detection follows quiet noise and keeps clear speech audible", () => {
  const detector = new AdaptiveVoice();
  for (let i = 0; i < 10; i++) assert.equal(detector.update(0.001, 100), false);
  assert.equal(detector.update(0.03, 100), true);
  for (let i = 0; i < 100; i++) detector.update(0.002, 100);
  assert.equal(detector.update(0.035, 100), true);
});
