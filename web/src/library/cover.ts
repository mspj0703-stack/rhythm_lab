const MAX_EDGE = 960;
const JPEG_QUALITY = 0.86;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("이미지를 읽을 수 없습니다."));
    reader.onerror = () => reject(reader.error ?? new Error("이미지를 읽을 수 없습니다."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("이미지를 열 수 없습니다."));
    img.src = src;
  });
}

/** Android WebView compatible cover decoder. createImageBitmap is not reliable on every device. */
export async function prepareCustomCover(file: File): Promise<string> {
  const validMime = /^(image\/(jpeg|png|webp))$/i.test(file.type);
  const validName = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!validMime && !validName) throw new Error("JPG, PNG, WebP 이미지만 사용할 수 있습니다.");
  if (file.size <= 0) throw new Error("이미지 파일이 비어 있습니다.");
  if (file.size > 20 * 1024 * 1024) throw new Error("커버 이미지는 20MB 이하만 사용할 수 있습니다.");

  const source = await readAsDataUrl(file);
  const img = await loadImage(source);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error("이미지 크기를 확인할 수 없습니다.");
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("이미지를 처리할 수 없습니다.");
  ctx.fillStyle = "#171226";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}
