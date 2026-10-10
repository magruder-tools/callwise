// Patch changed regions in place. Inputs, focus, selections, open disclosures,
// scroll positions and pressed buttons belong to the user, not the snapshot.
const rendered = new WeakMap();
const regions = new WeakMap();
const key = (node) =>
  node.nodeType === 1
    ? node.getAttribute("data-card-id") ||
      node.id ||
      node.getAttribute("data-region") ||
      node.getAttribute("data-row-id") ||
      node.getAttribute("data-detail-key") ||
      node.getAttribute("data-action") ||
      ""
    : "";
const compatible = (a, b) =>
  a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);
function patch(node, next) {
  if (node.nodeType === 3) {
    if (node.textContent !== next.textContent)
      node.textContent = next.textContent;
    return;
  }
  if (node.nodeType !== 1) return;
  if (node.hasAttribute("data-region")) {
    const html = next.outerHTML;
    if (regions.get(node) === html) return;
    regions.set(node, html);
  }
  for (const attr of [...node.attributes]) {
    if (attr.name === "open" && node.nodeName === "DETAILS") continue;
    if (!next.hasAttribute(attr.name)) node.removeAttribute(attr.name);
  }
  for (const attr of [...next.attributes]) {
    if (attr.name === "open" && node.nodeName === "DETAILS") continue;
    if (node.getAttribute(attr.name) !== attr.value)
      node.setAttribute(attr.name, attr.value);
  }
  if (node.nodeName === "INPUT") {
    if (node.type === "checkbox") node.checked = next.hasAttribute("checked");
    else if (
      next.hasAttribute("value") &&
      node.ownerDocument.activeElement !== node &&
      node.value !== next.getAttribute("value")
    )
      node.value = next.getAttribute("value");
  }
  // Text areas retain their live value. Models do not overwrite a draft.
  if (node.nodeName === "TEXTAREA") return;
  children(node, next);
}
function children(parent, next) {
  const old = [...parent.childNodes];
  let cursor = parent.firstChild;
  for (const wanted of [...next.childNodes]) {
    const match = old.find((node) => compatible(node, wanted));
    if (match) {
      old.splice(old.indexOf(match), 1);
      if (match !== cursor) parent.insertBefore(match, cursor);
      patch(match, wanted);
      cursor = match.nextSibling;
    } else {
      const added = wanted.cloneNode(true);
      parent.insertBefore(added, cursor);
      if (
        added.nodeType === 1 &&
        added.hasAttribute("data-card-id") &&
        !added.classList.contains("streaming")
      ) {
        added.classList.add("arriving");
        added.addEventListener(
          "animationend",
          () => added.classList.remove("arriving"),
          { once: true },
        );
      }
    }
  }
  for (const node of old) node.remove();
}
export function renderRegions(root, html) {
  if (rendered.get(root) === html) return;
  rendered.set(root, html);
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const transcript = root.querySelector(".transcript-inline");
  const pinned =
    !transcript ||
    transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <
      8;
  const scroll = transcript?.scrollTop;
  children(root, template.content);
  const current = root.querySelector(".transcript-inline");
  if (current) current.scrollTop = pinned ? current.scrollHeight : scroll;
}
