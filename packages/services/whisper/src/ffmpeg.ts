// Thin wrapper around the system `ffmpeg` binary (provided by the host) for
// converting a browser webm/opus clip to the 16 kHz mono 16-bit WAV whisper.cpp
// requires.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ONE_MINUTE_MS } from "./internal.ts";

const execFileAsync = promisify(execFile);

/** ffmpeg args to decode any input to 16 kHz mono signed-16-bit WAV. Pure +
 *  exported for unit tests. */
export function buildWav16kArgs(inputPath: string, outputPath: string): string[] {
  return ["-y", "-loglevel", "error", "-i", inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", outputPath];
}

/** Convert `inputPath` to a 16 kHz mono WAV at `outputPath`. Throws on ffmpeg
 *  failure or timeout. */
export async function convertToWav16k(inputPath: string, outputPath: string, ffmpegBinary = "ffmpeg"): Promise<void> {
  await execFileAsync(ffmpegBinary, buildWav16kArgs(inputPath, outputPath), {
    timeout: ONE_MINUTE_MS,
  });
}
