// src/lib/security/ipValidator.js
export function getClientIP(request) {
  // Priority 1: Socket IP (most reliable)
  if (request?.socket?.remoteAddress) {
    return normalizeIP(request.socket.remoteAddress);
  }
  
  // Priority 2: X-Forwarded-For (if trusted proxy enabled)
  const xForwardedFor = request?.headers?.get?.("x-forwarded-for");
  if (xForwardedFor) {
    const firstIP = xForwardedFor.split(",")[0].trim();
    return normalizeIP(firstIP);
  }
  
  // Priority 3: X-Real-IP
  const xRealIP = request?.headers?.get?.("x-real-ip");
  if (xRealIP) {
    return normalizeIP(xRealIP);
  }
  
  return null;
}

export function normalizeIP(ip) {
  if (!ip) return null;
  
  // Remove IPv4-mapped IPv6 prefix (::ffff:127.0.0.1 → 127.0.0.1)
  if (ip.startsWith("::ffff:")) {
    return ip.substring(7);
  }
  
  return ip;
}

export function isWhitelistedIP(ip, whitelist) {
  if (!ip || !Array.isArray(whitelist)) return false;
  
  const normalizedIP = normalizeIP(ip);
  
  for (const entry of whitelist) {
    // Exact match
    if (entry === normalizedIP) {
      return true;
    }
    
    // CIDR match (handled in next task)
    if (entry.includes("/")) {
      // Placeholder for CIDR logic
      continue;
    }
  }
  
  return false;
}

export function isLocalRequest(request, settings) {
  const clientIP = getClientIP(request);
  if (!clientIP) return false;
  
  const whitelist = settings?.ipWhitelist || ["127.0.0.1", "::1", "172.17.0.0/16"];
  return isWhitelistedIP(clientIP, whitelist);
}
