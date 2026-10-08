declare global { interface Window { BeatdashArtwork?: { pickCover(): void } } }
export function hasNativeArtworkPicker(): boolean { return typeof window !== "undefined" && Boolean(window.BeatdashArtwork?.pickCover); }
export function requestNativeArtwork(): void { window.BeatdashArtwork?.pickCover(); }
