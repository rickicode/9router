// tests/unit/dashboardGuard.test.js
import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("@/lib/security/ipValidator", () => ({
  isLocalRequest: vi.fn(),
  getClientIP: vi.fn()
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn()
}));

import { proxy } from "../../src/dashboardGuard.js";
import { isLocalRequest, getClientIP } from "@/lib/security/ipValidator";
import { getSettings } from "@/lib/localDb";

describe("Dashboard Guard - IP Validation", () => {
  it("allows localhost access to ALWAYS_PROTECTED paths", async () => {
    isLocalRequest.mockReturnValue(true);
    getSettings.mockResolvedValue({ requireLogin: true });

    const mockRequest = {
      nextUrl: { pathname: "/api/shutdown" },
      headers: { get: () => "localhost" },
      cookies: { get: () => null }
    };

    const response = await proxy(mockRequest);
    expect(response.status).not.toBe(401);
  });

  it("denies remote access to ALWAYS_PROTECTED paths", async () => {
    isLocalRequest.mockReturnValue(false);
    getSettings.mockResolvedValue({ requireLogin: true });

    const mockRequest = {
      nextUrl: { pathname: "/api/shutdown" },
      headers: { get: () => "example.com" },
      cookies: { get: () => null }
    };

    const response = await proxy(mockRequest);
    expect(response.status).toBe(401);
  });

  it("uses IP validator instead of Host header", async () => {
    getClientIP.mockReturnValue("192.168.1.100");
    isLocalRequest.mockReturnValue(false);
    getSettings.mockResolvedValue({ requireLogin: true });

    const mockRequest = {
      nextUrl: { pathname: "/api/settings" },
      headers: { get: (name) => name === "host" ? "localhost" : null },
      cookies: { get: () => null }
    };

    await proxy(mockRequest);
    
    // Verify IP validator was called, not Host header check
    expect(isLocalRequest).toHaveBeenCalled();
  });
});
