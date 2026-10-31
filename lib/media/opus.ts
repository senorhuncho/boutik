import { OggOpusDecoder } from "ogg-opus-decoder";
import { encodeWav } from "./wav.ts";

/**
 * WhatsApp voice notes arrive as Ogg/Opus. The models hear WAV best, so the
 * note is decoded here (WebAssembly, no native code) and written as 16 kHz
 * mono PCM, the same format the phone sends for the stall video's sound.
 */
export async function oggOpusToWav(ogg: Uint8Array, targetRate = 16_000): Promise<Uint8Array<ArrayBuffer>> {
  const decoder = new OggOpusDecoder();
  await decoder.ready;
  try {
    const { channelData, sampleRate } = await decoder.decodeFile(ogg);
    const channels = channelData.length || 1;
    const length = channelData[0]?.length ?? 0;
    const mono = new Float32Array(length);
    for (const channel of channelData) for (let i = 0; i < length; i++) mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / channels;
    return encodeWav(downsample(mono, sampleRate, targetRate), targetRate);
  } finally {
    decoder.free();
  }
}

/** Plain averaging resampler: enough for speech going from 48 kHz to 16 kHz. */
function downsample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j] ?? 0;
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}
