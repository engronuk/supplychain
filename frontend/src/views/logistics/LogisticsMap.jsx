// Logistics Command Map — Google Maps with warehouse health markers,
// animated shipment routes, live truck tracking and a demand overlay toggle.
import { useEffect, useRef, useState } from "react";
import { Layers } from "lucide-react";

// Shared idempotent Maps JS loader (same script id as CommandCenter so the
// API is only injected once per session).
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

const HEALTH_COLORS = {
  healthy: { fill: "#10B981", stroke: "#047857" },
  low: { fill: "#F59E0B", stroke: "#B45309" },
  critical: { fill: "#EF4444", stroke: "#B91C1C" },
};

const truckIcon = (color) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="white" stroke="${color}" stroke-width="1.6"/>` +
    `<g transform="translate(4.6,5.6) scale(0.6)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>` +
    `<path d="M15 18H9"/>` +
    `<path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>` +
    `<circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></g></svg>`
  )}`;

const num = (n) => (Number(n) || 0).toLocaleString();

function etaLabel(mins) {
  if (mins == null) return "—";
  if (mins <= 0) return "Arrived";
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export const LogisticsMap = ({ warehouses, routes, trucks, demandOverlay, onViewWarehouse, autoFit = false }) => {
  const apiKey = process.env.REACT_APP_MAPS_API_KEY;
  const mapsReady = useGoogleMaps(apiKey);
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const overlays = useRef([]);     // markers + polylines
  const demandShapes = useRef([]); // toggleable demand circles
  const animTimer = useRef(null);
  const [showDemand, setShowDemand] = useState(false);

  // Expose the warehouse drill-down to InfoWindow buttons.
  useEffect(() => {
    window.__tkViewWarehouse = (id) => onViewWarehouse?.(id);
    return () => { delete window.__tkViewWarehouse; };
  }, [onViewWarehouse]);

  useEffect(() => {
    if (!mapsReady || !mapRef.current) return;
    const g = window.google.maps;
    if (!mapObj.current) {
      mapObj.current = new g.Map(mapRef.current, {
        center: { lat: 8.6, lng: 7.6 },
        zoom: 6,
        styles: [{ featureType: "poi", stylers: [{ visibility: "off" }] }],
        disableDefaultUI: true,
        zoomControl: true,
      });
    }
    const map = mapObj.current;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    demandShapes.current.forEach((o) => o.setMap(null));
    demandShapes.current = [];
    if (animTimer.current) { clearInterval(animTimer.current); animTimer.current = null; }

    const info = new g.InfoWindow();

    // ---- Warehouse markers -------------------------------------------------
    (warehouses || []).forEach((w) => {
      const c = HEALTH_COLORS[w.health] || HEALTH_COLORS.healthy;
      const marker = new g.Marker({
        position: { lat: w.lat, lng: w.lng },
        map,
        title: `${w.name} — ${num(w.units)} units`,
        zIndex: 30,
        icon: {
          path: g.SymbolPath.CIRCLE,
          fillColor: c.fill, fillOpacity: 0.9,
          strokeColor: c.stroke, strokeWeight: 2,
          scale: 11,
        },
        label: { text: "W", color: "#ffffff", fontSize: "10px", fontWeight: "700" },
      });
      marker.addListener("click", () => {
        info.setContent(`<div style="font-family:Inter,sans-serif;min-width:185px">
          <div style="font-weight:700;font-size:13px">${w.name}</div>
          <div style="color:#64748b;font-size:11px;margin-top:2px">${w.city}${w.region ? " · " + w.region : ""}</div>
          <div style="font-weight:600;margin-top:5px">${num(w.units)} units on hand</div>
          <div style="color:#475569;font-size:11px;margin-top:2px">${w.low_stock_skus}/${w.total_skus} SKUs at/below reorder</div>
          <div style="font-size:11px;margin-top:3px;color:${c.fill};font-weight:700;text-transform:uppercase">${w.health}</div>
          <button onclick="window.__tkViewWarehouse && window.__tkViewWarehouse('${w.id}')"
            style="margin-top:7px;background:#2563EB;color:white;border:none;border-radius:6px;padding:4px 10px;font-size:11px;cursor:pointer">
            View Warehouse</button>
        </div>`);
        info.open(map, marker);
      });
      overlays.current.push(marker);
    });

    // ---- Shipment routes (animated dashes) -----------------------------------
    const lines = [];
    (routes || []).forEach((r) => {
      const delayedRoute = r.status === "delayed";
      const color = delayedRoute ? "#EF4444" : "#10B981";
      const line = new g.Polyline({
        path: [{ lat: r.from.lat, lng: r.from.lng }, { lat: r.to.lat, lng: r.to.lng }],
        geodesic: true,
        strokeOpacity: 0,
        zIndex: 10,
        icons: [
          { icon: { path: "M 0,-1 0,1", strokeOpacity: 0.55, strokeColor: color, scale: 2.4 }, offset: "0", repeat: "12px" },
          { icon: { path: g.SymbolPath.CIRCLE, scale: 2.6, strokeColor: color, fillColor: color, fillOpacity: 1, strokeWeight: 1 }, offset: "0%" },
        ],
        map,
      });
      line.addListener("click", (e) => {
        info.setContent(`<div style="font-family:Inter,sans-serif;min-width:170px">
          <div style="font-weight:700;font-size:12px">${r.tracking_code}</div>
          <div style="color:#475569;font-size:11px;margin-top:3px">${r.from.name} → ${r.to.name}</div>
          <div style="font-size:11px;margin-top:2px">${num(r.units)} units · <span style="color:${color};font-weight:700">${delayedRoute ? "DELAYED" : "IN TRANSIT"}</span></div>
        </div>`);
        info.setPosition(e.latLng);
        info.open(map);
      });
      lines.push(line);
      overlays.current.push(line);
    });
    // Animate the moving dot along each line.
    if (lines.length) {
      let step = 0;
      animTimer.current = setInterval(() => {
        step = (step + 1) % 100;
        lines.forEach((l) => {
          const icons = l.get("icons");
          icons[1].offset = `${step}%`;
          l.set("icons", icons);
        });
      }, 120);
    }

    // ---- Trucks -----------------------------------------------------------------
    (trucks || []).forEach((t) => {
      if (t.lat == null || t.lng == null) return;
      const color = t.status === "stopped" ? "#EF4444" : t.status === "in_transit" ? "#10B981" : "#94A3B8";
      const marker = new g.Marker({
        position: { lat: t.lat, lng: t.lng },
        map,
        title: `Truck ${t.code}`,
        zIndex: 40,
        icon: { url: truckIcon(color), scaledSize: new g.Size(34, 34), anchor: new g.Point(17, 17) },
      });
      marker.addListener("click", () => {
        info.setContent(`<div style="font-family:Inter,sans-serif;min-width:185px">
          <div style="font-weight:700;font-size:13px">Truck ${t.code}</div>
          <div style="font-size:11px;margin-top:3px">Status: <span style="color:${color};font-weight:700;text-transform:uppercase">${(t.status || "").replace("_", " ")}</span></div>
          ${t.origin_name ? `<div style="color:#475569;font-size:11px;margin-top:3px">From: ${t.origin_name}</div>` : ""}
          ${t.dest_name ? `<div style="color:#475569;font-size:11px">To: ${t.dest_name}</div>` : ""}
          ${t.eta_minutes != null ? `<div style="font-weight:600;font-size:12px;margin-top:4px">ETA: ${etaLabel(t.eta_minutes)}</div>` : ""}
          ${t.driver_name ? `<div style="color:#64748b;font-size:11px;margin-top:3px">Driver: ${t.driver_name}</div>` : ""}
        </div>`);
        info.open(map, marker);
      });
      overlays.current.push(marker);
    });

    // ---- Demand overlay circles (toggleable) ----------------------------------
    (demandOverlay || []).forEach((d) => {
      const pct = Math.max(0, Number(d.pct) || 0);
      const circle = new g.Circle({
        center: { lat: d.lat, lng: d.lng },
        radius: 35000 + pct * 4200,
        fillColor: "#6366F1", fillOpacity: 0.14,
        strokeColor: "#6366F1", strokeOpacity: 0.4, strokeWeight: 1,
        map: showDemand ? map : null,
        zIndex: 5,
      });
      demandShapes.current.push(circle);
    });

    // ---- Auto-fit bounds when requested -----------------------------------
    if (autoFit) {
      const bounds = new g.LatLngBounds();
      (warehouses || []).forEach((w) => {
        if (w.lat != null && w.lng != null) bounds.extend({ lat: w.lat, lng: w.lng });
      });
      (routes || []).forEach((r) => {
        if (r?.to?.lat != null) bounds.extend({ lat: r.to.lat, lng: r.to.lng });
      });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { top: 60, right: 40, bottom: 40, left: 40 });
        const max_zoom_listener = g.event.addListenerOnce(map, "idle", () => {
          if (map.getZoom() > 12) map.setZoom(12);
        });
        // Auto-cancel after a second so manual zoom isn't fought by the listener.
        setTimeout(() => g.event.removeListener(max_zoom_listener), 1500);
      }
    }

    return () => {
      if (animTimer.current) { clearInterval(animTimer.current); animTimer.current = null; }
    };
  }, [mapsReady, warehouses, routes, trucks, demandOverlay, showDemand, autoFit]);

  return (
    <div className="rounded-xl bg-white border border-slate-200/80 shadow-sm overflow-hidden" data-testid="logistics-map-card">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="font-semibold text-slate-900 text-sm">Logistics Command Map</div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 flex-wrap">
          <Legend color="#10B981" label="Healthy" />
          <Legend color="#F59E0B" label="Low Stock" />
          <Legend color="#EF4444" label="Critical / Delayed" />
          <Legend color="#10B981" label="Truck" truck />
          <button
            type="button"
            onClick={() => setShowDemand((v) => !v)}
            data-testid="map-demand-toggle"
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors ${
              showDemand ? "bg-indigo-50 border-indigo-300 text-indigo-700" : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            <Layers className="h-3 w-3" /> Demand layer
          </button>
        </div>
      </div>
      {!apiKey ? (
        <div className="h-[560px] grid place-items-center text-sm text-slate-400 p-6 text-center">
          Google Maps API key not configured.
        </div>
      ) : !mapsReady ? (
        <div className="h-[560px] grid place-items-center text-sm text-slate-400">Loading map…</div>
      ) : (
        <div ref={mapRef} className="h-[560px] w-full" data-testid="logistics-map" />
      )}
      <div className="px-5 py-2.5 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
        <span>{(warehouses || []).length} warehouses · {(routes || []).length} active lanes · {(trucks || []).filter((t) => t.status === "in_transit").length} trucks moving</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Real-time data</span>
      </div>
    </div>
  );
};

function Legend({ color, label, truck }) {
  return (
    <span className="inline-flex items-center gap-1">
      {truck ? (
        <img src={truckIcon(color)} alt="" className="h-3.5 w-3.5" />
      ) : (
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      )}
      {label}
    </span>
  );
}
