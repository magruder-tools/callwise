import { terms } from "./context.mjs";
export function coversText(wantedText, actualText) {
  const wanted = terms(wantedText), actual = new Set(terms(actualText));
  return wanted.length > 0 && wanted.filter((t) => actual.has(t)).length / wanted.length >= .6;
}
