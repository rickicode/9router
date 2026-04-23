"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-[var(--color-text-muted)] text-[13px] uppercase font-medium">Total Requests</span>
        <span className="text-[24px] font-medium">{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-[var(--color-text-muted)] text-[13px] uppercase font-medium">Total Input Tokens</span>
        <span className="text-[24px] font-medium text-[var(--color-accent)]">{fmt(stats.totalPromptTokens)}</span>
      </Card>
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-[var(--color-text-muted)] text-[13px] uppercase font-medium">Output Tokens</span>
        <span className="text-[24px] font-medium text-success">{fmt(stats.totalCompletionTokens)}</span>
      </Card>
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-[var(--color-text-muted)] text-[13px] uppercase font-medium">Est. Cost</span>
        <span className="text-[24px] font-medium text-warning">~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-[var(--color-text-muted)]">Estimated, not actual billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
