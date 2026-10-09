import { readFileSync, statSync } from "node:fs";
import path from "node:path";

export function importFiles(filenames, context, project) {
  const skipped = [];
  let imported = 0;
  for (const [index, filename] of filenames.entries()) {
    let reason = "could not read";
    try {
      if (index >= 20) {
        reason = "20-file limit";
        throw new Error();
      }
      const stat = statSync(filename);
      if (!stat.isFile()) throw new Error();
      if (stat.size > 250000) {
        reason = "too large";
        throw new Error();
      }
      const text = readFileSync(filename, "utf8");
      if (Buffer.byteLength(text) > 250000) {
        reason = "too large";
        throw new Error();
      }
      if (!text.trim()) {
        reason = "no text";
        throw new Error();
      }
      context.add({
        title: path.basename(filename),
        text,
        kind: "document",
        project,
      });
      imported++;
    } catch {
      skipped.push({ name: path.basename(filename), reason });
    }
  }
  const reasons = [...new Set(skipped.map((item) => item.reason))].join(", ");
  return {
    imported,
    skipped,
    message: `${imported} added${skipped.length ? `, ${skipped.length} skipped: ${reasons}` : ""}.`,
  };
}
