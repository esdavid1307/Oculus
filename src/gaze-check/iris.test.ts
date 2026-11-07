import { describe, expect, it } from 'vitest';
import { fitRidge, irisFeatures, type Landmark } from './iris';

describe('fitRidge', () => {
  it('recovers a known linear mapping', () => {
    const rows = Array.from({ length: 40 }, (_, i) => [Math.sin(i) / 5, Math.cos(i * 1.7) / 5]);
    const target = ([a, b]: number[]) => ({ x: 700 + 3000 * a - 500 * b, y: 400 + 200 * a + 2500 * b });
    const predict = fitRidge(rows.map((features) => ({ features, target: target(features) })));

    const { x, y } = predict([0.1, -0.05]);
    expect(x).toBeCloseTo(1025, -1);
    expect(y).toBeCloseTo(295, -1);
  });

  it('stays finite when head pose barely changes during calibration', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      features: [Math.sin(i) / 5, 0.1, 0.1 + 1e-9 * (i % 2)],
      target: { x: 700 + 3000 * (Math.sin(i) / 5), y: 400 },
    }));
    const { x, y } = fitRidge(rows)([0.05, 0.1, 0.1]);
    expect(x).toBeCloseTo(850, -1);
    expect(y).toBeCloseTo(400, -1);
  });

  it('does not let a head pose that was only noise in calibration swing the gaze later', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      features: [Math.sin(i) / 5, 0.002 * Math.cos(i * 3.1)],
      target: { x: 700 + 3000 * (Math.sin(i) / 5), y: 400 },
    }));
    const predict = fitRidge(rows);
    expect(Math.abs(predict([0, 0.05]).x - predict([0, 0]).x)).toBeLessThan(100);
  });
});

describe('irisFeatures', () => {
  const frame = { width: 1280, height: 720 };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  // Column-major, as MediaPipe sends it.
  const yawed = (angle: number) => {
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  };

  // Places points given in head space, y up, into MediaPipe's normalised image space, y down.
  function face(matrix: number[], iris: { x: number; y: number }) {
    const place = (x: number, y: number, z: number): Landmark => {
      const camera = [0, 1, 2].map((row) => matrix[row] * x + matrix[row + 4] * y + matrix[row + 8] * z);
      return { x: 0.5 + camera[0] / frame.width, y: 0.5 - camera[1] / frame.height, z: -camera[2] / frame.width };
    };
    const landmarks: Landmark[] = [];
    landmarks[33] = place(-80, 0, 0);
    landmarks[133] = place(-40, 0, 0);
    landmarks[468] = place(-60 + iris.x * 40, iris.y * 40, 0);
    landmarks[362] = place(40, 0, 0);
    landmarks[263] = place(80, 0, 0);
    landmarks[473] = place(60 + iris.x * 40, iris.y * 40, 0);
    return landmarks;
  }

  it('measures iris position in eye widths from the eye centre', () => {
    const features = irisFeatures(face(identity, { x: 0.1, y: -0.2 }), identity, frame);
    [0.1, -0.2, 0.1, -0.2, 0, 0].forEach((expected, i) => expect(features[i]).toBeCloseTo(expected));
  });

  it('keeps the iris position the same when the head turns', () => {
    const turned = yawed(0.4);
    const features = irisFeatures(face(turned, { x: 0.1, y: -0.2 }), turned, frame);
    [0.1, -0.2, 0.1, -0.2].forEach((expected, i) => expect(features[i]).toBeCloseTo(expected));
  });

  it('reports the head turn as yaw', () => {
    const turned = yawed(0.4);
    expect(irisFeatures(face(turned, { x: 0, y: 0 }), turned, frame)[4]).toBeCloseTo(0.4);
  });
});
