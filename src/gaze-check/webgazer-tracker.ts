// The prebuilt file, because bundling WebGazer's source leaves its FaceMesh import undefined.
import { webgazer } from 'webgazer/dist/webgazer.commonjs2.js';
import { CALIBRATION_DWELL_MS, type CreateTracker } from './tracker';

// WebGazer keeps only its last 50 calibration samples, so 13 points at 3 each all survive.
const CALIBRATION_SAMPLES = 3;

export const createTracker: CreateTracker = async (onSample) => {
  webgazer.params.faceMeshSolutionPath = '/face_mesh';
  webgazer.params.showGazeDot = false;
  // Each run must calibrate from nothing, and only the dots may train the model.
  webgazer.saveDataAcrossSessions(false);
  await webgazer
    .setGazeListener((data: { x: number; y: number } | null) => {
      const estimate = data && Number.isFinite(data.x + data.y) ? { x: data.x, y: data.y } : null;
      onSample({ t: Date.now(), estimate });
    })
    .begin();
  webgazer.removeMouseEventListeners();

  return {
    name: 'WebGazer',
    hidePreview: () => webgazer.showVideoPreview(false),
    async calibrateAt(x, y) {
      for (let i = 0; i < CALIBRATION_SAMPLES; i++) {
        webgazer.recordScreenPosition(x, y, 'click');
        await new Promise((resolve) => setTimeout(resolve, CALIBRATION_DWELL_MS / CALIBRATION_SAMPLES));
      }
    },
    finishCalibration() {},
    stop() {
      // end() alone leaves the camera on.
      webgazer.stopVideo();
      webgazer.end();
    },
  };
};
