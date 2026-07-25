import { describe, expect, test } from "bun:test";
import { OverlayDb } from "./db";
import { FakeBlueBubbles } from "./bluebubbles-fake";
import { WhisperService, probeWhisper, type ProcessResult, type WhisperRuntime } from "./whisper";

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

function fakeBlueBubbles(): FakeBlueBubbles {
  return new FakeBlueBubbles({
    chats: [],
    attachments: {
      audio1: {
        meta: { guid: "audio1", mimeType: "audio/mp4", transferName: "memo.m4a" },
        bytes: new Uint8Array([1, 2, 3]),
      },
    },
  });
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
  test("starts on demand and exposes working while the local job runs", async () => {
    const runtime = new FakeWhisperRuntime();
    const db = new OverlayDb(":memory:");
    const service = new WhisperService(config, fakeBlueBubbles(), db, runtime);
    expect(service.request("audio1")).toEqual({ state: "working" });
    expect(service.state("audio1")).toEqual({ state: "working" });
    await service.transcribe("audio1");
    expect(service.state("audio1")).toEqual({
      state: "ready",
      text: "Bonjour from the memo",
    });
  });

  test("downloads through the seam, converts, caches, and reuses the cache", async () => {
    const runtime = new FakeWhisperRuntime();
    const db = new OverlayDb(":memory:");
    const service = new WhisperService(config, fakeBlueBubbles(), db, runtime);
    expect(service.state("audio1")).toEqual({ state: "not-requested" });
    expect(await service.transcribe("audio1")).toEqual({
      state: "ready",
      text: "Bonjour from the memo",
    });
    expect(runtime.commands).toHaveLength(2);
    expect(runtime.timeouts).toEqual([60_000, 15 * 60_000]);
    expect(service.state("audio1")).toEqual({
      state: "ready",
      text: "Bonjour from the memo",
    });
    expect(await service.transcribe("audio1")).toEqual({
      state: "ready",
      text: "Bonjour from the memo",
    });
    expect(runtime.commands).toHaveLength(2);
  });

  test("returns a typed process failure and does not cache it", async () => {
    const runtime = new FakeWhisperRuntime();
    runtime.processResults.push({ exitCode: 1, stderr: "unsupported input" });
    const db = new OverlayDb(":memory:");
    const service = new WhisperService(config, fakeBlueBubbles(), db, runtime);
    expect(await service.transcribe("audio1")).toEqual({
      state: "failed",
      error: "Audio conversion failed: unsupported input",
    });
    expect(db.getAttachmentTranscript("audio1")).toBeNull();
    expect(service.state("audio1")).toEqual({
      state: "failed",
      error: "Audio conversion failed: unsupported input",
    });
  });
});
