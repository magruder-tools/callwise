import { setTimeout as wait } from "node:timers/promises";
export async function captureSmoke(window, { settle = wait } = {}) {
  // Xvfb can report UnknownVizError while a newly resized surface has no compositor frame.
  // Keep screenshots in the smoke; wait for paint and retry this transient capture exactly once.
  await Promise.race([
    window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"),
    settle(250),
  ]);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const image = await window.webContents.capturePage();
      if (image.isEmpty?.()) throw new Error("Smoke screenshot was empty.");
      return image;
    } catch (error) {
      if (attempt || !/UnknownVizError|Failed to capture|capture.*(?:surface|frame)/i.test(error.message)) throw error;
      await settle(350);
    }
  }
}
