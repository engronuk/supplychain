/**
 * Proactive Intelligence Center — command-center view for all roles.
 *
 * Dark hero with live executive brief, ecosystem feed, stockout forecasts,
 * recommendations, retailer health, logistics ETAs, weather/holiday signals,
 * and a unified Sabi copilot. Read-only recommendations (POC safety).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Sparkles, AlertOctagon, AlertTriangle, ShieldCheck, Info, Truck, CloudRain,
  TrendingUp, TrendingDown, RefreshCw, Trophy, Package, Store, Gauge, Clock,
  Activity, Brain, MessageCircle, Send, Loader2, CalendarDays, MapPin,
  ChevronRight, CircleDot, Radar, BellRing, Zap, Target, ListChecks, Check,
} from "lucide-react";

const ICON_MAP = {
  "trending-up": TrendingUp, "trending-down": TrendingDown,
  "sparkles": Sparkles, "alert-octagon": AlertOctagon, "alert-triangle": AlertTriangle,
  "shield-check": ShieldCheck, "info": Info, "truck": Truck, "cloud-rain": CloudRain,
  "trophy": Trophy, "package": Package, "store": Store, "gauge": Gauge, "clock": Clock,
};

const URGENCY_TONES = {
  critical: { dot: "bg-rose-500", text: "text-rose-200", chip: "bg-rose-500/20 text-rose-200 border-rose-500/30", glow: "shadow-rose-500/30" },
  high: { dot: "bg-amber-400", text: "text-amber-200", chip: "bg-amber-500/20 text-amber-200 border-amber-500/30", glow: "shadow-amber-500/30" },
  medium: { dot: "bg-yellow-400", text: "text-yellow-200", chip: "bg-yellow-500/20 text-yellow-100 border-yellow-500/30", glow: "" },
  low: { dot: "bg-emerald-400", text: "text-emerald-200", chip: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30", glow: "" },
};

const naira = (n) => "₦" + Math.round(Number(n || 0)).toLocaleString();

export default function IntelligenceCenter() {
  const { session } = useSession();
  const role = session?.role;
  const entityId = session?.entity?.id;
  const entityName = session?.entity?.name;

  return (
    <div className="bg-slate-950 min-h-screen -m-0">
      <div className="max-w-[1500px] mx-auto p-4 sm:p-6 lg:p-8 pb-32" data-testid="intel-center">
        <Header role={role} entityName={entityName} entityId={entityId} />
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-5">
          <div className="xl:col-span-2 space-y-4">
            <ExecutiveBrief role={role} entityId={entityId} />
            <LiveFeedCard role={role} entityId={entityId} />
            <ForecastsCard role={role} entityId={entityId} />
            <RecommendationsCard role={role} entityId={entityId} />
          </div>
          <div className="space-y-4">
            <ExternalSignalsCard role={role} entityId={entityId} />
            <RetailerHealthCard role={role} entityId={entityId} />
            <LogisticsCard role={role} entityId={entityId} />
          </div>
        </div>
      </div>

      <SabiCopilotPanel role={role} entityId={entityId} entityName={entityName} />
    </div>
  );
}

function Header({ role, entityName, entityId }) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/intel/recompute?role=${role}&entity_id=${entityId}`, { method: "POST" });
      toast.success("Intelligence layer recomputing — refresh in a few seconds.");
    } catch {
      toast.error("Recompute failed.");
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-indigo-600 via-violet-700 to-fuchsia-800 p-5 sm:p-6 text-white shadow-2xl shadow-indigo-950/30 relative overflow-hidden">
      <div className="absolute inset-0 opacity-30 mix-blend-overlay pointer-events-none">
        <div className="absolute top-0 right-0 w-72 h-72 rounded-full bg-fuchsia-400 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 rounded-full bg-indigo-400 blur-3xl" />
      </div>
      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 mb-2">
            <div className="h-9 w-9 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center">
              <Brain className="h-5 w-5" />
            </div>
            <Badge className="bg-white/15 text-white border-white/20 backdrop-blur">PROACTIVE INTELLIGENCE LAYER</Badge>
            <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-emerald-300">
              <CircleDot className="h-2.5 w-2.5 animate-pulse" /> Live
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold leading-tight">Operational Intelligence · {entityName}</h1>
          <p className="text-sm text-indigo-100 mt-1 opacity-90">
            Continuously analyzing inventory, retailer behaviour, logistics, and external conditions.
            Updates every {role === "manufacturer" ? "5 minutes" : "5–15 minutes"}.
          </p>
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 transition text-sm font-semibold backdrop-blur disabled:opacity-50"
          data-testid="intel-header-refresh"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          Recompute
        </button>
      </div>
    </div>
  );
}

function ExecutiveBrief({ role, entityId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    Api.intelExecSummary(role, entityId).then(setData).catch(() => setData(null));
  }, [role, entityId]);

  return (
    <Card className="bg-gradient-to-br from-slate-900 to-slate-950 border-white/10 text-white">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-indigo-300" />
          <div className="text-[11px] uppercase tracking-widest text-indigo-300 font-semibold">Executive Brief</div>
          {data?.model && <Badge className="bg-indigo-500/20 text-indigo-200 border-indigo-500/30 text-[10px]">
            {data.model.replace(/-\d{8}$/, "")}
          </Badge>}
        </div>
        {!data ? (
          <div className="text-sm text-slate-400">Generating…</div>
        ) : (
          <>
            <div className="text-lg sm:text-xl font-semibold text-white leading-snug" data-testid="intel-exec-headline">{data.headline}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-4">
              {(data.bullets || []).map((b, i) => {
                const Icon = ICON_MAP[b.icon] || Info;
                const tone = b.tone || "info";
                const ring = tone === "critical" ? "border-rose-500/30 bg-rose-500/10"
                  : tone === "warning" ? "border-amber-500/30 bg-amber-500/10"
                  : tone === "positive" ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-white/10 bg-white/5";
                return (
                  <div key={i} className={`rounded-xl border ${ring} p-3`}>
                    <div className="flex items-start gap-2">
                      <Icon className="h-4 w-4 mt-0.5 flex-shrink-0 text-slate-200" />
                      <div className="text-[13px] text-slate-100 leading-snug">{b.text}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {data.recommendation && (
              <div className="mt-4 rounded-xl bg-gradient-to-r from-indigo-500/20 to-fuchsia-500/20 border border-indigo-400/30 p-4">
                <div className="text-[10px] uppercase tracking-widest text-indigo-200 font-semibold mb-1 inline-flex items-center gap-1">
                  <Target className="h-3 w-3" /> Recommended action
                </div>
                <div className="text-sm text-white">{data.recommendation}</div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LiveFeedCard({ role, entityId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => Api.intelFeed(role, entityId, 20)
      .then((d) => { if (!cancelled) setItems(d.items || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    load();
    const t = setInterval(load, 30000); // poll every 30s
    return () => { cancelled = true; clearInterval(t); };
  }, [role, entityId]);

  return (
    <Card className="bg-slate-900/80 border-white/10 text-white">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="inline-flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-400" />
            <div className="text-[11px] uppercase tracking-widest text-emerald-300 font-semibold">Ecosystem Feed</div>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
              <CircleDot className="h-2 w-2 animate-pulse" /> Live · 30s refresh
            </span>
          </div>
          <span className="text-[10px] text-slate-400">{items.length} items</span>
        </div>
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {loading && <div className="text-sm text-slate-400">Loading…</div>}
          {!loading && items.length === 0 && (
            <div className="text-sm text-slate-400">No insights yet — check back in a minute.</div>
          )}
          {items.map((it) => {
            const Icon = ICON_MAP[it.icon] || Info;
            const tone = it.tone || "info";
            const ring = tone === "critical" ? "border-rose-500/30 bg-rose-500/10"
              : tone === "warning" ? "border-amber-500/30 bg-amber-500/10"
              : tone === "positive" ? "border-emerald-500/30 bg-emerald-500/10"
              : "border-white/10 bg-white/5";
            return (
              <div key={it.id} className={`rounded-xl border ${ring} p-3`} data-testid="feed-item">
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-3.5 w-3.5 text-slate-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white leading-snug">{it.title}</div>
                    {it.detail && <div className="text-[12px] text-slate-300 mt-0.5 leading-relaxed">{it.detail}</div>}
                    <div className="flex items-center gap-2 mt-1.5">
                      <Badge className="text-[9px] bg-white/5 text-slate-300 border-white/10 uppercase">{it.category}</Badge>
                      {it.region && <Badge className="text-[9px] bg-indigo-500/15 text-indigo-200 border-indigo-500/20"><MapPin className="h-2.5 w-2.5 mr-0.5 inline" />{it.region}</Badge>}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ForecastsCard({ role, entityId }) {
  const [data, setData] = useState({ rows: [], region_rollup: [] });
  const [filter, setFilter] = useState("critical");
  useEffect(() => {
    Api.intelForecasts(role, entityId, { urgency: filter, limit: 30 }).then(setData).catch(() => {});
  }, [role, entityId, filter]);

  return (
    <Card className="bg-slate-900/80 border-white/10 text-white">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <div className="inline-flex items-center gap-2">
            <Radar className="h-4 w-4 text-rose-400" />
            <div className="text-[11px] uppercase tracking-widest text-rose-300 font-semibold">Stock Exhaustion Forecasts</div>
          </div>
          <div className="inline-flex bg-white/5 rounded-lg p-0.5 border border-white/10">
            {["critical", "high", "medium"].map((u) => (
              <button
                key={u}
                onClick={() => setFilter(u)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition ${
                  filter === u ? "bg-white/10 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
                data-testid={`forecast-filter-${u}`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        {data.region_rollup?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {data.region_rollup.slice(0, 6).map((r) => (
              <Badge key={r.region} className="bg-rose-500/10 text-rose-200 border-rose-500/20 text-[10px]">
                <MapPin className="h-2.5 w-2.5 mr-0.5 inline" />{r.region} · {r.at_risk_shops}
              </Badge>
            ))}
          </div>
        )}
        <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
          {data.rows.length === 0 && <div className="text-sm text-slate-400">No {filter} stockouts predicted — good.</div>}
          {data.rows.map((r) => {
            const t = URGENCY_TONES[r.urgency] || URGENCY_TONES.medium;
            return (
              <div key={r.id} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/5" data-testid="forecast-row">
                <div className={`h-2 w-2 rounded-full ${t.dot} flex-shrink-0`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-white font-medium truncate">{r.product_name}</div>
                  <div className="text-[11px] text-slate-400 truncate">{r.retailer_name} · {r.city}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-white tabular-nums">{r.days_remaining}d</div>
                  <div className="text-[10px] text-slate-400">{Math.round(r.confidence * 100)}% conf</div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RecommendationsCard({ role, entityId }) {
  const [rows, setRows] = useState([]);
  const [acked, setAcked] = useState({});

  const load = () => Api.intelRecommendations(role, entityId, { limit: 30 })
    .then((d) => setRows(d.rows || []))
    .catch(() => {});

  useEffect(() => { load(); }, [role, entityId]);

  const ack = async (rec_id) => {
    setAcked((a) => ({ ...a, [rec_id]: true }));
    try {
      await Api.intelAckRecommendation(rec_id, role, entityId);
      toast.success("Recommendation acknowledged");
    } catch {
      toast.error("Couldn't acknowledge");
      setAcked((a) => { const c = { ...a }; delete c[rec_id]; return c; });
    }
  };

  const visible = rows.filter((r) => !acked[r.id] && r.status !== "acknowledged");

  return (
    <Card className="bg-slate-900/80 border-white/10 text-white">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="inline-flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-indigo-300" />
            <div className="text-[11px] uppercase tracking-widest text-indigo-300 font-semibold">AI Recommendations</div>
            <Badge className="bg-indigo-500/15 text-indigo-200 border-indigo-500/20 text-[10px]">read-only</Badge>
          </div>
          <span className="text-[10px] text-slate-400">{visible.length} open</span>
        </div>
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {visible.length === 0 && <div className="text-sm text-slate-400">All clear. No new recommendations.</div>}
          {visible.slice(0, 12).map((r) => {
            const t = URGENCY_TONES[r.urgency] || URGENCY_TONES.medium;
            return (
              <div key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3" data-testid="rec-row">
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="inline-flex items-center gap-2 flex-wrap">
                    <Badge className={`text-[10px] uppercase border ${t.chip}`}>{r.urgency}</Badge>
                    <Badge className="bg-white/5 text-slate-300 border-white/10 text-[10px] capitalize">{r.category}</Badge>
                    <span className="text-[10px] text-slate-400">{Math.round((r.confidence || 0) * 100)}% conf</span>
                  </div>
                  <button
                    onClick={() => ack(r.id)}
                    className="text-[11px] inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/5 text-slate-200 hover:bg-white/10 transition"
                    data-testid={`rec-ack-${r.id}`}
                  >
                    <Check className="h-3 w-3" /> Mark done
                  </button>
                </div>
                <div className="text-sm font-semibold text-white">{r.title}</div>
                <div className="text-[12px] text-slate-300 mt-1 leading-relaxed">{r.detail}</div>
                {r.impact?.naira > 0 && (
                  <div className="text-[11px] text-emerald-300 mt-1.5 inline-flex items-center gap-1">
                    <Zap className="h-3 w-3" /> Impact ~{naira(r.impact.naira)} at risk
                  </div>
                )}
                {Array.isArray(r.actions) && r.actions.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {r.actions.map((a, i) => (
                      <li key={i} className="text-[11.5px] text-slate-300 inline-flex items-start gap-1.5">
                        <ChevronRight className="h-3 w-3 mt-0.5 text-slate-500 flex-shrink-0" /> {a}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function ExternalSignalsCard({ role, entityId }) {
  const [signals, setSignals] = useState(null);
  useEffect(() => {
    Api.intelExternal(role, entityId).then(setSignals).catch(() => setSignals(null));
  }, [role, entityId]);
  const p = signals?.payload;

  return (
    <Card className="bg-slate-900/80 border-white/10 text-white">
      <CardContent className="p-5">
        <div className="inline-flex items-center gap-2 mb-3">
          <CloudRain className="h-4 w-4 text-sky-400" />
          <div className="text-[11px] uppercase tracking-widest text-sky-300 font-semibold">External Signals</div>
        </div>
        {!p ? (
          <div className="text-sm text-slate-400">Loading weather…</div>
        ) : (
          <>
            <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 mb-3">
              <div className="flex items-baseline justify-between">
                <div className="text-[11px] uppercase tracking-widest text-sky-300 font-semibold">Rainfall · 7-day</div>
                <div className="text-2xl font-bold text-white tabular-nums">{p.weather?.national?.rainfall_mm_7d ?? "—"}<span className="text-sm text-slate-400 ml-1">mm</span></div>
              </div>
              <div className="text-[11px] text-slate-300 mt-1">Heaviest in <strong className="text-white">{p.weather?.national?.max_rainfall_region}</strong> · max temp {p.weather?.national?.temp_max_c}°C</div>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {Object.entries(p.weather?.by_region || {}).slice(0, 6).map(([name, w]) => (
                <div key={name} className="rounded-lg bg-white/5 border border-white/10 p-2.5">
                  <div className="text-[10px] text-slate-400">{name}</div>
                  <div className="text-sm font-semibold text-white">{w.rainfall_mm_7d}mm</div>
                  <div className="text-[10px] text-slate-400">{w.temp_min_c}–{w.temp_max_c}°C</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-violet-300 font-semibold mb-1.5">
                <CalendarDays className="h-3 w-3" /> Calendar signals
              </div>
              <div className="text-[12px] text-slate-200">
                {p.salary_window && <div className="inline-flex items-center gap-1.5 mb-1"><CircleDot className="h-2.5 w-2.5 text-amber-400" />Salary window active (end of month)</div>}
                {p.holiday_within_7d && <div className="inline-flex items-center gap-1.5 mb-1"><CircleDot className="h-2.5 w-2.5 text-rose-400" />Holiday within 7 days</div>}
                {!p.salary_window && !p.holiday_within_7d && <div className="text-slate-400">No special calendar drivers this week.</div>}
              </div>
              {p.upcoming?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {p.upcoming.slice(0, 3).map((h) => (
                    <div key={h.date} className="text-[11px] text-slate-300">
                      <strong className="text-white">{h.name}</strong> · in {h.days_away} days
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RetailerHealthCard({ role, entityId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    Api.intelRetailerHealth(role, entityId, { churn_risk: "high", limit: 10 }).then((d) => setRows(d.rows || [])).catch(() => {});
  }, [role, entityId]);

  return (
    <Card className="bg-slate-900/80 border-white/10 text-white">
      <CardContent className="p-5">
        <div className="inline-flex items-center gap-2 mb-3">
          <BellRing className="h-4 w-4 text-amber-400" />
          <div className="text-[11px] uppercase tracking-widest text-amber-300 font-semibold">Retailer Churn Risk</div>
        </div>
        {rows.length === 0 ? (
          <div className="text-sm text-slate-400">All retailers active recently.</div>
        ) : (
          <div className="space-y-1.5 max-h-[280px] overflow-y-auto">
            {rows.map((h) => (
              <div key={h.id} className="flex items-center gap-3 py-1.5" data-testid="health-row">
                <div className="h-2 w-2 rounded-full bg-rose-500 flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-white font-medium truncate">{h.retailer_name}</div>
                  <div className="text-[10.5px] text-slate-400 truncate">{h.city} · {h.region}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[13px] font-bold text-rose-300 tabular-nums">{h.days_inactive}d</div>
                  <div className="text-[10px] text-slate-400">score {h.health_score}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LogisticsCard({ role, entityId }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    Api.intelDeliveryEta(role, entityId, { risk: "high" }).then((d) => setRows((d.rows || []).slice(0, 8))).catch(() => {});
  }, [role, entityId]);

  return (
    <Card className="bg-slate-900/80 border-white/10 text-white">
      <CardContent className="p-5">
        <div className="inline-flex items-center gap-2 mb-3">
          <Truck className="h-4 w-4 text-orange-400" />
          <div className="text-[11px] uppercase tracking-widest text-orange-300 font-semibold">Logistics Risk</div>
        </div>
        {rows.length === 0 ? (
          <div className="text-sm text-slate-400">No high-risk shipments.</div>
        ) : (
          <div className="space-y-1.5">
            {rows.map((e) => (
              <div key={e.id} className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[11px] text-orange-200">{e.tracking_code}</div>
                    <div className="text-[11px] text-slate-300 mt-0.5">{e.from_region} → {e.to_region}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[12px] font-bold text-white tabular-nums">{e.elapsed_days}d <span className="text-slate-400 font-normal">/ {e.expected_days}d</span></div>
                    {e.external_multiplier > 1.1 && (
                      <div className="text-[10px] text-sky-300 inline-flex items-center gap-1"><CloudRain className="h-2.5 w-2.5" /> +{Math.round((e.external_multiplier-1)*100)}% weather</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Sabi Copilot — role-aware floating panel
// ============================================================================
function SabiCopilotPanel({ role, entityId, entityName }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState([]);
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef(null);
  const sessionKey = `intel:copilot:${role}:${entityId}`;

  useEffect(() => {
    try {
      const raw = localStorage.getItem(sessionKey);
      if (raw) setTurns(JSON.parse(raw));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  useEffect(() => {
    try { localStorage.setItem(sessionKey, JSON.stringify(turns.slice(-30))); } catch {}
  }, [turns, sessionKey]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, thinking]);

  const send = async (text) => {
    const t = (text || "").trim();
    if (!t || thinking) return;
    setTurns((a) => [...a, { role: "user", content: t }]);
    setInput("");
    setThinking(true);
    try {
      const history = turns.slice(-6);
      const data = await Api.intelCopilot(role, entityId, t, history);
      setTurns((a) => [...a, { role: "assistant", content: data.reply || "(no response)", model: data.model }]);
    } catch (e) {
      const msg = e?.response?.data?.detail || "Copilot unavailable.";
      setTurns((a) => [...a, { role: "assistant", content: msg }]);
    } finally {
      setThinking(false);
    }
  };

  const suggestions = useMemo(() => {
    if (role === "manufacturer") {
      return [
        "What products are likely to stock out this week?",
        "Which regions are showing unusual demand?",
        "Draft a 30-day procurement plan",
        "Why are sales dropping in any region?",
      ];
    }
    if (role === "distributor") {
      return [
        "Which retailers are at churn risk?",
        "Which products need urgent replenishment?",
        "How will weather affect my deliveries this week?",
        "Draft a recovery plan for inactive retailers",
      ];
    }
    return [
      "What is running out soon?",
      "How are sales this week?",
      "Restock my best sellers",
      "Any logistics issues to know about?",
    ];
  }, [role]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[60] inline-flex items-center gap-2 px-4 py-3 rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-600 to-fuchsia-600 text-white shadow-2xl shadow-indigo-500/30 hover:scale-105 transition-transform group"
        data-testid="intel-copilot-bubble"
      >
        <div className="h-7 w-7 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="text-left">
          <div className="text-[11px] uppercase tracking-widest text-indigo-100 font-semibold">Ask Sabi</div>
          <div className="text-[12px] text-white font-medium">Your AI copilot</div>
        </div>
        <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-400 border-2 border-slate-900 animate-pulse" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-[60] w-[min(420px,calc(100vw-24px))] h-[min(620px,calc(100vh-40px))] rounded-2xl bg-slate-900 border border-white/10 shadow-2xl shadow-indigo-950/50 flex flex-col overflow-hidden" data-testid="intel-copilot-panel">
      <div className="px-4 py-3 bg-gradient-to-br from-indigo-500 via-violet-600 to-fuchsia-600 text-white flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-semibold leading-tight">Sabi</div>
          <div className="text-[10.5px] opacity-90 truncate capitalize">{role} copilot · {entityName}</div>
        </div>
        <button
          onClick={() => setTurns([])}
          className="h-8 w-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center"
          title="Clear conversation"
          data-testid="intel-copilot-clear"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setOpen(false)}
          className="h-8 w-8 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center"
          data-testid="intel-copilot-close"
        >
          ×
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 bg-slate-950 text-white">
        {turns.length === 0 && (
          <div className="text-center text-slate-400 text-sm py-6">
            <div className="mx-auto mb-3 h-12 w-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Brain className="h-5 w-5 text-indigo-300" />
            </div>
            <div className="font-medium text-slate-200">Ask anything about your ecosystem.</div>
            <div className="mt-1 text-[12px]">Forecasts, anomalies, recommendations — Sabi sees only your tenant's data.</div>
            <div className="mt-4 grid grid-cols-1 gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left text-[12.5px] text-slate-200 bg-white/5 border border-white/10 rounded-xl px-3 py-2 hover:bg-white/10 transition"
                  data-testid={`copilot-suggest-${s.split(" ")[0].toLowerCase()}`}
                >
                  <MessageCircle className="inline h-3 w-3 text-slate-500 mr-1.5" />{s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2.5">
          {turns.map((t, i) => (
            <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                t.role === "user"
                  ? "bg-gradient-to-r from-indigo-500 to-violet-600 text-white"
                  : "bg-white/5 text-slate-100 border border-white/10"
              }`}>
                <div className="whitespace-pre-wrap">{t.content}</div>
                {t.model && <div className="text-[9px] text-slate-400 mt-1 uppercase tracking-wider">{t.model.replace(/-\d{8}$/, "")}</div>}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex items-center gap-2 text-slate-400 text-[12px] pl-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sabi is thinking…
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-white/10 bg-slate-900 p-2.5">
        <div className="flex items-end gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask Sabi about forecasts, churn, deliveries…"
            className="flex-1 h-10 bg-slate-800 border-white/10 text-white placeholder:text-slate-500"
            data-testid="intel-copilot-input"
          />
          <Button
            onClick={() => send(input)}
            disabled={!input.trim() || thinking}
            className="h-10 px-3 bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-400 hover:to-violet-500 text-white"
            data-testid="intel-copilot-send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-1.5 text-[10px] text-slate-500 text-center">
          Sabi sees only {entityName}'s data. Recommendations are advisory.
        </div>
      </div>
    </div>
  );
}
