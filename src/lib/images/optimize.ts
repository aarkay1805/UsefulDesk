// Client-side image optimization for avatar uploads. Takes a source
// image + a crop rectangle (natural pixels, as react-easy-crop reports
// `croppedAreaPixels`), renders the square crop onto a canvas capped at
// MAX_AVATAR_PX, and encodes it as compressed WebP — so a 4 MB phone
// photo lands in storage as a ~20-40 KB square, keeping the DB/bucket
// lean without visible quality loss at avatar sizes.

/** Longest edge of a stored avatar. 512² is crisp on retina at every
 *  render size we use (size-6 … size-14) and stays tiny as WebP. */
export const MAX_AVATAR_PX = 512;

/** WebP quality — 0.82 is visually lossless for photos at this scale. */
export const AVATAR_WEBP_QUALITY = 0.82;

export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = src;
  });
}

/**
 * Crop `src` to the given square region, downscale to at most `maxPx`,
 * and encode as WebP. Never upscales past the source crop. Returns a
 * Blob ready to upload.
 */
export async function cropToWebp(
  src: string,
  crop: PixelCrop,
  {
    maxPx = MAX_AVATAR_PX,
    quality = AVATAR_WEBP_QUALITY,
  }: { maxPx?: number; quality?: number } = {}
): Promise<Blob> {
  const img = await loadImage(src);

  // aspect=1 in the cropper yields a square, but clamp to the shorter
  // side defensively so the output is always exactly square.
  const side = Math.round(Math.min(crop.width, crop.height));
  const target = Math.max(1, Math.min(side, maxPx));

  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    img,
    crop.x,
    crop.y,
    side,
    side, // source square (natural pixels)
    0,
    0,
    target,
    target // destination square (capped)
  );

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", quality)
  );
  if (!blob) throw new Error("Could not process the image.");
  return blob;
}
