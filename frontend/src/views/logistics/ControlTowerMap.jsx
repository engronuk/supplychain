// Control Tower live map — dark mission-control canvas with trucks moving on
// real road polylines, warehouse geofences, distributor risk nodes and
// retailer cluster layers. Truck markers update in place (no flicker).
// Supports fullscreen monitoring mode and single-vehicle isolation.
import { useEffect, useRef, useState } from "react";
import { Crosshair, Maximize2, Minimize2 } from "lucide-react";
import { useGoogleMaps } from "./LogisticsMap";
import { MapWatchlist } from "./MapWatchlist";

const NIGHT_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1220" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1e293b" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#334155" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#15203c" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1d2a4a" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#060b16" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#334155" }] },
];

const COLORS = {
  on_route: "#10B981",
  delayed: "#F59E0B",
  exception: "#F97316",
  breakdown: "#EF4444",
};

export const vehicleColor = (v) => {
  if (v.status === "breakdown") return COLORS.breakdown;
  if (v.status === "stopped" || (v.deviation && v.deviation.active)) return COLORS.exception;
  if ((Number(v.speed_kmh) || 55) < 40) return COLORS.delayed;
  return COLORS.on_route;
};

const truckIcon = (color, selected) =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24">` +
    `<circle cx="12" cy="12" r="11" fill="${color}" stroke="${selected ? "#FFFFFF" : "#0B1220"}" stroke-width="${selected ? 2.4 : 1.4}"/>` +
    `<g transform="translate(4.6,5.6) scale(0.6)" fill="none" stroke="#0B1220" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>` +
    `<path d="M15 18H9"/>` +
    `<path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>` +
    `<circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></g></svg>`
  )}`;

const ACTIVE_STATUSES = ["in_transit", "stopped", "breakdown"];
const num = (n) => (Number(n) || 0).toLocaleString();

export const ControlTowerMap = ({
  fleet, geofences, warehouses, distributors, retailerClusters,
  selectedVehicleId, onSelectVehicle,
}) => {
  const apiKey = process.env.REACT_APP_MAPS_API_KEY;
  const mapsReady = useGoogleMaps(apiKey);
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const infoRef = useRef(null);
  const staticOverlays = useRef([]);
  const truckMarkers = useRef(new Map());
  const routeLines = useRef(new Map());
  const didFit = useRef(false);
  const propsRef = useRef({});
  propsRef.current = { fleet, geofences, warehouses, distributors, retailerClusters, onSelectVehicle };

  const [layers, setLayers] = useState({ routes: true, fences: true, distributors: true, retailers: false });
  const toggle = (key) => setLayers((l) => ({ ...l, [key]: !l[key] }));
  const [full, setFull] = useState(false);

  // Fullscreen: re-render tiles after the container resizes; Esc exits.
  useEffect(() => {
    if (mapObj.current && window.google?.maps) {
      const center = mapObj.current.getCenter();
      window.google.maps.event.trigger(mapObj.current, "resize");
      if (center) mapObj.current.setCenter(center);
    }
    if (!full) return;
    const onKey = (e) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  // ---- Map init ------------------------------------------------------------
  useEffect(() => {
    if (!mapsReady || !mapRef.current || mapObj.current) return;
    const g = window.google.maps;
    mapObj.current = new g.Map(mapRef.current, {
      center: { lat: 8.8, lng: 7.8 },
      zoom: 6,
      styles: NIGHT_STYLE,
      disableDefaultUI: true,
      zoomControl: true,
      backgroundColor: "#0b1220",
    });
    infoRef.current = new g.InfoWindow();
  }, [mapsReady]);

  // ---- Static layers (warehouses, fences, distributors, retailers) ---------
  const staticSig = `${(warehouses || []).length}|${(geofences || []).length}|${(distributors || []).length}|${(retailerClusters || []).length}`;
  useEffect(() => {
    if (!mapsReady || !mapObj.current) return;
    const g = window.google.maps;
    const map = mapObj.current;
    staticOverlays.current.forEach((o) => o.setMap(null));
    staticOverlays.current = [];
    const info = infoRef.current;
    const p = propsRef.current;

    (p.warehouses || []).forEach((w) => {
      if (w.lat == null) return;
      const m = new g.Marker({
        position: { lat: w.lat, lng: w.lng }, map, zIndex: 30,
        title: w.name,
        icon: {
          path: g.SymbolPath.CIRCLE, fillColor: "#3B82F6", fillOpacity: 0.95,
          strokeColor: "#0B1220", strokeWeight: 2, scale: 10,
        },
        label: { text: "W", color: "#ffffff", fontSize: "10px", fontWeight: "700" },
      });
      m.addListener("click", () => {
        const cur = (propsRef.current.warehouses || []).find((x) => x.id === w.id) || w;
        info.setContent(`<div style="font-family:Inter,sans-serif;min-width:185px;color:#0f172a">
          <div style="font-weight:700;font-size:13px">${cur.name}</div>
          <div style="color:#64748b;font-size:11px;margin-top:2px">${cur.city || ""}${cur.region ? " · " + cur.region : ""}</div>
          <div style="font-weight:600;margin-top:5px">${num(cur.units)} / ${num(cur.capacity)} units</div>
          <div style="font-size:11px;color:#475569;margin-top:2px">Utilization ${cur.utilization_pct}% · 500 m geofence active</div>
        </div>`);
        info.open(map, m);
      });
      staticOverlays.current.push(m);
    });

    if (layers.fences) {
      (p.geofences || []).forEach((f) => {
        if (f.lat == null) return;
        const c = new g.Circle({
          center: { lat: f.lat, lng: f.lng },
          radius: f.radius_m || 500,
          fillColor: "#22D3EE", fillOpacity: 0.10,
          strokeColor: "#22D3EE", strokeOpacity: 0.55, strokeWeight: 1.2,
          map, zIndex: 6,
        });
        staticOverlays.current.push(c);
      });
    }

    if (layers.distributors) {
      const riskColor = { high: "#F43F5E", medium: "#F59E0B", low: "#10B981", unknown: "#64748B" };
      (p.distributors || []).forEach((d) => {
        if (d.lat == null) return;
        const m = new g.Marker({
          position: { lat: d.lat, lng: d.lng }, map, zIndex: 20, title: d.name,
          icon: {
            path: g.SymbolPath.CIRCLE, fillColor: riskColor[d.risk] || riskColor.unknown,
            fillOpacity: 0.9, strokeColor: "#0B1220", strokeWeight: 1.5, scale: 6,
          },
        });
        m.addListener("click", () => {
          info.setContent(`<div style="font-family:Inter,sans-serif;min-width:170px;color:#0f172a">
            <div style="font-weight:700;font-size:12px">${d.name}</div>
            <div style="color:#64748b;font-size:11px;margin-top:2px">${d.city || ""}${d.region ? " · " + d.region : ""}</div>
            <div style="font-size:11px;margin-top:4px">${num(d.units)} units on hand</div>
            <div style="font-size:11px;color:${riskColor[d.risk] || "#64748b"};font-weight:700;margin-top:2px">
              ${d.stock_cover_days != null ? d.stock_cover_days + "d cover · " : ""}${(d.risk || "").toUpperCase()} RISK</div>
          </div>`);
          info.open(map, m);
        });
        staticOverlays.current.push(m);
      });
    }

    if (layers.retailers) {
      (p.retailerClusters || []).forEach((r) => {
        if (r.lat == null) return;
        const m = new g.Marker({
          position: { lat: r.lat, lng: r.lng }, map, zIndex: 10,
          icon: {
            path: g.SymbolPath.CIRCLE, fillColor: "#94A3B8", fillOpacity: 0.6,
            strokeColor: "#0B1220", strokeWeight: 1, scale: 3.5,
          },
        });
        m.addListener("click", () => {
          info.setContent(`<div style="font-family:Inter,sans-serif;color:#0f172a">
            <div style="font-weight:700;font-size:12px">${r.city}</div>
            <div style="font-size:11px;color:#475569">${num(r.count)} retail outlets</div>
          </div>`);
          info.open(map, m);
        });
        staticOverlays.current.push(m);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsReady, staticSig, layers.fences, layers.distributors, layers.retailers]);

  // ---- Trucks + route polylines (updated in place) --------------------------
  useEffect(() => {
    if (!mapsReady || !mapObj.current) return;
    const g = window.google.maps;
    const map = mapObj.current;
    const seen = new Set();

    (fleet || []).forEach((v) => {
      if (v.lat == null || v.lng == null || !ACTIVE_STATUSES.includes(v.status)) return;
      seen.add(v.id);
      const isSel = v.id === selectedVehicleId;
      const color = vehicleColor(v);
      const pos = { lat: v.lat, lng: v.lng };

      let m = truckMarkers.current.get(v.id);
      if (!m) {
        m = new g.Marker({ position: pos, map, zIndex: isSel ? 60 : 50, title: `Truck ${v.code}` });
        m.addListener("click", () => propsRef.current.onSelectVehicle?.(v.id));
        truckMarkers.current.set(v.id, m);
      } else {
        m.setPosition(pos);
      }
      const size = isSel ? 44 : 34;
      m.setIcon({ url: truckIcon(color, isSel), scaledSize: new g.Size(size, size), anchor: new g.Point(size / 2, size / 2) });
      m.setZIndex(isSel ? 60 : 50);

      const path = (v.route_polyline || []).map(([lat, lng]) => ({ lat, lng }));
      if (path.length >= 2) {
        let line = routeLines.current.get(v.id);
        if (!line) {
          line = new g.Polyline({ path, geodesic: true });
          routeLines.current.set(v.id, line);
        } else if (line.getPath().getLength() !== path.length) {
          line.setPath(path);
        }
        line.setOptions({
          strokeColor: color,
          strokeOpacity: isSel ? 0.95 : 0.35,
          strokeWeight: isSel ? 4 : 2,
          zIndex: isSel ? 22 : 8,
          map: (layers.routes || isSel) ? map : null,
        });
      }
    });

    [...truckMarkers.current.keys()].forEach((id) => {
      if (!seen.has(id)) {
        truckMarkers.current.get(id)?.setMap(null);
        truckMarkers.current.delete(id);
        routeLines.current.get(id)?.setMap(null);
        routeLines.current.delete(id);
      }
    });

    if (!didFit.current && seen.size) {
      const bounds = new g.LatLngBounds();
      (fleet || []).forEach((v) => { if (v.lat != null && ACTIVE_STATUSES.includes(v.status)) bounds.extend({ lat: v.lat, lng: v.lng }); });
      (propsRef.current.warehouses || []).forEach((w) => { if (w.lat != null) bounds.extend({ lat: w.lat, lng: w.lng }); });
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { top: 50, right: 40, bottom: 40, left: 40 });
        g.event.addListenerOnce(map, "idle", () => { if (map.getZoom() > 8) map.setZoom(8); });
        didFit.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapsReady, fleet, selectedVehicleId, layers.routes]);

  // ---- Pan to selection ------------------------------------------------------
  useEffect(() => {
    if (!mapsReady || !mapObj.current || !selectedVehicleId) return;
    const v = (propsRef.current.fleet || []).find((x) => x.id === selectedVehicleId);
    if (v?.lat != null) {
      mapObj.current.panTo({ lat: v.lat, lng: v.lng });
      if (mapObj.current.getZoom() < 8) mapObj.current.setZoom(8);
    }
  }, [mapsReady, selectedVehicleId]);

  const moving = (fleet || []).filter((v) => v.status === "in_transit").length;
  const exceptions = (fleet || []).filter((v) =>
    v.status === "breakdown" || v.status === "stopped" || (v.deviation && v.deviation.active)).length;

  return (
    <div
      className={full
        ? "fixed inset-0 z-[200] bg-[#070D1A] border border-slate-800 overflow-hidden min-w-0 flex flex-col"
        : "rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden min-w-0"}
      data-testid="control-tower-map-card"
    >
      <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Crosshair className="h-4 w-4 text-emerald-400" /> Live Network Map
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <LayerChip active={layers.routes} onClick={() => toggle("routes")} label="Routes" testId="map-toggle-routes" />
          <LayerChip active={layers.fences} onClick={() => toggle("fences")} label="Geofences" testId="map-toggle-fences" />
          <LayerChip active={layers.distributors} onClick={() => toggle("distributors")} label="Distributors" testId="map-toggle-distributors" />
          <LayerChip active={layers.retailers} onClick={() => toggle("retailers")} label="Retailers" testId="map-toggle-retailers" />
          <button
            type="button"
            onClick={() => setFull((f) => !f)}
            data-testid="map-fullscreen-btn"
            title={full ? "Exit fullscreen (Esc)" : "Fullscreen monitoring"}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300"
          >
            {full ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            {full ? "Exit" : "Expand"}
          </button>
        </div>
      </div>
      {!apiKey ? (
        <div className={`${full ? "flex-1" : "h-[560px]"} grid place-items-center text-sm text-slate-500 p-6 text-center`}>
          Google Maps API key not configured.
        </div>
      ) : !mapsReady ? (
        <div className={`${full ? "flex-1" : "h-[560px]"} grid place-items-center text-sm text-slate-500`}>Loading map…</div>
      ) : (
        <div ref={mapRef} className={`${full ? "flex-1" : "h-[560px]"} w-full`} data-testid="control-tower-map" />
      )}
      {full && mapsReady && (
        <MapWatchlist
          fleet={fleet || []}
          onFocus={(v) => {
            if (mapObj.current && v?.lat != null) {
              mapObj.current.panTo({ lat: v.lat, lng: v.lng });
              if (mapObj.current.getZoom() < 9) mapObj.current.setZoom(9);
            }
          }}
        />
      )}
      <div className="px-4 py-2 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Dot color={COLORS.on_route} label="On route" />
          <Dot color={COLORS.delayed} label="Delayed" />
          <Dot color={COLORS.exception} label="Route exception" />
          <Dot color={COLORS.breakdown} label="Breakdown" />
          <Dot color="#22D3EE" label="Geofence" />
        </div>
        <span className="inline-flex items-center gap-1.5">
          {moving} moving · {exceptions} exception{exceptions === 1 ? "" : "s"}
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        </span>
      </div>
    </div>
  );
};

function LayerChip({ active, onClick, label, testId }) {
  return (
    <button
      type="button" onClick={onClick} data-testid={testId}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[11px] font-medium transition-colors ${
        active
          ? "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
          : "bg-slate-900 border-slate-700 text-slate-500 hover:border-slate-500"
      }`}
    >
      {label}
    </button>
  );
}

function Dot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}
