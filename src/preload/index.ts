import { contextBridge, ipcRenderer } from 'electron';
import type { GazeEvent } from '../shared/gaze';
import type { OverlayState } from '../shared/session';

contextBridge.exposeInMainWorld('overlay', {
  onState: (listener: (state: OverlayState) => void) =>
    ipcRenderer.on('overlay-state', (_event, state) => listener(state)),
  sendGaze: (event: GazeEvent) => ipcRenderer.send('gaze', event),
  sendRecalibrated: () => ipcRenderer.send('recalibrated'),
  onGazeDot: (listener: (position: { x: number; y: number } | null) => void) =>
    ipcRenderer.on('gaze-dot', (_event, position) => listener(position)),
});
