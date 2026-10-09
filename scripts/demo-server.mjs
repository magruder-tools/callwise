import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { CallController } from "../core/controller.mjs";

const ui = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ui");
const token = randomBytes(32).toString("hex");
const controller = new CallController({
  demoOnly: true,
  config: { fastModel: "gpt-5.6-luna", strategyModel: "gpt-6-astra" },
});
const streams = new Set();
const port = Number(process.env.CALLWISE_DEMO_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".css": "text/css",
};
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  const fail = (status, message) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  };
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host))
    return fail(403, "Loopback host only.");
  if (
    req.headers.origin &&
    ![origin, `http://localhost:${port}`].includes(req.headers.origin)
  )
    return fail(403, "Invalid origin.");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname.startsWith("/api/")) {
    if (
      !req.headers.cookie
        ?.split(";")
        .some((c) => c.trim() === `callwise_demo=${token}`)
    )
      return fail(403, "Open the local demo page first.");
    if (url.pathname === "/api/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(controller.snapshot())}\n\n`);
      streams.add(res);
      req.on("close", () => streams.delete(res));
      return;
    }
    if (url.pathname === "/api/command" && req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return fail(415, "JSON required.");
      try {
        let body = "";
        for await (const part of req) {
          body += part;
          if (body.length > 2200000) {
            return fail(413, "Request too large.");
          }
        }
        const { name, payload } = JSON.parse(body);
        const result = await controller.command(name, payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: result ?? null }));
      } catch (error) {
        fail(400, error.message);
      }
      return;
    }
    return fail(404, "Not found.");
  }
  if (req.method !== "GET") return fail(405, "GET only.");
  const filename = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (
    !/^(?:index\.html|[a-z0-9-]+\.(?:mjs|js|css)|(?:views|components)\/[a-z0-9-]+\.mjs)$/.test(
      filename,
    )
  )
    return fail(404, "Not found.");
  try {
    const body = await readFile(path.join(ui, filename));
    if (filename === "index.html")
      res.setHeader(
        "Set-Cookie",
        `callwise_demo=${token}; HttpOnly; SameSite=Strict; Path=/`,
      );
    res.writeHead(200, { "Content-Type": mime[path.extname(filename)] });
    res.end(body);
  } catch {
    fail(404, "Not found.");
  }
});
controller.on("state", (state) => {
  const event = `data: ${JSON.stringify(state)}\n\n`;
  for (const stream of streams) {
    if (stream.writableLength > 1_000_000) {
      stream.end();
      streams.delete(stream);
    } else stream.write(event);
  }
});
const heartbeat = setInterval(() => {
  for (const stream of streams) stream.write(": heartbeat\n\n");
}, 15000);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Callwise offline demo: ${origin}\nSynthetic data only. No credentials are loaded and no provider requests are made.`,
  ),
);
const stop = () => {
  clearInterval(heartbeat);
  controller.close();
  for (const stream of streams) stream.end();
  server.close(() => process.exit(0));
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
