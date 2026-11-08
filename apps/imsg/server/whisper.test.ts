import { describe, expect, test } from "bun:test";
import { OverlayDb } from "./db";
import type { GenericId } from "convex/values";
import { WhisperService, probeWhisper, type AudioSource, type ProcessResult, type WhisperRuntime } from "./whisper";

class FakeWhisperRuntime implements WhisperRuntime {
  readonly files = new Map<string, Uint8Array | string>();
  readonly commands: string[][] = [];
  readonly timeouts: number[] = [];
  executableValue = true;
  afconvertPath: string | null = "/usr/bin/afconvert";
  processResults: ProcessResult[] = [];

  exists(path: string): boolean {
    return this.files.has(path) || path === "/bin/whisper" || path === "/models/small.bin";
  }
  executable(): boolean {
    return this.executableValue;
  }
  which(): string | null {
    return this.afconvertPath;
  }
  mkdir(): void {}
  write(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes);
  }
  readText(path: string): string {
    const value = this.files.get(path);
    return typeof value === "string" ? value : "";
  }
  remove(path: string): void {
    this.files.delete(path);
  }
  async run(command: string[], timeoutMs: number): Promise<ProcessResult> {
    this.commands.push(command);
    this.timeouts.push(timeoutMs);
    const result = this.processResults.shift() ?? { exitCode: 0, stderr: "" };
    if (result.exitCode === 0 && command.includes("-otxt")) {
      const prefix = command[command.indexOf("-of") + 1];
      if (prefix) this.files.set(`${prefix}.txt`, "Bonjour from the memo\n");
    }
    return result;
  }
}

const config = {
  binaryPath: "/bin/whisper",
  modelPath: "/models/small.bin",
  workDir: "/tmp/whisper-tests",
};

const CONVERSATION = "conversation-1" as GenericId<"comma_conversations">;

/** Convex storage's copy of the memo, by attachment and conversation, as the ai lane reads it. */
function storedAudio(calls: string[] = []): AudioSource {
  return async (guid, conversationId) => {
    calls.push(`${guid}@${conversationId}`);
    return guid === "audio1" ? { ok: true, bytes: new Uint8Array([1, 2, 3]), filename: "memo.m4a" } : { ok: false, error: "The original is not in Convex storage yet" };
  };
}

describe("Whisper availability", () => {
  test("gracefully reports missing configuration", () => {
    const runtime = new FakeWhisperRuntime();
    expect(probeWhisper({ ...config, binaryPath: null }, runtime)).toEqual({
      available: false,
      detail: "WHISPER_BINARY_PATH is not configured",
    });
    runtime.afconvertPath = null;
    expect(probeWhisper(config, runtime)).toEqual({
      available: false,
      detail: "macOS afconvert is unavailable",
    });
  });
});

describe("Whisper transcription", () => {
  test("reads the original from Convex storage, converts, caches, and reuses the cache", async () => {
    const runtime = new FakeWhisperRuntime();
    const db = new OverlayDb(":memory:");
    const reads: string[] = [];
    const service = new WhisperService(config, db, storedAudio(reads), runtime);
    expect(await service.transcribe("audio1", CONVERSATION)).toEqual({ state: "ready", text: "Bonjour from the memo" });
    expect(reads).toEqual(["audio1@conversation-1"]);
    expect(runtime.commands).toHaveLength(2);
    expect(runtime.commands[0]?.some((arg) => arg.endsWith(".source.m4a"))).toBe(true);
    expect(runtime.timeouts).toEqual([60_000, 15 * 60_000]);
    expect(db.getAttachmentTranscript("audio1")).toBe("Bonjour from the memo");
    expect(await service.transcribe("audio1", CONVERSATION)).toEqual({ state: "ready", text: "Bonjour from the memo" });
    expect(runtime.commands).toHaveLength(2);
    expect(reads).toHaveLength(1);
  });

  test("a memo whose original has not reached storage fails without running whisper", async () => {
    const runtime = new FakeWhisperRuntime();
    const service = new WhisperService(config, new OverlayDb(":memory:"), storedAudio(), runtime);
    expect(await service.transcribe("audio2", CONVERSATION)).toEqual({ state: "failed", error: "The original is not in Convex storage yet" });
    expect(runtime.commands).toEqual([]);
  });

  test("returns a typed process failure and does not cache it", async () => {
    const runtime = new FakeWhisperRuntime();
    runtime.processResults.push({ exitCode: 1, stderr: "unsupported input" });
    const db = new OverlayDb(":memory:");
    const service = new WhisperService(config, db, storedAudio(), runtime);
    expect(await service.transcribe("audio1", CONVERSATION)).toEqual({
      state: "failed",
      error: "Audio conversion failed: unsupported input",
    });
    expect(db.getAttachmentTranscript("audio1")).toBeNull();
  });
});
