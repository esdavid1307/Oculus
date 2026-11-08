import { describe, expect, it } from 'vitest';
import { fitScreenshot, pngSize, toScreenPoint } from './frame';

describe('fitScreenshot', () => {
  it('shrinks the long edge to the limit and keeps the aspect ratio', () => {
    expect(fitScreenshot({ x: 0, y: 0, width: 1470, height: 956 }, 1280)).toEqual({
      x: 0,
      y: 0,
      width: 1470,
      height: 956,
      imageWidth: 1280,
      imageHeight: 832,
    });
  });

  it('never scales a small display up', () => {
    const frame = fitScreenshot({ x: 0, y: 0, width: 1024, height: 768 }, 1280);
    expect([frame.imageWidth, frame.imageHeight]).toEqual([1024, 768]);
  });
});

describe('toScreenPoint', () => {
  const frame = fitScreenshot({ x: 0, y: 0, width: 1470, height: 956 }, 1280);

  it('maps model pixels to screen points', () => {
    expect(toScreenPoint(frame, [640, 416])).toEqual({ x: 735, y: 478 });
    expect(toScreenPoint(frame, [0, 0])).toEqual({ x: 0, y: 0 });
  });

  it('keeps a point on the far edge on the display', () => {
    expect(toScreenPoint(frame, [1280, 832])).toEqual({ x: 1469, y: 955 });
    expect(toScreenPoint(frame, [-5, 900])).toEqual({ x: 0, y: 955 });
  });

  it('offsets by the display origin', () => {
    const offset = { ...frame, x: 100, y: -50 };
    expect(toScreenPoint(offset, [0, 0])).toEqual({ x: 100, y: -50 });
  });
});

describe('pngSize', () => {
  it('reads the IHDR size', () => {
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1280, 16);
    png.writeUInt32BE(832, 20);
    expect(pngSize(png)).toEqual({ width: 1280, height: 832 });
  });

  it('rejects anything else', () => {
    expect(() => pngSize(Buffer.from('not a png at all, really not'))).toThrow('Not a PNG');
  });
});
