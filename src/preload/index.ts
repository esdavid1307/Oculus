import { contextBridge, ipcRenderer } from 'electron';
import type { OverlayState, SessionInput } from '../shared/session';

contextBridge.exposeInMainWorld('overlay', {
  onState: (listener: (state: OverlayState) => void) =>
    ipcRenderer.on('overlay-state', (_event, state) => listener(state)),
  sendGaze: (input: SessionInput) => ipcRenderer.send('gaze', input),
});
