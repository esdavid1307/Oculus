import { contextBridge, ipcRenderer } from 'electron';
import type { LargeView } from '../shared/large-view';
import type { OverlayState, SessionInput } from '../shared/session';

contextBridge.exposeInMainWorld('overlay', {
  onState: (listener: (state: OverlayState) => void) =>
    ipcRenderer.on('overlay-state', (_event, state) => listener(state)),
  onLargeView: (listener: (settings: LargeView) => void) =>
    ipcRenderer.on('large-view', (_event, settings) => listener(settings)),
  sendGaze: (input: SessionInput) => ipcRenderer.send('gaze', input),
});
