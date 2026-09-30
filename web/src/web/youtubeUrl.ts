export function isYouTubeUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return ["https:", "http:"].includes(u.protocol) && ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(u.hostname) && !u.username && !u.password && !u.port;
  } catch { return false; }
}
