// tests/unit/auditLog.test.js
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { auditLog } from "../../src/lib/security/auditLog.js";
import fs from "node:fs";
import path from "node:path";

const TEST_LOG_DIR = path.join(process.cwd(), "tests/tmp");
const TEST_LOG_FILE = path.join(TEST_LOG_DIR, "audit.log");

describe("Audit Logger - Basic Logging", () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_LOG_DIR)) {
      fs.mkdirSync(TEST_LOG_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_LOG_FILE)) {
      fs.unlinkSync(TEST_LOG_FILE);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_LOG_FILE)) {
      fs.unlinkSync(TEST_LOG_FILE);
    }
  });

  it("logs event to file in NDJSON format", () => {
    auditLog.log("auth_bypass_attempt", {
      ip: "192.168.1.100",
      path: "/api/settings",
      allowed: false,
      reason: "ip_not_whitelisted"
    }, TEST_LOG_FILE);

    const content = fs.readFileSync(TEST_LOG_FILE, "utf-8");
    const log = JSON.parse(content.trim());
    
    expect(log.event).toBe("auth_bypass_attempt");
    expect(log.ip).toBe("192.168.1.100");
    expect(log.allowed).toBe(false);
    expect(log.timestamp).toBeDefined();
  });

  it("appends multiple events", () => {
    auditLog.log("login_attempt", { ip: "127.0.0.1", success: true }, TEST_LOG_FILE);
    auditLog.log("login_attempt", { ip: "127.0.0.1", success: false }, TEST_LOG_FILE);

    const content = fs.readFileSync(TEST_LOG_FILE, "utf-8");
    const lines = content.trim().split("\n");
    
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).success).toBe(true);
    expect(JSON.parse(lines[1]).success).toBe(false);
  });
});
