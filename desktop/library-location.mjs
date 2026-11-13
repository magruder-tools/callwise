// The folder is app-owned; callers cannot supply a path to reveal.
export function libraryLocation(directory) {
  if (!directory) throw new Error("The meeting library is unavailable.");
  return { path: directory, encrypted: true };
}
export async function revealLibrary(directory, shell) {
  const location = libraryLocation(directory);
  const error = await shell.openPath(location.path);
  if (error) throw new Error(`Couldn't open the meeting library: ${error}`);
  return { ...location, revealed: true };
}
