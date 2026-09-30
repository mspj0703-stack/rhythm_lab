import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareCustomCover } from "../library/cover";
let close: ReturnType<typeof vi.fn>;
beforeEach(() => {
  close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width:1920, height:1080, close })));
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockReturnValue({fillRect:vi.fn(),drawImage:vi.fn()} as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"toDataURL").mockImplementation(function(this: HTMLCanvasElement){return `data:image/jpeg;size=${this.width}x${this.height}`;});
});
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals();});
it.each(["image/jpeg","image/png","image/webp"])("converts %s at max 960 edge and closes bitmap", async type => {
  expect(await prepareCustomCover(new File(["x"],"cover",{type}))).toBe("data:image/jpeg;size=960x540"); expect(close).toHaveBeenCalledOnce();
});
it("accepts an Android image filename with empty MIME",async()=>{expect(await prepareCustomCover(new File(["x"],"cover.PNG"))).toContain("image/jpeg");});
it("rejects non-image input",async()=>{await expect(prepareCustomCover(new File(["x"],"cover.svg",{type:"image/svg+xml"}))).rejects.toThrow("JPG");});
it("closes bitmap even if canvas encoding fails",async()=>{vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockImplementation(()=>{throw new Error("encode failed");});await expect(prepareCustomCover(new File(["x"],"c.jpg",{type:"image/jpeg"}))).rejects.toThrow("encode failed");expect(close).toHaveBeenCalledOnce();});
