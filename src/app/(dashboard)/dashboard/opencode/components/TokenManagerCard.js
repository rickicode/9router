"use client";

import { useState } from "react";
import { Badge, Button, Card, Input } from "@/shared/components";

function formatDate(value) {
  if (!value) return "Never";

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function TokenManagerCard({
  tokens = [],
  creating = false,
  createError = "",
  createdToken = "",
  onCreate,
}) {
  const [name, setName] = useState("My Token");
  const [showInstructions, setShowInstructions] = useState(false);

  return (
    <Card
      title="Auto-sync tokens"
      subtitle="Create tokens to enable automatic config sync from this dashboard."
      icon="vpn_key"
      className="rounded-[24px] border-[var(--color-border)] shadow-[0_16px_42px_rgba(0,0,0,0.04)] dark:border-white/5"
    >
      <div className="space-y-6">
        <div className="rounded-[24px] border border-primary/10 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent px-5 py-[1.125rem]">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13px] font-medium text-[var(--color-text-main)]">Create a sync token</p>
              <p className="text-[11px] leading-5 text-[var(--color-text-muted)]">Tokens allow OpenCode to sync config from this dashboard automatically.</p>
            </div>
            <Badge size="sm">{tokens.length} active</Badge>
          </div>
        </div>

        <Card.Section className="rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)]/[0.78] px-5 py-5 dark:border-white/5 dark:bg-[var(--color-surface)]/[0.02]">
          <div className="mb-4 space-y-1">
            <p className="text-[13px] font-medium text-[var(--color-text-main)]">Issue a new token</p>
            <p className="text-[11px] leading-5 text-[var(--color-text-muted)]">New token values are only shown once, so create them only when you are ready to copy.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Input
              label="Token name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Production Server"
              hint="Give it a descriptive name to identify where it's used."
            />
            <div className="flex items-end">
              <Button
                fullWidth
                loading={creating}
                onClick={() => onCreate?.({ name, mode: "shared" })}
                disabled={!name.trim()}
              >
                Create token
              </Button>
            </div>
          </div>
        </Card.Section>

        {createError ? (
          <div className="rounded border border-[var(--color-danger)]/20 bg-[rgba(255,59,48,0.05)] px-4 py-3 text-[13px] text-[var(--color-danger)] dark:text-[var(--color-danger)]">
            {createError}
          </div>
        ) : null}

        {createdToken ? (
          <div className="space-y-4">
            <Card.Section className="space-y-3 rounded-[24px] border border-[var(--color-success)]/20 bg-emerald-500/[0.06] px-5 py-[1.125rem]">
              <div className="flex items-center gap-2">
                <Badge variant="success">New token</Badge>
                <span className="text-[11px] text-[var(--color-text-muted)]">Shown once — copy it now.</span>
              </div>
              <code className="block overflow-x-auto rounded-md bg-[var(--color-primary)] px-3 py-2 text-[11px] text-[var(--color-text-inverse)]">
                {createdToken}
              </code>
              <div className="rounded-md border border-[rgba(255,159,10,0.2)] bg-[var(--color-warning)]/10 px-3 py-2 text-[11px] text-[var(--color-warning)] dark:text-[var(--color-warning)]">
                ⚠️ This token will not be shown again. Save it securely before closing this message.
              </div>
            </Card.Section>

            {/* Setup Instructions */}
            <Card.Section className="space-y-3 rounded-[24px] border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/[0.06] px-5 py-[1.125rem]">
              <button
                type="button"
                onClick={() => setShowInstructions(!showInstructions)}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-[13px] font-medium text-[var(--color-accent-hover)] dark:text-[var(--color-accent)]">
                  📋 Setup Instructions
                </span>
                <span className="text-[var(--color-accent-hover)] dark:text-[var(--color-accent)]">
                  {showInstructions ? "▼" : "▶"}
                </span>
              </button>

              {showInstructions && (
                <div className="space-y-4 pt-2 text-[11px] text-[var(--color-accent)] ">
                  <div>
                    <p className="font-medium mb-2">1. Add to opencode.json plugin array:</p>
                    <code className="block rounded-md bg-[var(--color-primary)] px-3 py-2 text-[11px] text-[var(--color-text-inverse)] overflow-x-auto">
                      "plugin": ["opencode-9router-sync@latest", ...]
                    </code>
                  </div>

                  <div>
                    <p className="font-medium mb-2">2. Create config file:</p>
                    
                    {/* Standard */}
                    <div className="mb-3 rounded-md border border-gray-500/20 bg-gray-500/10 p-3">
                      <p className="font-medium mb-1 text-[var(--color-text-main)]">Standard:</p>
                      <code className="block text-[10px] text-[var(--color-text-muted)] mb-2">
                        ~/.config/opencode-9router-sync/config.json
                      </code>
                      <pre className="rounded-md bg-black px-3 py-2 text-[10px] text-[var(--color-text-inverse)] overflow-x-auto">
{`{
  "dashboardUrl": "${typeof window !== "undefined" ? window.location.origin : "http://localhost:20129"}",
  "syncToken": "${createdToken}",
  "lastKnownVersion": null
}`}
                      </pre>
                    </div>

                    {/* OCX Profile */}
                    <div className="rounded-md border border-[var(--color-success)]/20 bg-[var(--color-success)]/10 p-3">
                      <p className="font-medium mb-1 text-[var(--color-success)] dark:text-[var(--color-success)]">With OCX Profile:</p>
                      <code className="block text-[10px] text-[var(--color-success)] dark:text-[var(--color-success)] mb-2">
                        ~/.config/opencode/profiles/&lt;profilename&gt;/opencode-9router-sync/config.json
                      </code>
                      <pre className="rounded-md bg-black px-3 py-2 text-[10px] text-[var(--color-text-inverse)] overflow-x-auto">
{`{
  "dashboardUrl": "${typeof window !== "undefined" ? window.location.origin : "http://localhost:20129"}",
  "syncToken": "${createdToken}",
  "lastKnownVersion": null
}`}
                      </pre>
                    </div>
                  </div>

                  <div className="rounded-md border border-[var(--color-accent)]/20 bg-[var(--color-accent)]/10 px-3 py-2">
                    <p className="text-[var(--color-accent-hover)] ">
                      ✨ <strong>Auto-sync:</strong> The plugin will automatically sync your config from 9Router dashboard on OpenCode startup.
                    </p>
                  </div>
                </div>
              )}
            </Card.Section>
          </div>
        ) : null}

        <div className="space-y-4">
          {tokens.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-black/8 bg-black/[0.015] px-5 py-6 text-[13px] text-[var(--color-text-muted)] dark:border-[var(--color-border)] dark:bg-[var(--color-surface)]/[0.015]">
              No auto-sync tokens created yet.
            </div>
          ) : (
            tokens.map((token) => (
              <Card.Section key={token.id} className="space-y-4 rounded-[24px] border border-[var(--color-border)] bg-[var(--color-surface)]/[0.75] px-5 py-5 dark:border-white/5 dark:bg-[var(--color-surface)]/[0.02]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] font-medium text-[var(--color-text-main)]">{token.name}</div>
                    <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">Created {formatDate(token.createdAt)}</div>
                  </div>
                </div>
                {token.metadata && Object.keys(token.metadata).length > 0 ? (
                  <pre className="overflow-x-auto rounded-md bg-black/[0.03] px-3 py-2 text-[11px] text-[var(--color-text-muted)] dark:bg-[var(--color-surface)]/[0.03]">
                    {JSON.stringify(token.metadata, null, 2)}
                  </pre>
                ) : null}
                <div className="text-[11px] text-[var(--color-text-muted)]">Last used: {formatDate(token.lastUsedAt)}</div>
              </Card.Section>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
