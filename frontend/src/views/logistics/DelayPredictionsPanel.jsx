// AI Delay Prediction Engine panel — per-truck delay probability, predicted
// delay and dispatcher recommendation, reasoned by Gemini over live telemetry.
import { CircuitBoard, RefreshCw, TimerOff } from "lucide-react";

const RISK = {
  high: { pill: "bg-rose-500/15 text-rose-300 border-rose-500/30", bar: "bg-rose-500" },
  medium: { pill: "bg-amber-500/15 text-amber-300 border-amber-500/30", bar: "bg-amber-400" },
  low: { pill: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", bar: "bg-emerald-500" },
};

const timeAgo = (iso) => {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

export const DelayPredictionsPanel = ({ data, loading, onRefresh }) => {
  const items = data?.items || [];
  const counts = data?.counts || {};
  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden" data-testid="delay-predictions-panel">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <TimerOff className="h-4 w-4 text-violet-400" />
        <span className="text-sm font-semibold text-slate-100">Delay Prediction Engine</span>
        {data && (
          <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded border ${
            data.source === "vertex-ai"
              ? "bg-violet-500/10 border-violet-500/30 text-violet-300"
              : "bg-slate-800/60 border-slate-700 text-slate-400"}`} data-testid="predictions-source">
            {data.source === "vertex-ai" ? "Gemini reasoning" : "Heuristic"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <>
              <CountChip n={counts.high || 0} label="high" cls="text-rose-300" testId="pred-count-high" />
              <CountChip n={counts.medium || 0} label="med" cls="text-amber-300" testId="pred-count-medium" />
              <CountChip n={counts.low || 0} label="low" cls="text-emerald-300" testId="pred-count-low" />
              <span className="text-[10px] text-slate-600">{timeAgo(data.created_at)}</span>
            </>
          )}
          <button
            type="button" onClick={onRefresh} disabled={loading}
            className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
            data-testid="predictions-refresh-btn"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Re-score
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="h-40 grid place-items-center text-[12px] text-slate-500">
          <div className="flex items-center gap-2">
            <CircuitBoard className="h-4 w-4 animate-pulse text-violet-400" /> Scoring the fleet with Gemini…
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="h-32 grid place-items-center text-[12px] text-slate-500" data-testid="predictions-empty">
          No active trucks to score — the fleet is parked.
        </div>
      ) : (
        <div className="max-h-[380px] overflow-y-auto divide-y divide-slate-800/60">
          {items.map((it) => {
            const r = RISK[it.risk_level] || RISK.low;
            return (
              <div key={it.vehicle_id} className="px-3.5 py-2.5" data-testid="prediction-row">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono text-emerald-300">{it.vehicle_code}</span>
                  <span className="text-[10px] text-slate-500 uppercase">{(it.status || "").replace(/_/g, " ")}</span>
                  <span className="text-[11px] text-slate-300 truncate max-w-[220px]">→ {it.dest_name}</span>
                  {it.ref_code && <span className="text-[10px] font-mono text-slate-600">{it.ref_code}</span>}
                  <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${r.pill}`} data-testid="prediction-risk-badge">
                    {it.risk_level}
                  </span>
                </div>
                <div className="flex items-center gap-2.5 mt-1.5">
                  <div className="h-1.5 flex-1 max-w-[180px] rounded-full bg-slate-800">
                    <div className={`h-full rounded-full ${r.bar}`} style={{ width: `${Math.round(it.probability * 100)}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-white tabular-nums">{Math.round(it.probability * 100)}%</span>
                  <span className="text-[10px] text-slate-500">delay risk</span>
                  {it.predicted_delay_min > 0 && (
                    <span className="text-[10px] text-amber-300 tabular-nums">~{it.predicted_delay_min} min late</span>
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-1 leading-snug">{it.reason}</div>
                {it.recommendation && it.risk_level !== "low" && (
                  <div className="text-[10px] text-violet-300 mt-0.5">▸ {it.recommendation}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

function CountChip({ n, label, cls, testId }) {
  return (
    <span className={`text-[10px] tabular-nums ${n ? cls : "text-slate-600"}`} data-testid={testId}>
      <span className="font-bold">{n}</span> {label}
    </span>
  );
}
