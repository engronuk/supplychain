// Manufacturer Command Center — Real-Time Pulse
// ---------------------------------------------------------------------------
// • Google Maps embed with one bubble per region, sized by 24h sales value
// • Live KPI strip from BigQuery `/api/pulse/by-region`
// • Vertex AI Proactive Intelligence Center: rich per-signal briefings
//   (severity, narrative, ranked hypotheses with confidence + evidence,
//    24h trajectory forecast, owner-assigned recommended actions, risk
//    flags) + a network-level executive summary, all from
//    `/api/pulse/intelligence`
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles, MapPin, TrendingUp, AlertTriangle, RefreshCw, Cloud,
  Brain, Flame, Activity, ChevronDown, ChevronUp, Target, ShieldAlert,
  Users, Globe2, Gauge, Workflow, Zap,
} from "lucide-react";
import { Api } from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";

const naira = (n) => `₦${(Number(n) || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const num   = (n) => (Number(n) || 0).toLocaleString();
const pct   = (n) => `${((Number(n) || 0) * 100).toFixed(0)}%`;

// Friendly "x minutes ago" relative-time. Returns null if no input.
function relativeFrom(iso) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return null;
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m === 1) return "1 minute ago";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.floor(m / 60);
  if (h === 1) return "1 hour ago";
  if (h < 24) return `${h} hours ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

