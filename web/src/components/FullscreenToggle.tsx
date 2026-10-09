import { useEffect, useState } from "react";
import { fullscreenAvailable, isFullscreen, toggleFullscreen } from "../platform/fullscreen";

export function FullscreenToggle() {
  const [on, setOn] = useState(isFullscreen);
  useEffect(() => {
    const update = () => setOn(isFullscreen());
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  if (!fullscreenAvailable()) return null;
  return <button type="button" className="fullscreen-toggle" aria-pressed={on} aria-label={on ? "전체화면 종료" : "전체화면"} onClick={(event) => { event.currentTarget.blur(); void toggleFullscreen().then(setOn); }}>{on ? "⤡" : "⤢"}</button>;
}
