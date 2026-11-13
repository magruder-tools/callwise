let snapshot = null;
const listeners = new Set();
export const state = {
  get: () => snapshot,
  set: (value) => {
    snapshot = value;
    for (const listener of listeners) listener(value);
  },
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
export const viewState = {
  screen: "ready",
  tab: "General",
  consent: false,
  sessionId: null,
  selectedId: null,
  lastCardId: null,
  transcript: false,
  coverage: false,
  prep: false,
  paste: false,
  drafts: { "material-title": "Notes", "material-text": "", question: "" },
  notice: "",
  devices: [],
  testResults: [],
  checking: false,
  testChannel: null,
  testText: "",
  firefliesLiveId: "",
  welcomeStep: 0,
};
// These values belong to the view, even while a different screen is mounted.
export function captureDrafts(root, ui) {
  for (const id of Object.keys(ui.drafts)) {
    const node = root.querySelector(`#${id}`);
    if (node) ui.drafts[id] = node.value;
  }
}
export function restoreDrafts(root, ui) {
  for (const [id, value] of Object.entries(ui.drafts)) {
    const node = root.querySelector(`#${id}`);
    if (node) node.value = value;
  }
}
export function setDraft(root, ui, id, value) {
  ui.drafts[id] = value;
  const node = root.querySelector(`#${id}`);
  if (node) node.value = value;
}
