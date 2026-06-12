// Demand ↔ Delivery correlation — region-level demand momentum vs delivery
// performance with AI-written insights.
import { ArrowDownRight, ArrowUpRight, GitCompareArrows, Lightbulb, RefreshCw } from "lucide-react";
import { unitsCompact } from "./ControlTowerPanels";

const PRESSURE = {
  at_risk: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  watch: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  healthy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};
const SEV_DOT = { high: "bg-rose-500", medium: "bg-amber-400", info: "bg-sky-500" };

export const DemandDeliveryPanel = ({ data, loading, onRefresh }) => {
  const regions = data?.regions || [];
  const insights = data?.insights || [];
  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden" data-testid="demand-delivery-panel">
      <div className="px-3.5 py-2.5 border-b border-slate-800 flex items-center gap-2">
        <GitCompareArrows className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-semibold text-slate-100">Demand ↔ Delivery Correlation</span>
        <span className="text-[10px] text-slate-500 hidden sm:inline">retail sell-through vs delivery performance, by region</span>
        <button
          type="button" onClick={onRefresh} disabled={loading}
          className="ml-auto text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors inline-flex items-center gap-1"
          data-testid="dd-refresh-btn"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {loading && !data ? (
        <div className="h-40 grid place-items-center text-[12px] text-slate-500">
          <div className="flex items-center gap-2"><RefreshCw className="h-4 w-4 animate-spin" /> Correlating demand & delivery…</div>
        </div>
      ) : (
        <>
          {insights.length > 0 && (
            <div className="px-3.5 py-2.5 border-b border-slate-800/70 space-y-1.5 bg-slate-900/40">
              {insights.map((ins, i) => (
                <div key={i} className="flex items-start gap-2" data-testid="dd-insight">
                  <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${SEV_DOT[ins.severity] || SEV_DOT.info}`} />
                  <div className="min-w-0">
                    <span className="text-[12px] font-semibold text-slate-100">{ins.headline}</span>
                    <span className="text-[11px] text-slate-400"> — {ins.detail}</span>
                  </div>
                </div>
              ))}
              <div className="flex items-center gap-1 text-[9px] text-slate-600 pt-0.5">
                <Lightbulb className="h-3 w-3" />
                {data?.source === "vertex-ai" ? "Insights by Gemini over live region data" : "Heuristic insights"}
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="px-3.5 py-2 font-semibold">Region</th>
                  <th className="px-2 py-2 font-semibold text-right">Demand 7d</th>
                  <th className="px-2 py-2 font-semibold text-right">WoW</th>
                  <th className="px-2 py-2 font-semibold text-right">Deliveries 30d</th>
                  <th className="px-2 py-2 font-semibold text-right">Avg lead</th>
                  <th className="px-2 py-2 font-semibold text-right">In transit</th>
                  <th className="px-2 py-2 font-semibold text-right">Delayed</th>
                  <th className="px-2 py-2 font-semibold text-right">Stock cover</th>
                  <th className="px-2 py-2 font-semibold text-right pr-3.5">Pressure</th>
                </tr>
              </thead>
              <tbody>
                {regions.length === 0 ? (
                  <tr><td colSpan={9} className="px-3.5 py-6 text-center text-[12px] text-slate-500">No region data yet.</td></tr>
                ) : regions.map((r) => (
                  <tr key={r.region} className="border-t border-slate-800/60 hover:bg-slate-800/30 transition-colors" data-testid="dd-region-row">
                    <td className="px-3.5 py-2 text-[12px] font-semibold text-slate-200">{r.region}</td>
                    <td className="px-2 py-2 text-[12px] text-slate-200 text-right tabular-nums">{unitsCompact(r.demand_units_7d)}</td>
                    <td className="px-2 py-2 text-right">
                      <span className={`inline-flex items-center gap-0.5 text-[11px] tabular-nums ${
                        r.demand_trend_pct > 0 ? "text-emerald-400" : r.demand_trend_pct < 0 ? "text-rose-400" : "text-slate-500"}`}>
                        {r.demand_trend_pct > 0 ? <ArrowUpRight className="h-3 w-3" /> : r.demand_trend_pct < 0 ? <ArrowDownRight className="h-3 w-3" /> : null}
                        {r.demand_trend_pct > 0 ? "+" : ""}{r.demand_trend_pct}%
                      </span>
                    </td>
                    <td className="px-2 py-2 text-[11px] text-slate-300 text-right tabular-nums">{r.deliveries_30d}</td>
                    <td className="px-2 py-2 text-[11px] text-slate-300 text-right tabular-nums">
                      {r.avg_lead_hours != null ? `${r.avg_lead_hours}h` : "—"}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-slate-300 text-right tabular-nums">{r.in_transit_now}</td>
                    <td className={`px-2 py-2 text-[11px] text-right tabular-nums ${r.delayed_now ? "text-rose-300 font-semibold" : "text-slate-500"}`}>
                      {r.delayed_now}
                    </td>
                    <td className="px-2 py-2 text-[11px] text-slate-300 text-right tabular-nums">
                      {r.stock_cover_days != null ? `${r.stock_cover_days}d` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right pr-3.5">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border whitespace-nowrap ${PRESSURE[r.pressure] || PRESSURE.healthy}`} data-testid="dd-pressure-badge">
                        {(r.pressure || "").replace(/_/g, " ")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
