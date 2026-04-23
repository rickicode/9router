// tests/unit/ipValidator.test.js
import { describe, it, expect } from "vitest";
import { getClientIP, isWhitelistedIP, isLocalRequest } from "../../src/lib/security/ipValidator.js";

describe("IP Validator - IPv4 Localhost", () => {
  it("detects IPv4 localhost (127.0.0.1)", () => {
    const ip = "127.0.0.1";
    const whitelist = ["127.0.0.1", "::1"];
    expect(isWhitelistedIP(ip, whitelist)).toBe(true);
  });

  it("rejects non-whitelisted IPv4", () => {
    const ip = "192.168.1.100";
    const whitelist = ["127.0.0.1", "::1"];
    expect(isWhitelistedIP(ip, whitelist)).toBe(false);
  });

  it("extracts IP from mock request", () => {
    const mockRequest = {
      socket: { remoteAddress: "127.0.0.1" },
      headers: { get: () => null }
    };
    expect(getClientIP(mockRequest)).toBe("127.0.0.1");
  });
});
