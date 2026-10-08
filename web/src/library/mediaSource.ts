import { useEffect } from "react";
import { deriveAudioFallbackUrls } from "../engine/mediaSources";
import type { LibrarySong } from "./types";

/**
 * One acquired playback source for a Library song. A Blob-backed song owns exactly one object URL,
 * and that URL is revoked only through `revoke()` once the player no longer uses it.
 */
export interface SongMediaHandle {
  url: string;
  audioFallbackUrls: string[];
  owned: boolean;
  revoke(): void;
}

export function openSongMedia(song: Pick<LibrarySong, "mediaBlob" | "sourceUrl" | "mediaKind">): SongMediaHandle | null {
  if (song.mediaBlob) {
    const url = URL.createObjectURL(song.mediaBlob);
    let revoked = false;
    return {
      url,
      // The same Blob URL feeds an <audio> element when the video track cannot be decoded.
      audioFallbackUrls: deriveAudioFallbackUrls(url, song.mediaKind),
      owned: true,
      revoke() { if (revoked) return; revoked = true; URL.revokeObjectURL(url); },
    };
  }
  if (!song.sourceUrl) return null;
  return {
    url: song.sourceUrl,
    audioFallbackUrls: deriveAudioFallbackUrls(song.sourceUrl, song.mediaKind),
    owned: false,
    revoke() { /* server/native URLs are not ours to revoke */ },
  };
}

/**
 * Releases a handle only after React has committed a render that no longer uses it
 * (handle replaced or screen left). Never revokes while the handle is still current.
 */
export function useMediaHandleRelease(handle: SongMediaHandle | null | undefined): void {
  useEffect(() => () => { handle?.revoke(); }, [handle]);
}
