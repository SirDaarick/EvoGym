import { expect, it, vi } from 'vitest';
import { compressToWebp } from './compressToWebp';

it('scales the longest edge to 1600 pixels and encodes WebP at quality 0.8', async () => {
  const drawImage = vi.fn();
  const bitmap = { width: 3200, height: 1600, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const original = document.createElement.bind(document);
  const canvas = original('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(new Blob(['image'], { type: 'image/webp' })));
  const create = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => tag === 'canvas' ? canvas : original(tag)) as typeof document.createElement);
  try {
    const result = await compressToWebp(new File(['test'], 'ticket.png', { type: 'image/png' }));
    expect(result.type).toBe('image/webp');
    expect([canvas.width, canvas.height]).toEqual([1600, 800]);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.8);
    expect(bitmap.close).toHaveBeenCalledOnce();
  } finally { create.mockRestore(); vi.unstubAllGlobals(); }
});