// Load the Google Maps JS API once (idempotent across remounts).
function useGoogleMaps(apiKey) {
  const [ready, setReady] = useState(!!window.google?.maps);
  useEffect(() => {
    if (window.google?.maps) { setTimeout(() => setReady(true), 0); return; }
    if (!apiKey) return;
    const id = "tk-maps-script";
    window.__tkMapsInit = window.__tkMapsInit || (() => {
      window.__tkMapsReady = true;
      window.dispatchEvent(new Event("tk:maps-ready"));
    });
    const onReady = () => setTimeout(() => setReady(true), 0);
    if (window.__tkMapsReady) { onReady(); return; }
    window.addEventListener("tk:maps-ready", onReady, { once: true });
    if (document.getElementById(id)) return () => window.removeEventListener("tk:maps-ready", onReady);
    const s = document.createElement("script");
    s.id = id; s.async = true; s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly&loading=async&callback=__tkMapsInit`;
    document.head.appendChild(s);
    return () => window.removeEventListener("tk:maps-ready", onReady);
  }, [apiKey]);
  return ready;
}

export default function CommandCenter() {
  const apiKey = process.env.REACT_APP_MAPS_API_KEY;
  const mapsReady = useGoogleMaps(apiKey);
  const [regions, setRegions] = useState([]);
  const [intel,   setIntel]   = useState({ briefings: [], executive_summary: null, ai_status: "", generated_at: null, next_compute_at: null });
  const [health,  setHealth]  = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);

  const reload = () => {
    setRefreshing(true);
    Promise.all([
      Api.pulseByRegion(24).then((r) => setRegions(r.rows || [])).catch(() => setRegions([])),
      Api.pulseIntelligence().then((r) => setIntel(r || { briefings: [] })).catch(() => setIntel({ briefings: [] })),
      Api.pulseHealth().then(setHealth).catch(() => setHealth(null)),
    ]).finally(() => setRefreshing(false));
  };
  const recompute = async () => {
    if (recomputing) return;
    setRecomputing(true);
    const toastId = toast.loading("Recomputing intelligence with the latest platform data…");
    try {
      const fresh = await Api.pulseIntelligenceRecompute();
      setIntel(fresh);
      toast.success("Intelligence recomputed", {
        id: toastId,
        description: `${fresh.briefings?.length || 0} briefing${fresh.briefings?.length === 1 ? "" : "s"} generated.`,
      });
    } catch (e) {
      toast.error("Recompute failed", {
        id: toastId,
        description: e?.response?.data?.detail || e?.message || "Please try again in a minute.",
      });
    } finally {
      setRecomputing(false);
    }
  };
  useEffect(() => { setTimeout(() => reload(), 0); }, []);

  // Build / refresh map markers
  useEffect(() => {
    if (!mapsReady || !mapRef.current) return;
    if (!mapObj.current) {
      mapObj.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: 9.082, lng: 8.6753 },
        zoom: 6,
        styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        disableDefaultUI: true,
        zoomControl: true,
      });
    }
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    const maxRev = Math.max(1, ...regions.map((r) => r.revenue || 0));
    regions.forEach((r) => {
      if (r.latitude == null || r.longitude == null) return;
      const scale = Math.max(0.18, (r.revenue || 0) / maxRev);
      const marker = new window.google.maps.Marker({
        position: { lat: r.latitude, lng: r.longitude },
        map: mapObj.current,
        title: `${r.region} — ${naira(r.revenue)}`,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          fillColor: "#2563EB",
          fillOpacity: 0.55,
          strokeColor: "#1E40AF",
          strokeWeight: 2,
          scale: 18 + scale * 32,
        },
      });
      const info = new window.google.maps.InfoWindow({
        content: `<div style="font-family:Inter,sans-serif;min-width:160px">
          <div style="font-weight:700;font-size:13px">${r.region}</div>
          <div style="color:#64748b;font-size:11px;margin-top:2px">Last 24h</div>
          <div style="font-weight:600;margin-top:4px">${naira(r.revenue)}</div>
          <div style="color:#475569;font-size:12px">${num(r.units)} units · ${r.events} events</div>
        </div>`,
      });
      marker.addListener("click", () => info.open(mapObj.current, marker));
      markers.current.push(marker);
    });
  }, [mapsReady, regions]);

  const totals = regions.reduce((s, r) => ({
    units: s.units + (r.units || 0),
    revenue: s.revenue + (r.revenue || 0),
    events: s.events + (r.events || 0),
  }), { units: 0, revenue: 0, events: 0 });

  const briefings = intel.briefings || [];
  const exec = intel.executive_summary;
  const aiLabel = useMemo(() => {
    const s = intel.ai_status || "";
    if (s === "vertex_ai") return { tag: "VERTEX AI", color: "bg-violet-100 text-violet-700", live: true };
    if (s.startsWith("fallback")) return { tag: "EVIDENCE MODE", color: "bg-amber-100 text-amber-800", live: false };
    return { tag: "VERTEX AI", color: "bg-violet-100 text-violet-700", live: true };
  }, [intel.ai_status]);

  const sevCounts = briefings.reduce((a, b) => {
    a[b.severity] = (a[b.severity] || 0) + 1;
    return a;
  }, {});

  // Next-compute relative time — re-evaluated every 30s via a state tick so
  // the compiler's purity rule stays satisfied (Date.now() is impure).
  const [nextComputeLabel, setNextComputeLabel] = useState(null);
  useEffect(() => {
    function tick() {
      if (!intel.next_compute_at) { setNextComputeLabel(null); return; }
      const next = new Date(intel.next_compute_at).getTime();
      if (!next) { setNextComputeLabel(null); return; }
      const diff = next - Date.now();
      if (diff <= 0) { setNextComputeLabel("any moment"); return; }
      const m = Math.round(diff / 60000);
      if (m < 1) setNextComputeLabel("under a minute");
      else if (m === 1) setNextComputeLabel("1 minute");
      else if (m < 60) setNextComputeLabel(`${m} minutes`);
      else setNextComputeLabel(`${Math.round(m / 60)}h`);
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [intel.next_compute_at]);

  return (
    <div className="space-y-6" data-testid="command-center">
      {/* Heading */}
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-blue-700 font-semibold mb-1">
            <Cloud className="h-3 w-3" /> Real-Time Pulse · powered by GCP
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Manufacturer Command Center</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Hourly intelligence snapshot grounded in your live platform data — distributor orders, retailer stockout risk, allocation & fulfillment activity — synthesised by Vertex AI.
          </p>
          {intel.generated_at && (
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-3">
              <span>Last computed <span className="font-medium text-slate-700">{relativeFrom(intel.generated_at)}</span></span>
              {nextComputeLabel && (
                <span className="text-slate-400">· next auto-refresh in {nextComputeLabel}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="border-slate-200" onClick={reload} disabled={refreshing} data-testid="cc-refresh">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={recompute}
            disabled={recomputing}
            data-testid="cc-recompute"
          >
            <Zap className={`h-4 w-4 mr-1.5 ${recomputing ? "animate-pulse" : ""}`} />
            {recomputing ? "Recomputing…" : "Recompute intelligence"}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi label="24h Revenue"     value={naira(totals.revenue)}              Icon={TrendingUp}    tint="emerald" />
        <Kpi label="24h Units"       value={num(totals.units)}                  Icon={Sparkles}      tint="blue" />
        <Kpi label="24h Events"      value={num(totals.events)}                 Icon={MapPin}        tint="indigo" />
        <Kpi label="Active Signals"  value={`${briefings.length}`}              Icon={AlertTriangle} tint={briefings.length ? "rose" : "slate"}
             sub={briefings.length ? `${sevCounts.CRITICAL || 0} critical · ${sevCounts.HIGH || 0} high` : "All clear"} />
      </div>

      {/* Executive Briefing — Vertex AI synthesis */}
      {exec && (
        <ExecutiveBriefing exec={exec} aiLabel={aiLabel} signalCount={intel.signal_count || briefings.length} />
      )}

      {/* Map + Intelligence Center */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-5">
        <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-semibold text-slate-900 text-sm">Sales Heatmap · Last 24h</div>
            <div className="text-xs text-slate-500">{regions.length} regions</div>
          </div>
          {!apiKey ? (
            <div className="h-[680px] grid place-items-center text-sm text-slate-400 p-6 text-center">
              <span>Google Maps API key not configured. Set <code>REACT_APP_MAPS_API_KEY</code> in frontend/.env.</span>
            </div>
          ) : !mapsReady ? (
            <div className="h-[680px] grid place-items-center text-sm text-slate-400">Loading map…</div>
          ) : (
            <div ref={mapRef} className="h-[680px] w-full" data-testid="pulse-map" />
          )}
          <div className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-500">
            BigQuery · {health?.dataset || "pulse"}.sales_events · {health?.location || "europe-west2"}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-semibold text-slate-900 text-sm inline-flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-violet-600" /> Proactive Intelligence Center
            </div>
            <span className={`text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded ${aiLabel.color}`}>
              {aiLabel.tag}
            </span>
          </div>
          <div className="flex-1 max-h-[680px] overflow-y-auto" data-testid="intelligence-list">
            {briefings.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-16 px-6">
                {refreshing ? "Synthesising intelligence…" : "No actionable signals detected. The network is operating within the 14-day envelope."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {briefings.map((b, i) => <BriefingCard key={i} b={b} />)}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Executive Briefing — high-level COO synthesis from Vertex AI
// ============================================================================
function ExecutiveBriefing({ exec, aiLabel, signalCount }) {
  return (
    <div
      className="relative rounded-2xl border border-violet-200/60 bg-gradient-to-br from-violet-50 via-white to-indigo-50 shadow-sm overflow-hidden"
      data-testid="executive-briefing"
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-violet-500 to-indigo-500" />
      <div className="p-6 pl-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em] text-violet-700 font-bold mb-1">
              <Brain className="h-3 w-3" /> Network Executive Briefing · {signalCount} signals analysed
            </div>
            <h2 className="text-xl font-bold text-slate-900 leading-snug max-w-3xl">{exec.headline}</h2>
          </div>
          <span className={`text-[10px] uppercase font-bold tracking-wider px-2 py-1 rounded ${aiLabel.color}`}>
            {aiLabel.tag}
          </span>
        </div>
        <p className="text-sm text-slate-700 leading-relaxed mt-3 max-w-4xl">{exec.narrative}</p>
        {Array.isArray(exec.themes) && exec.themes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {exec.themes.map((t, i) => (
              <span key={i} className="text-[11px] font-medium px-2 py-1 rounded-md bg-white border border-violet-200 text-violet-700">
                {t}
              </span>
            ))}
          </div>
        )}
        {exec.top_action && (
          <div className="mt-4 rounded-xl bg-white border border-violet-200/70 px-4 py-3 flex items-start gap-3">
            <div className="h-8 w-8 rounded-lg bg-violet-100 grid place-items-center text-violet-700 shrink-0">
              <Target className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700">Top Priority Action</div>
              <div className="text-sm text-slate-900 font-medium mt-0.5">{exec.top_action}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// BriefingCard — per-(region,product) Vertex AI intelligence card
// ============================================================================
const SEV_STYLES = {
  CRITICAL: { pill: "bg-rose-100 text-rose-700 border-rose-200",      bar: "bg-rose-500",    Icon: Flame },
  HIGH:     { pill: "bg-amber-100 text-amber-800 border-amber-200",   bar: "bg-amber-500",   Icon: ShieldAlert },
  MEDIUM:   { pill: "bg-sky-100 text-sky-700 border-sky-200",         bar: "bg-sky-500",     Icon: Activity },
  INFO:     { pill: "bg-slate-100 text-slate-700 border-slate-200",   bar: "bg-slate-400",   Icon: Activity },
};

function BriefingCard({ b }) {
  const [open, setOpen] = useState(false);
  const sev = SEV_STYLES[b.severity] || SEV_STYLES.MEDIUM;
  const SevIcon = sev.Icon;
  const trajectory = b.trajectory_24h || {};
  // Backward compat: BQ briefings used product_id/region; new platform
  // briefings use scope/scope_label.
  const scopeLabel = b.scope_label || b.product_name || b.product_id || b.region || "—";
  const scopeKind = b.scope || (b.product_name ? "PRODUCT" : b.region ? "REGION" : "NETWORK");
  const testKey = (b.scope_label || b.product_id || b.region || "briefing").toString().replace(/\s+/g, "-").toLowerCase();
  const hasTrajectory = Number(trajectory.expected_units || 0) > 0 || Number(trajectory.expected_revenue_naira || 0) > 0;

  return (
    <li className="px-5 py-4" data-testid={`briefing-${testKey}`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded border ${sev.pill}`}>
              <SevIcon className="h-3 w-3" /> {b.severity}
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-500">
              {(b.signal_type || "").replace(/_/g, " ")}
            </span>
            <span className="text-[10px] uppercase font-medium tracking-wider text-slate-400">
              {scopeKind}
            </span>
          </div>
          <div className="font-semibold text-slate-900 text-sm mt-1.5">{scopeLabel}</div>
        </div>
      </div>

      {/* Headline + narrative */}
      <div className="mt-2.5 text-[13px] font-medium text-slate-900 leading-snug">{b.headline}</div>
      {b.narrative && (
        <p className="text-[12px] text-slate-600 leading-relaxed mt-1.5">{b.narrative}</p>
      )}

      {/* Risk chips */}
      {Array.isArray(b.risk_flags) && b.risk_flags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-3">
          {b.risk_flags.map((f, i) => (
            <span key={i} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100">
              {f.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      {/* Expandable details */}
      <button
        type="button"
        className="mt-3 inline-flex items-center gap-1 text-[11px] uppercase tracking-wider font-bold text-violet-700 hover:text-violet-900"
        onClick={() => setOpen((o) => !o)}
        data-testid="briefing-toggle"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? "Hide AI analysis" : "Show AI analysis"}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {/* Hypotheses */}
          {Array.isArray(b.hypotheses) && b.hypotheses.length > 0 && (
            <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700 mb-2 inline-flex items-center gap-1.5">
                <Workflow className="h-3 w-3" /> Root-cause hypotheses (ranked)
              </div>
              <ul className="space-y-2.5">
                {b.hypotheses.map((h, i) => (
                  <li key={i}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[12px] font-medium text-slate-900 leading-snug">{h.hypothesis}</div>
                      <div className="text-[10px] font-bold text-violet-700 shrink-0 mt-0.5">{pct(h.confidence)}</div>
                    </div>
                    <div className="mt-1 h-1 rounded bg-violet-100 overflow-hidden">
                      <div className="h-full bg-violet-500" style={{ width: `${Math.min(100, Math.max(4, (h.confidence || 0) * 100))}%` }} />
                    </div>
                    {h.evidence && (
                      <div className="text-[11px] text-slate-600 mt-1.5 italic">Evidence: {h.evidence}</div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Trajectory — only show if the model produced a non-zero estimate */}
          {hasTrajectory && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold text-blue-700 mb-2 inline-flex items-center gap-1.5">
                <Gauge className="h-3 w-3" /> 24h forecast · confidence {pct(trajectory.confidence)}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Expected units</div>
                  <div className="text-sm font-semibold text-slate-900">{num(trajectory.expected_units)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500">Expected revenue</div>
                  <div className="text-sm font-semibold text-slate-900">{naira(trajectory.expected_revenue_naira)}</div>
                </div>
              </div>
            </div>
          )}

          {/* Recommended actions */}
          {Array.isArray(b.recommended_actions) && b.recommended_actions.length > 0 && (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
              <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 mb-2 inline-flex items-center gap-1.5">
                <Target className="h-3 w-3" /> Recommended actions
              </div>
              <ol className="space-y-2.5">
                {b.recommended_actions
                  .slice()
                  .sort((x, y) => (x.priority || 99) - (y.priority || 99))
                  .map((a, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <div className="h-5 w-5 rounded-md bg-white border border-emerald-200 grid place-items-center text-[10px] font-bold text-emerald-700 shrink-0 mt-0.5">
                        {a.priority || (i + 1)}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-slate-900 leading-snug">{a.action}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5 inline-flex items-center gap-1.5">
                          <Users className="h-3 w-3" /> {a.owner}
                        </div>
                        {a.rationale && (
                          <div className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{a.rationale}</div>
                        )}
                      </div>
                    </li>
                  ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, tint }) {
  const tintCls = tint === "emerald" ? "text-emerald-700" : tint === "rose" ? "text-rose-700" : "text-slate-900";
  return (
    <div className="rounded-md bg-slate-50 border border-slate-100 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-[12px] font-semibold ${tintCls}`}>{value}</div>
    </div>
  );
}

function Kpi({ label, value, Icon, tint, sub }) {
  const C = {
    emerald: "bg-emerald-50 text-emerald-600",
    blue:    "bg-blue-50 text-blue-600",
    indigo:  "bg-indigo-50 text-indigo-600",
    rose:    "bg-rose-50 text-rose-600",
    slate:   "bg-slate-100 text-slate-500",
  }[tint];
  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        <div className={`h-8 w-8 rounded-lg grid place-items-center ${C}`}><Icon className="h-4 w-4" /></div>
      </div>
      <div className="text-2xl font-bold text-slate-900 mt-2 tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}
