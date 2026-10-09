export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  settings:
    '<path d="m9 3-.6 2-2 .9-1.8-1.1-2 3.4 1.6 1.3-.2 2.2-1.8 1 2 3.4 2-.6 1.8 1.3.3 2.2h4l.6-2 2-.9 1.8 1.1 2-3.4-1.6-1.3.2-2.2 1.8-1-2-3.4-2 .6-1.8-1.3-.3-2.2Z"/><circle cx="11" cy="10" r="3"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 5 11 7-11 7Z"/>',
  end: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="m8 3 8 0-1 7 3 3H6l3-3-1-7Zm4 10v8"/>',
  file: '<path d="M6 3h8l4 4v14H6Z M14 3v5h4M9 12h6M9 16h6"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/>',
  send: '<path d="m5 12 14-7-5 14-3-7-6 0Zm6 0 8-7"/>',
  headphones: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 13h4v8H4ZM16 13h4v8h-4Z"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.file}</svg>`;
export const button = (
  action,
  label,
  {
    className = "",
    disabled = false,
    title = "",
    iconName = "",
    attrs = "",
  } = {},
) =>
  `<button type="button" data-action="${action}" class="${className}" ${disabled ? "disabled" : ""} ${title ? `title="${escape(title)}" aria-label="${escape(title)}"` : ""} ${attrs}>${iconName ? icon(iconName) : ""}${label ? `<span>${escape(label)}</span>` : ""}</button>`;
export const banner = (text, action = "", label = "", tone = "") =>
  `<div class="banner ${tone}" role="status"><span>${escape(text)}</span>${action ? button(action, label) : ""}</div>`;
export function header(s, title = "Callwise") {
  const r = s.desktop?.readiness || {};
  return `<header class="app-header"><div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><strong>${escape(title)}</strong></div><div class="readiness">${[
    ["AI", r.ai, "AI"],
    ["Mic", r.mic, "Mic"],
    ["Call audio", r.system, "Call audio"],
  ]
    .map(
      ([name, ok, target]) =>
        `<button type="button" data-action="readiness" data-target="${target}" aria-label="${name}: ${ok ? "ready" : "needs setup"}"><span class="light ${ok ? "ready" : ""}"></span>${name}</button>`,
    )
    .join(
      "",
    )}</div>${button("settings", "", { iconName: "settings", title: "Settings", className: "icon-button" })}</header>`;
}
export const section = (title, content) =>
  `<section class="section"><h2>${escape(title)}</h2>${content}</section>`;
export const errorBanner = (s) => {
  const e = s.errors.at(-1);
  return e
    ? `<div class="banner error" role="alert"><span>${escape(e.message)}</span>${button("dismiss-error", "", { iconName: "close", title: "Dismiss notice", attrs: `data-id="${escape(e.id)}"` })}</div>`
    : "";
};
export const check = (id, label, checked = false, action = "") =>
  `<label class="check"><input id="${id}" type="checkbox" ${checked ? "checked" : ""} ${action ? `data-action="${action}"` : ""}><span>${escape(label)}</span></label>`;
