// The renderer never patches an existing <textarea>, so server-side changes to enhanced notes are not shown.
import { createRequire } from "node:module";
const require = createRequire(`${process.env.CALLWISE_ROOT || process.cwd()}/package.json`);
const { parseHTML } = require("linkedom");
const { renderRegions } = await import(`${process.env.CALLWISE_ROOT || process.cwd()}/ui/render.mjs`);
const { document } = parseHTML("<html><body><div id=app></div></body></html>");
globalThis.document = document;
const root = document.getElementById("app");
const view = (text) => `<div data-region="recap"><details class="enhanced-notes" open><summary>Enhanced notes</summary><textarea id="enhanced-m1" rows="8">${text}</textarea></details></div>`;
renderRegions(root, view("Version 1 of the enhanced notes"));
renderRegions(root, view("Version 2 adopted with Use new version"));
const ta = root.querySelector("#enhanced-m1");
console.log("textarea shows after the adopted version arrives:", JSON.stringify(ta.value ?? ta.textContent));
