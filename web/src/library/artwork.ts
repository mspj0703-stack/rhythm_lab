const MAX_EDGE = 960;
const JPEG_QUALITY = 0.86;

export function isSupportedArtworkType(type: string, name = ""): boolean {
  return /^(image\/(jpeg|png|webp))$/i.test(type) || (!type && /\.(jpe?g|png|webp)$/i.test(name));
}

async function blobToPersistentJpeg(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이미지를 처리할 수 없습니다.");
    ctx.fillStyle = "#171226";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally { bitmap.close(); }
}

export async function prepareCustomCover(file: File): Promise<string> {
  if (!isSupportedArtworkType(file.type, file.name)) throw new Error("JPG, PNG, WebP 이미지만 사용할 수 있습니다.");
  return blobToPersistentJpeg(file);
}

/** Converts source artwork into IndexedDB-safe bytes; never stores a TTL/remote URL as the canonical original. */
export async function persistOriginalThumbnail(source?: string): Promise<string | undefined> {
  const value = source?.trim();
  if (!value) return undefined;
  if (value.startsWith("data:image/")) return value;
  try {
    const response = await fetch(value, { cache: "no-store" });
    if (!response.ok) return undefined;
    const blob = await response.blob();
    if (!isSupportedArtworkType(blob.type)) return undefined;
    return await blobToPersistentJpeg(blob);
  } catch { return undefined; }
}
