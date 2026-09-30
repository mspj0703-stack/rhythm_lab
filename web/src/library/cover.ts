const MAX_EDGE = 960;
const JPEG_QUALITY = 0.86;

export async function prepareCustomCover(file: File): Promise<string> {
  if (!(file.type ? /^(image\/(jpeg|png|webp))$/i.test(file.type) : /\.(jpe?g|png|webp)$/i.test(file.name))) throw new Error("JPG, PNG, WebP 이미지만 사용할 수 있습니다.");
  const bitmap = await createImageBitmap(file);
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
