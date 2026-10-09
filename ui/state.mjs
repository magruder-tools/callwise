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
  notice: "",
  devices: [],
  testResults: [],
  checking: false,
  testChannel: null,
  testText: "",
  firefliesLiveId: "",
  welcomeStep: 0,
};
