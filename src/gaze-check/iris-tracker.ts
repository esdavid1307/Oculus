import { FaceLandmarker } from '@mediapipe/tasks-vision';
import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import modelAssetPath from './face_landmarker.task?url';
import { fitRidge, irisFeatures, type CalibrationRow } from './iris';
import { CALIBRATION_DWELL_MS, type CreateTracker } from './tracker';

export const createTracker: CreateTracker = async (onSample) => {
  // The whole screen spans only a few camera pixels of iris movement, so ask for more than the default.
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
  });
  const landmarker = await FaceLandmarker.createFromOptions(
    { wasmLoaderPath, wasmBinaryPath },
    {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    },
  );

  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  video.style.cssText = 'position: fixed; top: 0; left: 0; width: 320px; transform: scaleX(-1)';
  document.body.append(video);
  await video.play();

  const calibration: CalibrationRow[] = [];
  let target: CalibrationRow['target'] | null = null;
  let predict: ReturnType<typeof fitRidge> | null = null;
  let stopped = false;

  // Fires once per camera frame. A live video's currentTime moves with the display, so it can't detect new frames.
  const onFrame = () => {
    if (stopped) return;
    video.requestVideoFrameCallback(onFrame);

    // Not the callback's own timestamp, which MediaPipe rejects as out of order.
    const result = landmarker.detectForVideo(video, performance.now());
    const landmarks = result.faceLandmarks[0];
    const matrix = result.facialTransformationMatrixes?.[0]?.data;
    const features =
      landmarks && matrix ? irisFeatures(landmarks, matrix, { width: video.videoWidth, height: video.videoHeight }) : null;
    if (features && target) calibration.push({ features, target });
    onSample({ t: Date.now(), estimate: features && predict ? predict(features) : null });
  };
  video.requestVideoFrameCallback(onFrame);

  return {
    name: `MediaPipe iris, ${video.videoWidth} x ${video.videoHeight} camera`,
    hidePreview() {
      // Not display: none, which would stop the frame callbacks.
      video.style.opacity = '0';
    },
    async calibrateAt(x, y) {
      target = { x, y };
      await new Promise((resolve) => setTimeout(resolve, CALIBRATION_DWELL_MS));
      target = null;
    },
    finishCalibration() {
      if (calibration.length > 0) predict = fitRidge(calibration);
    },
    stop() {
      stopped = true;
      stream.getTracks().forEach((track) => track.stop());
      landmarker.close();
      video.remove();
    },
  };
};
