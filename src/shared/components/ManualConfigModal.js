"use client";

import { useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function ManualConfigModal({ isOpen, onClose, title = "Manual Configuration", configs = [] }) {
  const { copy } = useCopyToClipboard();
  const [copiedIndex, setCopiedIndex] = useState(null);

  const copyConfig = (text, index) => {
    copy(text, `manualconfig-${index}`);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
      <div className="flex flex-col gap-4">
        {configs.map((config, index) => (
          <div key={index} className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-medium text-[var(--color-text-main)]">{config.filename}</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyConfig(config.content, index)}
              >
                <span className="material-symbols-outlined text-[14px] mr-1">
                  {copiedIndex === index ? "check" : "content_copy"}
                </span>
                {copiedIndex === index ? "Copied!" : "Copy"}
              </Button>
            </div>
            <pre className="px-3 py-2 bg-[rgba(0,0,0,0.05)] dark:bg-[rgba(255,255,255,0.05)] rounded font-mono text-[12px] overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto border border-[var(--color-border)]">
              {config.content}
            </pre>
          </div>
        ))}
      </div>
    </Modal>
  );
}
