/**
 * Refresh pill — shows "Updated X ago" with a click-to-recompute button.
 * Same UX as the Intelligence module so all heavy pages feel consistent.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

function timeAgo(iso) {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (!then) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function RefreshPill({ asOf, onRefresh, busy, testId = "refresh-pill" }) {
  // Re-render every 30 s so the "X ago" stays accurate.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={busy}
      title="Recompute now"
      data-testid={testId}
      className="inline-flex items-center gap-2 h-9 px-3 rounded-xl border border-slate-200 bg-white text-[12px] font-semibold text-slate-600 hover:border-violet-300 hover:text-violet-700 hover:bg-violet-50 transition-colors disabled:opacity-60 disabled:cursor-wait"
    >
      <RefreshCw className={`h-3.5 w-3.5 text-slate-400 ${busy ? "animate-spin" : ""}`} />
      <span className="text-slate-500">
        {busy ? "Refreshing…" : `Updated ${timeAgo(asOf)}`}
      </span>
      <span className="text-violet-700">Refresh</span>
    </button>
  );
}

export default RefreshPill;
