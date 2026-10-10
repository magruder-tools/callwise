export function shortcutKey(code) {
  return (
    {
      Space: "Space",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      BracketLeft: "[",
      BracketRight: "]",
    }[code] ||
    (/^Key[A-Z]$/.test(code)
      ? code.slice(3)
      : /^Digit[0-9]$/.test(code)
        ? code.slice(5)
        : "")
  );
}
export function shortcutLabel(shortcut) {
  return String(shortcut || "Control+Alt+Space")
    .replace("Control+", "⌃")
    .replace("Alt+", "⌥")
    .replace("Shift+", "⇧");
}
