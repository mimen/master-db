import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "./config";

const originalPassword = Bun.env.BB_PASSWORD;
const originalHost = Bun.env.HOST;

beforeEach(() => {
  Bun.env.BB_PASSWORD = "test-password";
  delete Bun.env.HOST;
});

afterEach(() => {
  if (originalPassword === undefined) delete Bun.env.BB_PASSWORD;
  else Bun.env.BB_PASSWORD = originalPassword;
  if (originalHost === undefined) delete Bun.env.HOST;
  else Bun.env.HOST = originalHost;
});

describe("loadConfig network boundary", () => {
  test("binds to loopback by default", () => {
    expect(loadConfig().hostname).toBe("127.0.0.1");
  });

  test("accepts an explicit loopback host", () => {
    Bun.env.HOST = "::1";
    expect(loadConfig().hostname).toBe("::1");
  });

  test("rejects a non-loopback host", () => {
    Bun.env.HOST = "0.0.0.0";
    expect(() => loadConfig()).toThrow("HOST must be a loopback hostname");
  });
});
