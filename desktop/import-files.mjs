import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export const FILE_LIMIT = 10 * 1024 * 1024;
export async function extractFile(filename) {
  const info = await stat(filename);
  if (!info.isFile()) throw new Error("not a file");
  if (info.size > FILE_LIMIT) throw new Error("too large (10 MB limit)");
  const extension = path.extname(filename).toLowerCase(),
    buffer = await readFile(filename);
  let text;
  if (extension === ".pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
      standardFontDataUrl:
        path.join(
          path.dirname(require.resolve("pdfjs-dist/package.json")),
          "standard_fonts",
        ) + path.sep,
      cMapUrl:
        path.join(
          path.dirname(require.resolve("pdfjs-dist/package.json")),
          "cmaps",
        ) + path.sep,
      cMapPacked: true,
    });
    let doc;
    try {
      doc = await task.promise;
      text = "";
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p),
          content = await page.getTextContent();
        text += content.items.map((i) => i.str || "").join(" ") + "\n";
        if (Buffer.byteLength(text) > 2 * 1024 * 1024)
          throw new Error("extracted text exceeds 2 MB");
        page.cleanup();
      }
    } finally {
      await doc?.cleanup?.();
      await task.destroy();
    }
  } else if (extension === ".docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else if (
    [".md", ".txt", ".csv", ".vtt", ".srt", ".json"].includes(extension)
  )
    text = buffer.toString("utf8");
  else throw new Error("unsupported file type");
  if (!text?.trim())
    throw new Error(
      "no extractable text; it may be a scan. Paste the text instead",
    );
  return text.trim();
}
export async function importFiles(filenames, context, project) {
  const skipped = [];
  let imported = 0;
  for (const [index, filename] of filenames.entries()) {
    try {
      if (index >= 20) throw new Error("20-file limit");
      const text = await extractFile(filename);
      context.add({
        title: path.basename(filename),
        text,
        kind: "document",
        project,
      });
      imported++;
    } catch (error) {
      skipped.push({
        name: path.basename(filename),
        reason:
          /(?:(?:too large|extracted text|no extractable|unsupported|20-file|2 MB))/.test(
            error.message,
          )
            ? error.message
            : "could not read",
      });
    }
  }
  return {
    imported,
    skipped,
    message: `${imported} added${skipped.length ? `, ${skipped.length} skipped: ${skipped.map((s) => `${s.name}: ${s.reason}`).join("; ")}` : ""}.`,
  };
}
