"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Input } from "@/shared/components";

/**
 * Cursor Auth Modal
 * Auto-detect and import token from Cursor IDE's local SQLite database
 */
export default function CursorAuthModal({ isOpen, onSuccess, onClose }) {
  const [accessToken, setAccessToken] = useState("");
  const [machineId, setMachineId] = useState("");
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetected, setAutoDetected] = useState(false);
  const [windowsManual, setWindowsManual] = useState(false);

  const runAutoDetect = async () => {
    setAutoDetecting(true);
    setError(null);
    setAutoDetected(false);
    setWindowsManual(false);

    try {
      const res = await fetch("/api/oauth/cursor/auto-import");
      const data = await res.json();

      if (data.found) {
        setAccessToken(data.accessToken);
        setMachineId(data.machineId);
        setAutoDetected(true);
      } else if (data.windowsManual) {
        setWindowsManual(true);
      } else {
        setError(data.error || "Could not auto-detect tokens");
      }
    } catch (err) {
      setError("Failed to auto-detect tokens");
    } finally {
      setAutoDetecting(false);
    }
  };

  // Auto-detect tokens when modal opens
  useEffect(() => {
    if (!isOpen) return;
    runAutoDetect();
  }, [isOpen]);

  const handleImportToken = async () => {
    if (!accessToken.trim()) {
      setError("Please enter an access token");
      return;
    }

    if (!machineId.trim()) {
      setError("Please enter a machine ID");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      const res = await fetch("/api/oauth/cursor/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accessToken: accessToken.trim(),
          machineId: machineId.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Import failed");
      }

      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Connect Cursor IDE" onClose={onClose}>
      <div className="flex flex-col gap-4">
        {/* Auto-detecting state */}
        {autoDetecting && (
          <div className="text-center py-6">
            <div className="size-16 mx-auto mb-4 rounded bg-[var(--color-primary)]/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-[30px] text-[var(--color-accent)] animate-spin">
                progress_activity
              </span>
            </div>
            <h3 className="text-[16px] font-medium mb-2">Auto-detecting tokens...</h3>
            <p className="text-[14px] text-[var(--color-text-muted)]">
              Reading from Cursor IDE database
            </p>
          </div>
        )}

        {/* Form (shown after auto-detect completes) */}
        {!autoDetecting && (
          <>
            {/* Success message if auto-detected */}
            {autoDetected && (
              <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded border border-green-200 dark:border-green-800">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-green-600 dark:text-green-400">check_circle</span>
                  <p className="text-[14px] text-green-800 dark:text-green-200">
                    Tokens auto-detected from Cursor IDE successfully!
                  </p>
                </div>
              </div>
            )}

            {/* Windows manual instructions */}
            {windowsManual && (
              <div className="bg-[rgba(255,159,10,0.1)] dark:bg-amber-900/20 p-3 rounded border border-[rgba(255,159,10,0.3)] dark:border-amber-800 flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <span className="material-symbols-outlined text-[var(--color-warning)] dark:text-[var(--color-warning)]">info</span>
                  <p className="text-[14px] font-medium text-amber-800 dark:text-amber-200">
                    Could not read Cursor database automatically.
                  </p>
                </div>
                <p className="text-[12px] text-amber-700 dark:text-amber-300">
                  Make sure Cursor IDE has been opened at least once, then click <strong>Retry</strong>. If the problem persists, paste your tokens manually below.
                </p>
                <Button onClick={runAutoDetect} variant="outline" fullWidth>
                  Retry
                </Button>
              </div>
            )}

            {/* Info message if not auto-detected */}
            {!autoDetected && !windowsManual && !error && (
              <div className="bg-[rgba(0,122,255,0.1)] dark:bg-blue-900/20 p-3 rounded border border-[rgba(0,122,255,0.3)] dark:border-[rgba(0,80,150,0.6)]">
                <div className="flex gap-2">
                  <span className="material-symbols-outlined text-[var(--color-accent)] dark:text-[var(--color-accent)]">info</span>
                  <p className="text-[14px] text-[#004085] dark:text-blue-200">
                    Cursor IDE not detected. Please paste your tokens manually.
                  </p>
                </div>
              </div>
            )}

            {/* Access Token Input */}
            <div>
              <label className="block text-[14px] font-medium mb-2">
                Access Token <span className="text-[var(--color-danger)]">*</span>
              </label>
              <textarea
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Access token will be auto-filled..."
                rows={3}
                className="w-full px-3 py-2 text-[14px] font-mono border border-[var(--color-border)] rounded bg-background focus:outline-none focus:border-primary resize-none"
              />
            </div>

            {/* Machine ID Input */}
            <div>
              <label className="block text-[14px] font-medium mb-2">
                Machine ID <span className="text-[var(--color-danger)]">*</span>
              </label>
              <Input
                value={machineId}
                onChange={(e) => setMachineId(e.target.value)}
                placeholder="Machine ID will be auto-filled..."
                className="font-mono text-[14px]"
              />
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-[rgba(255,59,48,0.1)] dark:bg-red-900/20 p-3 rounded border border-[rgba(255,59,48,0.3)] dark:border-[rgba(200,0,0,0.6)]">
                <p className="text-[14px] text-[var(--color-danger)] dark:text-[var(--color-danger)]">{error}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button
                onClick={handleImportToken}
                fullWidth
                disabled={importing || !accessToken.trim() || !machineId.trim()}
              >
                {importing ? "Importing..." : "Import Token"}
              </Button>
              <Button onClick={onClose} variant="ghost" fullWidth>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

CursorAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
};
