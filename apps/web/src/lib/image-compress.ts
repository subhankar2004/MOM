/** Longest side of a menu photo after compression (spec §7: WebP ≤ 1200 px). */
export const MAX_IMAGE_SIDE = 1200;
/** What the API accepts. Compressed photos are usually 60–200 KB. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPTED_INPUT = /^image\/(jpeg|png|webp|heic|heif|avif|gif)$/;

/** Scales (w, h) down to fit `max` on the longest side; never scales up. */
export function fitWithin(width: number, height: number, max = MAX_IMAGE_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export class ImageCompressError extends Error {}

/**
 * Shrinks a phone photo before upload: at most 1200 px, WebP (JPEG where the browser
 * can't encode WebP), EXIF orientation applied. Runs entirely in the browser.
 */
export async function compressImage(file: Blob): Promise<{ blob: Blob; type: 'image/webp' | 'image/jpeg' }> {
  if (file.type && !ACCEPTED_INPUT.test(file.type)) {
    throw new ImageCompressError('Choose a photo (JPEG, PNG or WebP).');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImageCompressError("This photo can't be read. Try a JPEG or PNG.");
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageCompressError("This browser can't prepare photos.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  for (const quality of [0.82, 0.7, 0.55]) {
    let blob = await encode('image/webp', quality);
    // Browsers that can't encode WebP silently return PNG instead.
    if (blob?.type !== 'image/webp') blob = await encode('image/jpeg', quality);
    if (blob && blob.size <= MAX_UPLOAD_BYTES) {
      return { blob, type: blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg' };
    }
  }
  throw new ImageCompressError('This photo is too large. Try a smaller one.');
}
