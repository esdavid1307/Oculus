export const SCREEN_RECORDING_HINT =
  'No screen to capture: grant Screen Recording to the app running npm (System Settings > Privacy & Security > Screen & System Audio Recording)';

export function pickScreenSource<T extends { display_id: string }>(sources: T[], displayId: number): T {
  const source = sources.find((candidate) => candidate.display_id === String(displayId)) ?? sources[0];
  if (!source) throw new Error(SCREEN_RECORDING_HINT);
  return source;
}
