import {stat} from "node:fs/promises";
import {resolve} from "node:path";
import {ALL_FORMATS, FilePathSource, Input} from "mediabunny";

const path = resolve(process.argv[2] ?? "out/usefuldesk-promo.mp4");
const input = new Input({
  formats: ALL_FORMATS,
  source: new FilePathSource(path),
});
const video = await input.getPrimaryVideoTrack();
const audio = await input.getPrimaryAudioTrack();

if (!video) {
  throw new Error("Rendered file has no video track");
}

console.log(JSON.stringify({
  path,
  width: video.displayWidth,
  height: video.displayHeight,
  durationSeconds: await input.computeDuration(),
  hasAudio: Boolean(audio),
  bytes: (await stat(path)).size,
}, null, 2));
