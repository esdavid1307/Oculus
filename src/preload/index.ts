import { contextBridge, ipcRenderer } from 'electron';
import type { IntentLook } from '../shared/intent-look';
import type { LargeView } from '../shared/large-view';
import type { OverlayState, SessionInput } from '../shared/session';

contextBridge.exposeInMainWorld('overlay', {
  onState: (listener: (state: OverlayState) => void) =>
    ipcRenderer.on('overlay-state', (_event, state) => listener(state)),
  onLargeView: (listener: (settings: LargeView) => void) =>
    ipcRenderer.on('large-view', (_event, settings) => listener(settings)),
  onIntentLooks: (listener: (looks: Record<string, IntentLook>) => void) =>
    ipcRenderer.on('intent-looks', (_event, looks) => listener(looks)),
  onGazeDot: (listener: (position: { x: number; y: number } | null) => void) =>
    ipcRenderer.on('gaze-dot', (_event, position) => listener(position)),
  sendGaze: (input: SessionInput) => ipcRenderer.send('gaze', input),
});
