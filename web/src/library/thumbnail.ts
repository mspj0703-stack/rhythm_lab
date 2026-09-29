/** Optional artwork: decode one muted frame without changing the gameplay media. */
export function captureThumbnail(source: Blob | string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (value?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      video.onloadeddata = null; video.onerror = null;
      video.pause(); video.removeAttribute("src"); video.load();
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(value);
    };
    video.muted = true; video.playsInline = true; video.preload = "auto";
    video.onloadeddata = () => {
      try {
        if (!video.videoWidth || !video.videoHeight) { finish(); return; }
        const canvas = document.createElement("canvas");
        canvas.width = 240; canvas.height = Math.max(1, Math.round(240 * video.videoHeight / video.videoWidth));
        const context = canvas.getContext("2d");
        if (!context) { finish(); return; }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.7));
      } catch { finish(); }
    };
    video.onerror = () => finish();
    timer = setTimeout(() => finish(), 3000);
    video.src = url;
  });
}
