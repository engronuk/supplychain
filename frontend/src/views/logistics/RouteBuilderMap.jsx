// Route Builder map — origin, draft stops and the computed (optimized)
// itinerary drawn on the same night canvas as the Control Tower.
import { useEffect, useRef } from "react";
import { Waypoints } from "lucide-react";
import { useGoogleMaps } from "./LogisticsMap";

const NIGHT_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0b1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1220" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1e293b" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#15203c" }] },
  { featureType: "road", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#060b16" }] },
];

export const RouteBuilderMap = ({ origin, stops, preview }) => {
  const apiKey = process.env.REACT_APP_MAPS_API_KEY;
  const mapsReady = useGoogleMaps(apiKey);
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const overlays = useRef([]);

  useEffect(() => {
    if (!mapsReady || !mapRef.current) return;
    const g = window.google.maps;
    if (!mapObj.current) {
      mapObj.current = new g.Map(mapRef.current, {
        center: { lat: 8.8, lng: 7.8 }, zoom: 6,
        styles: NIGHT_STYLE, disableDefaultUI: true, zoomControl: true,
        backgroundColor: "#0b1220",
      });
    }
    const map = mapObj.current;
    overlays.current.forEach((o) => o.setMap(null));
    overlays.current = [];
    const bounds = new g.LatLngBounds();
    let any = false;

    if (origin?.lat != null) {
      overlays.current.push(new g.Marker({
        position: { lat: origin.lat, lng: origin.lng }, map, zIndex: 40,
        title: origin.name,
        icon: { path: g.SymbolPath.CIRCLE, fillColor: "#3B82F6", fillOpacity: 0.95, strokeColor: "#0B1220", strokeWeight: 2, scale: 10 },
        label: { text: "W", color: "#ffffff", fontSize: "10px", fontWeight: "700" },
      }));
      bounds.extend({ lat: origin.lat, lng: origin.lng });
      any = true;
    }

    const ordered = preview?.stops;
    if (ordered?.length) {
      ordered.forEach((s) => {
        if (s.lat == null) return;
        overlays.current.push(new g.Marker({
          position: { lat: s.lat, lng: s.lng }, map, zIndex: 35, title: s.dest_name,
          icon: { path: g.SymbolPath.CIRCLE, fillColor: "#10B981", fillOpacity: 0.95, strokeColor: "#0B1220", strokeWeight: 2, scale: 9 },
          label: { text: String(s.seq), color: "#06291d", fontSize: "10px", fontWeight: "800" },
        }));
        bounds.extend({ lat: s.lat, lng: s.lng });
        any = true;
      });
      const path = (preview.polyline || []).map(([lat, lng]) => ({ lat, lng }));
      if (path.length >= 2) {
        overlays.current.push(new g.Polyline({
          path, geodesic: true, map, zIndex: 20,
          strokeColor: "#10B981", strokeOpacity: 0.9, strokeWeight: 3.5,
        }));
      }
    } else {
      (stops || []).forEach((s) => {
        if (s.lat == null) return;
        overlays.current.push(new g.Marker({
          position: { lat: s.lat, lng: s.lng }, map, zIndex: 30, title: s.dest_name,
          icon: { path: g.SymbolPath.CIRCLE, fillColor: "#94A3B8", fillOpacity: 0.85, strokeColor: "#0B1220", strokeWeight: 1.5, scale: 7 },
        }));
        bounds.extend({ lat: s.lat, lng: s.lng });
        any = true;
      });
    }

    if (any && !bounds.isEmpty()) {
      map.fitBounds(bounds, { top: 55, right: 55, bottom: 45, left: 55 });
      g.event.addListenerOnce(map, "idle", () => { if (map.getZoom() > 11) map.setZoom(11); });
    }
  }, [mapsReady, origin, stops, preview]);

  return (
    <div className="rounded-xl bg-slate-900/60 border border-slate-800 overflow-hidden min-w-0" data-testid="route-builder-map-card">
      <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <Waypoints className="h-4 w-4 text-emerald-400" /> Route Canvas
        </div>
        <span className="text-[11px] text-slate-500">
          {preview ? `${preview.stops.length} stops · ${preview.total_km} km` : "compute a route to see the optimized run"}
        </span>
      </div>
      {!apiKey ? (
        <div className="h-[360px] grid place-items-center text-sm text-slate-500">Google Maps API key not configured.</div>
      ) : !mapsReady ? (
        <div className="h-[360px] grid place-items-center text-sm text-slate-500">Loading map…</div>
      ) : (
        <div ref={mapRef} className="h-[360px] w-full" data-testid="route-builder-map" />
      )}
    </div>
  );
};
