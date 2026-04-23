// src/lib/security/auditLog.js
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

const DEFAULT_LOG_FILE = path.join(DATA_DIR, "audit.log");
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10MB

class AuditLogger {
  constructor() {
    this.enabled = true;
    this.maxSize = DEFAULT_MAX_SIZE;
  }

  log(event, data, logFile = DEFAULT_LOG_FILE) {
    if (!this.enabled) return;

    try {
      const entry = {
        timestamp: new Date().toISOString(),
        event,
        ...data
      };

      const line = JSON.stringify(entry) + "\n";
      
      // Ensure directory exists
      const dir = path.dirname(logFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Append to file
      fs.appendFileSync(logFile, line, "utf-8");
    } catch (error) {
      // Don't block requests on log failure
      console.error("[AuditLog] Failed to write log:", error.message);
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  setMaxSize(size) {
    this.maxSize = size;
  }
}

export const auditLog = new AuditLogger();
