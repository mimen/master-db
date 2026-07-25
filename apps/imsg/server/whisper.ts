import { accessSync, constants, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import type { TranscriptState } from "../shared/types";
import type { WhisperConfig } from "./config";
import type { BlueBubbles } from "./bluebubbles";
import { safeAttachmentGuid } from "./attachment-guid";

export interface TranscriptCache {
  getAttachmentTranscript(attachmentGuid: string): string | null;
  setAttachmentTranscript(attachmentGuid: string, text: string): void;
}

export interface ProcessResult {
  exitCode: number;
  stderr: string;
}

export interface WhisperRuntime {
  exists(path: string): boolean;
  executable(path: string): boolean;
  which(binary: string): string | null;
  mkdir(path: string): void;
  write(path: string, bytes: Uint8Array): void;
  readText(path: string): string;
  remove(path: string): void;
  run(command: string[], timeoutMs: number): Promise<ProcessResult>;
}

export const whisperRuntime: WhisperRuntime = {
  exists: (path: string): boolean => existsSync(path),
  executable: (path: string): boolean => {
    try {
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  which: (binary: string): string | null => Bun.which(binary),
  mkdir: (path: string): void => {
    mkdirSync(path, { recursive: true });
  },
  write: (path: string, bytes: Uint8Array): void => writeFileSync(path, bytes),
  readText: (path: string): string => readFileSync(path, "utf8"),
  remove: (path: string): void => {
    try {
      unlinkSync(path);
    } catch {
      // Missing cleanup files are harmless.
    }
  },
  run: async (command: string[], timeoutMs: number): Promise<ProcessResult> => {
    const process = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      process.kill(9);
    }, timeoutMs);
    const [stderr, exitCode] = await Promise.all([
      new Response(process.stderr).text(),
      process.exited,
    ]);
    clearTimeout(timer);
    return {
      exitCode: timedOut ? 124 : exitCode,
      stderr: timedOut ? `Process timed out after ${timeoutMs}ms` : stderr,
    };
  },
};

const AUDIO_CONVERSION_TIMEOUT_MS = 60_000;
const WHISPER_PROCESS_TIMEOUT_MS = 15 * 60_000;

export type WhisperAvailability =
  | { available: true; afconvertPath: string }
  | { available: false; detail: string };

export function probeWhisper(config: WhisperConfig, runtime: WhisperRuntime): WhisperAvailability {
  if (!config.binaryPath) return { available: false, detail: "WHISPER_BINARY_PATH is not configured" };
  if (!runtime.exists(config.binaryPath)) {
    return { available: false, detail: `Whisper binary not found: ${config.binaryPath}` };
  }
  if (!runtime.executable(config.binaryPath)) {
    return { available: false, detail: `Whisper binary is not executable: ${config.binaryPath}` };
  }
  if (!config.modelPath) return { available: false, detail: "WHISPER_MODEL_PATH is not configured" };
  if (!runtime.exists(config.modelPath)) {
    return { available: false, detail: `Whisper model not found: ${config.modelPath}` };
  }
  const afconvertPath = runtime.which("afconvert");
  if (!afconvertPath) {
    return { available: false, detail: "macOS afconvert is unavailable" };
  }
  return { available: true, afconvertPath };
}

function errorMessage(error: Error | string): string {
  return typeof error === "string" ? error : error.message;
}

function processFailure(label: string, result: ProcessResult): TranscriptState {
  const detail = result.stderr.trim().slice(0, 300);
  return { state: "failed", error: detail ? `${label}: ${detail}` : `${label} exited ${result.exitCode}` };
}

export class WhisperService {
  private readonly availabilityValue: WhisperAvailability;
  private readonly inFlight = new Map<string, Promise<TranscriptState>>();
  private readonly failures = new Map<string, Extract<TranscriptState, { state: "failed" }>>();
  /** One model process at a time keeps Mini CPU and memory use predictable. */
  private queueTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: WhisperConfig,
    private readonly bb: BlueBubbles,
    private readonly cache: TranscriptCache,
    private readonly runtime: WhisperRuntime = whisperRuntime,
  ) {
    this.availabilityValue = probeWhisper(config, runtime);
  }

  availability(): WhisperAvailability {
    return this.availabilityValue;
  }

  state(attachmentGuid: string): TranscriptState {
    const cached = this.cache.getAttachmentTranscript(attachmentGuid);
    if (cached !== null) return { state: "ready", text: cached };
    if (!this.availabilityValue.available) {
      return { state: "unavailable", detail: this.availabilityValue.detail };
    }
    if (this.inFlight.has(attachmentGuid)) return { state: "working" };
    return this.failures.get(attachmentGuid) ?? { state: "not-requested" };
  }

  request(attachmentGuid: string): TranscriptState {
    const current = this.state(attachmentGuid);
    if (current.state === "not-requested" || current.state === "failed") {
      void this.transcribe(attachmentGuid);
      return { state: "working" };
    }
    return current;
  }

  transcribe(attachmentGuid: string): Promise<TranscriptState> {
    const existing = this.inFlight.get(attachmentGuid);
    if (existing) return existing;
    this.failures.delete(attachmentGuid);
    const task = this.enqueue(() => this.performTranscription(attachmentGuid))
      .catch((error) => ({
        state: "failed" as const,
        error: errorMessage(error instanceof Error ? error : "Unexpected transcription failure"),
      }))
      .then((result) => {
        if (result.state === "failed") this.failures.set(attachmentGuid, result);
        else this.failures.delete(attachmentGuid);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(attachmentGuid);
      });
    this.inFlight.set(attachmentGuid, task);
    return task;
  }

  private enqueue(run: () => Promise<TranscriptState>): Promise<TranscriptState> {
    const task = this.queueTail.then(run, run);
    this.queueTail = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async performTranscription(attachmentGuid: string): Promise<TranscriptState> {
    const cached = this.cache.getAttachmentTranscript(attachmentGuid);
    if (cached !== null) return { state: "ready", text: cached };
    if (!this.availabilityValue.available || !this.config.binaryPath || !this.config.modelPath) {
      return {
        state: "unavailable",
        detail: this.availabilityValue.available
          ? "Whisper configuration is incomplete"
          : this.availabilityValue.detail,
      };
    }

    const meta = await this.bb.attachmentMeta(attachmentGuid);
    if (!meta.ok) return { state: "failed", error: `Attachment metadata: ${meta.error}` };
    const download = await this.bb.downloadAttachment(attachmentGuid);
    if (!download.ok) return { state: "failed", error: `Audio download failed (${download.status})` };

    const safeGuid = safeAttachmentGuid(attachmentGuid);
    const rawExtension = extname(meta.value.transferName ?? "") || ".audio";
    const sourceExtension = rawExtension.replace(/[^.A-Za-z0-9]/g, "") || ".audio";
    const sourcePath = join(this.config.workDir, `${safeGuid}.source${sourceExtension}`);
    const wavPath = join(this.config.workDir, `${safeGuid}.wav`);
    const outputPrefix = join(this.config.workDir, `${safeGuid}.transcript`);
    const outputPath = `${outputPrefix}.txt`;
    this.runtime.mkdir(this.config.workDir);

    try {
      this.runtime.write(sourcePath, new Uint8Array(await download.arrayBuffer()));
      const converted = await this.runtime.run([
        this.availabilityValue.afconvertPath,
        "-f",
        "WAVE",
        "-d",
        "LEI16@16000",
        "-c",
        "1",
        sourcePath,
        wavPath,
      ], AUDIO_CONVERSION_TIMEOUT_MS);
      if (converted.exitCode !== 0) return processFailure("Audio conversion failed", converted);

      const whispered = await this.runtime.run([
        this.config.binaryPath,
        "-m",
        this.config.modelPath,
        "-f",
        wavPath,
        "-l",
        "auto",
        "-otxt",
        "-of",
        outputPrefix,
      ], WHISPER_PROCESS_TIMEOUT_MS);
      if (whispered.exitCode !== 0) return processFailure("Transcription failed", whispered);
      if (!this.runtime.exists(outputPath)) {
        return { state: "failed", error: "Whisper did not produce a transcript file" };
      }
      const text = this.runtime.readText(outputPath).trim();
      if (!text) return { state: "failed", error: "Whisper produced an empty transcript" };
      this.cache.setAttachmentTranscript(attachmentGuid, text);
      return { state: "ready", text };
    } catch (error) {
      return {
        state: "failed",
        error: errorMessage(error instanceof Error ? error : "Unexpected transcription failure"),
      };
    } finally {
      for (const path of [sourcePath, wavPath, outputPath]) this.runtime.remove(path);
    }
  }
}
