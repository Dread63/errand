function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Scales a screenshot down to the page's CSS viewport size. On high-DPI screens Chrome captures
 * at device pixels (e.g. 2x), which costs more image tokens and would make the model's x/y
 * coordinates disagree with the page's. Returns the input unchanged where canvases are unavailable.
 */
export async function fitScreenshot(dataUrl: string, w: number, h: number): Promise<string> {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return dataUrl;
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  try {
    if (bmp.width <= w + 1) return dataUrl;
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    return `data:image/jpeg;base64,${toBase64(await out.arrayBuffer())}`;
  } finally {
    bmp.close();
  }
}
