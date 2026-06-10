// Manufacturer Command Center — Real-Time Pulse
// ---------------------------------------------------------------------------
// • Google Maps embed with one bubble per region, sized by 24h sales value
// • Live KPI strip from BigQuery `/api/pulse/by-region`
// • Vertex AI Gemini-explained alerts from `/api/pulse/alerts/enriched`
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from "react";
import { Sparkles, MapPin, TrendingUp, AlertTriangle, RefreshCw, Cloud } from "lucide-react";
import { Api } from "../lib/api";
import { Button } from "../components/ui/button";

const naira = (n) => `₦${(Number(n) || 0).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const num   = (n) => (Number(n) || 0).toLocaleString();

// Load the Google Maps JS API once (idempotent across remounts).
function useGoogleMaps(apiKey) {
  const [ready, setReady] = useState(!!window.google?.maps);
  useEffect(() => {
    if (window.google?.maps) { setReady(true); return; }
    if (!apiKey) return;
    const id = "tk-maps-script";
    if (document.getElementById(id)) {
      document.getElementById(id).addEventListener("load", () => setReady(true));
      return;
    }
    const s = document.createElement("script");
    s.id = id;
    s.async = true; s.defer = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [apiKey]);
  return ready;
}

export default function CommandCenter() {
  const apiKey = process.env.REACT_APP_MAPS_API_KEY;
  const mapsReady = useGoogleMaps(apiKey);
  const [regions, setRegions] = useState([]);
  const [alerts, setAlerts]   = useState([]);
  const [health, setHealth]   = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);

  const reload = () => {
    setRefreshing(true);
    Promise.all([
      Api.pulseByRegion(24).then((r) => setRegions(r.rows || [])).catch(() => setRegions([])),
      Api.pulseAlertsEnriched().then((r) => setAlerts(r.alerts || [])).catch(() => setAlerts([])),
      Api.pulseHealth().then(setHealth).catch(() => setHealth(null)),
    ]).finally(() => setRefreshing(false));
  };
  useEffect(() => { reload(); }, []);

  // Build / refresh map markers
  useEffect(() => {
    if (!mapsReady || !mapRef.current) return;
    if (!mapObj.current) {
      mapObj.current = new window.google.maps.Map(mapRef.current, {
        center: { lat: 9.082, lng: 8.6753 }, // Nigeria center
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
            Live sales activity from BigQuery with Vertex AI proactive-restock intelligence overlaid on the network map.
          </p>
        </div>
        <Button variant="outline" className="border-slate-200" onClick={reload} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi label="24h Revenue"   value={naira(totals.revenue)}  Icon={TrendingUp}    tint="emerald" />
        <Kpi label="24h Units"     value={num(totals.units)}       Icon={Sparkles}      tint="blue" />
        <Kpi label="24h Events"    value={num(totals.events)}      Icon={MapPin}        tint="indigo" />
        <Kpi label="Restock Alerts" value={num(alerts.length)}     Icon={AlertTriangle} tint={alerts.length ? "rose" : "slate"} />
      </div>

      {/* Map + alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-5">
        <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-semibold text-slate-900 text-sm">Sales Heatmap · Last 24h</div>
            <div className="text-xs text-slate-500">{regions.length} regions</div>
          </div>
          {!apiKey ? (
            <div className="h-[460px] grid place-items-center text-sm text-slate-400 p-6 text-center">
              <span>Google Maps API key not configured. Set <code>REACT_APP_MAPS_API_KEY</code> in frontend/.env.</span>
            </div>
          ) : !mapsReady ? (
            <div className="h-[460px] grid place-items-center text-sm text-slate-400">Loading map…</div>
          ) : (
            <div ref={mapRef} className="h-[460px] w-full" data-testid="pulse-map" />
          )}
          <div className="px-5 py-3 border-t border-slate-100 text-[11px] text-slate-500">
            BigQuery · {health?.dataset || "pulse"}.sales_events · {health?.location || "europe-west2"}
          </div>
        </div>

        <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <div className="font-semibold text-slate-900 text-sm inline-flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" /> Proactive Restock Alerts
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Vertex AI</span>
          </div>
          <div className="max-h-[460px] overflow-y-auto">
            {alerts.length === 0 ? (
              <div className="text-center text-slate-400 text-sm py-16 px-6">
                No spikes detected. Velocity is within 1.5× of the 14-day baseline.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {alerts.map((a, i) => (
                  <li key={i} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 text-sm">{a.product_name || a.product_id}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{a.region}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-rose-600 leading-none">{Number(a.velocity_ratio || 0).toFixed(1)}×</div>
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 mt-0.5">vs 14d avg</div>
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-2">
                      {num(a.units_24h)} units in 24h · baseline {Number(a.avg_daily_units_14d || 0).toFixed(0)}/day
                    </div>
                    {a.explanation && (
                      <div className="mt-2 rounded-md bg-violet-50 border border-violet-100 px-3 py-2 text-xs text-violet-900 leading-relaxed">
                        <Sparkles className="inline h-3 w-3 mr-1 -mt-0.5" />
                        {a.explanation}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, Icon, tint }) {
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
    </div>
  );
}
