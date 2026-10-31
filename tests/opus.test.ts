import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { oggOpusToWav } from "../lib/media/opus.ts";

test("a WhatsApp-style Ogg/Opus voice note becomes 16 kHz mono WAV", async () => {
  const ogg = readFileSync(new URL("../public/selftest/voice.ogg", import.meta.url));
  const wav = await oggOpusToWav(new Uint8Array(ogg));
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(view.getUint16(22, true), 1, "mono");
  assert.equal(view.getUint32(24, true), 16000, "16 kHz");
  const seconds = (wav.byteLength - 44) / 2 / 16000;
  assert.ok(seconds > 9.5 && seconds < 10.5, `about 10 s, got ${seconds.toFixed(2)}`);
});
