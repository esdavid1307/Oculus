export type Landmark = { x: number; y: number; z: number };
type Frame = { width: number; height: number };
type Position = { x: number; y: number };
export type CalibrationRow = { features: number[]; target: Position };

// Small enough to leave the iris columns alone, large enough to mute head pose columns that are only noise.
const RIDGE_LAMBDA = 1e-3;

const RIGHT_EYE = { outer: 33, inner: 133, iris: 468 };
const LEFT_EYE = { outer: 263, inner: 362, iris: 473 };

// Features per frame: both irises in eye widths from the eye centre, in the head frame, then head yaw and pitch.
export function irisFeatures(landmarks: Landmark[], matrix: number[], { width, height }: Frame) {
  // Image space has y down and z away from the viewer. The matrix is column-major, with y up and z towards the viewer.
  const toHead = (from: Landmark, to: Landmark) => {
    const camera = [(to.x - from.x) * width, (from.y - to.y) * height, (from.z - to.z) * width];
    return [0, 4, 8].map((column) => camera.reduce((sum, value, row) => sum + matrix[column + row] * value, 0));
  };
  const iris = ({ outer, inner, iris }: typeof RIGHT_EYE) => {
    const [a, b] = [landmarks[outer], landmarks[inner]];
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    const eyeWidth = Math.hypot(...toHead(a, b));
    const [x, y] = toHead(centre, landmarks[iris]);
    return [x / eyeWidth, y / eyeWidth];
  };
  const [forwardX, forwardY, forwardZ] = [matrix[8], matrix[9], matrix[10]];
  return [
    ...iris(RIGHT_EYE),
    ...iris(LEFT_EYE),
    Math.atan2(forwardX, forwardZ),
    Math.atan2(forwardY, Math.hypot(forwardX, forwardZ)),
  ];
}

// Gaussian elimination with partial pivoting. Each right-hand side is a column of `sides`.
function solve(matrix: number[][], sides: number[][]) {
  const rows = matrix.map((row, i) => [...row, ...sides[i]]);
  const size = matrix.length;
  for (let pivot = 0; pivot < size; pivot++) {
    const best = rows.reduce(
      (top, row, i) => (i >= pivot && Math.abs(row[pivot]) > Math.abs(rows[top][pivot]) ? i : top),
      pivot,
    );
    [rows[pivot], rows[best]] = [rows[best], rows[pivot]];
    for (let i = 0; i < size; i++) {
      if (i === pivot) continue;
      const factor = rows[i][pivot] / rows[pivot][pivot];
      rows[i] = rows[i].map((value, column) => value - factor * rows[pivot][column]);
    }
  }
  return rows.map((row, i) => row.slice(size).map((value) => value / row[i]));
}

// Centring the columns gives the intercept for free and keeps it out of the penalty.
export function fitRidge(calibration: CalibrationRow[]) {
  const count = calibration.length;
  const featureMeans = calibration[0].features.map(
    (_, i) => calibration.reduce((sum, { features }) => sum + features[i], 0) / count,
  );
  const meanX = calibration.reduce((sum, { target }) => sum + target.x, 0) / count;
  const meanY = calibration.reduce((sum, { target }) => sum + target.y, 0) / count;
  const centred = calibration.map(({ features }) => features.map((value, i) => value - featureMeans[i]));

  const gram = featureMeans.map((_, i) =>
    featureMeans.map((_, j) => centred.reduce((sum, row) => sum + row[i] * row[j], i === j ? RIDGE_LAMBDA : 0)),
  );
  const sides = featureMeans.map((_, i) => [
    centred.reduce((sum, row, n) => sum + row[i] * (calibration[n].target.x - meanX), 0),
    centred.reduce((sum, row, n) => sum + row[i] * (calibration[n].target.y - meanY), 0),
  ]);
  const weights = solve(gram, sides);

  return (features: number[]): Position => {
    const offsets = features.map((value, i) => value - featureMeans[i]);
    return {
      x: meanX + offsets.reduce((sum, value, i) => sum + value * weights[i][0], 0),
      y: meanY + offsets.reduce((sum, value, i) => sum + value * weights[i][1], 0),
    };
  };
}
