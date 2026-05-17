// NigeriaMapView.tsx
// Enterprise Nigeria supply-chain command center: Leaflet-based geographic
// visualization with an inner filter rail, top toolbar with view toggle &
// context controls, color-coded hierarchy (Manufacturer→Region→Distributor
// →Retailer), thin dashed relationship lines, and a floating retailer
// detail card with tabs.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Polyline,
  Polygon,
  ZoomControl,
  useMap,
} from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import "leaflet.markercluster/dist/MarkerCluster.Default.css";
import {
  Search,
  Layers,
  Maximize2,
  Minimize2,
  X,
  ChevronDown,
  Activity,
  Home,
  Crosshair,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Truck,
  FileText,
  Network as NetworkIcon,
  Map as MapIcon,
  Package,
  BarChart3,
  Send,
} from "lucide-react";
import {
  GeoDistributor,
  GeoNetwork,
  GeoRegion,
  GeoRetailer,
  GeoStatus,
  RetailerDetail,
  geoService,
} from "@/services/geoService";

// ============================================================================
// Constants
// ============================================================================
const COLOR = {
  manufacturer: "#6366f1", // indigo / purple
  region:       "#2563eb", // blue
  distributor:  "#f97316", // orange
  healthy:      "#10b981",
  warning:      "#f59e0b",
  critical:     "#ef4444",
  edgeRegion:   "#2563eb", // region→distributor connection
  edgeDistRet:  "#10b981", // distributor→retailer connection
} as const;

const NIGERIA_BOUNDS: [[number, number], [number, number]] = [
  [3.8, 2.6],   // SW
  [14.0, 14.7], // NE
];
const NIGERIA_CENTER: [number, number] = [9.082, 8.6753];

type ContextLayer = "health" | "density" | "fulfillment" | "shipment" | "velocity";

// ============================================================================
// Marker factories
// ============================================================================
function divIcon(html: string, size: number, anchor?: [number, number]): L.DivIcon {
  return L.divIcon({
    html,
    className: "tk-marker",
    iconSize: [size, size],
    iconAnchor: anchor || [size / 2, size / 2],
  });
}

function manufacturerIcon(): L.DivIcon {
  return divIcon(
    `<div style="display:flex;align-items:center;justify-content:center;width:52px;height:52px;border-radius:16px;background:${COLOR.manufacturer};color:#fff;box-shadow:0 4px 16px -4px rgba(99,102,241,0.55),0 0 0 4px rgba(255,255,255,0.92);">
       <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>
     </div>`,
    52
  );
}

function regionIcon(count: number): L.DivIcon {
  // Blue circle with retailer/distributor count inside
  return divIcon(
    `<div style="display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;background:${COLOR.region};color:#fff;font-weight:700;font-size:16px;font-family:ui-sans-serif,system-ui;box-shadow:0 3px 12px -3px rgba(37,99,235,0.5),0 0 0 4px rgba(255,255,255,0.95);">
       ${count}
     </div>`,
    46
  );
}

function distributorIcon(status: GeoStatus, selected: boolean): L.DivIcon {
  const inner = status === "healthy" ? COLOR.healthy : status === "warning" ? COLOR.warning : COLOR.critical;
  const size = selected ? 22 : 18;
  return divIcon(
    `<div style="position:relative;width:${size}px;height:${size}px;">
       <div style="position:absolute;inset:0;border-radius:50%;background:#ffffff;box-shadow:0 2px 6px -2px rgba(15,23,42,0.25);"></div>
       <div style="position:absolute;inset:2px;border-radius:50%;background:${COLOR.distributor};"></div>
       <div style="position:absolute;inset:6px;border-radius:50%;background:${inner};"></div>
     </div>`,
    size
  );
}

function retailerIcon(status: GeoStatus, selected: boolean): L.DivIcon {
  const color = status === "healthy" ? COLOR.healthy : status === "warning" ? COLOR.warning : COLOR.critical;
  const size = selected ? 14 : 10;
  const ring = selected ? "box-shadow:0 0 0 4px rgba(99,102,241,0.25),0 2px 6px -2px rgba(15,23,42,0.25);" : "box-shadow:0 1px 3px -1px rgba(15,23,42,0.2);";
  return divIcon(
    `<div style="width:${size}px;height:${size}px;border-radius:50%;background:#ffffff;border:2.5px solid ${color};${ring}"></div>`,
    size
  );
}

// ============================================================================
// Map helpers
// ============================================================================
function FlyTo({ to, zoom = 8 }: { to: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.flyTo(to, zoom, { duration: 0.85 });
  }, [to, zoom, map]);
  return null;
}

function ZoomTracker({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMap();
  useEffect(() => {
    const update = () => onZoom(map.getZoom());
    update();
    map.on("zoomend", update);
    return () => { map.off("zoomend", update); };
  }, [map, onZoom]);
  return null;
}

function FitNigeria({ trigger }: { trigger: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(NIGERIA_BOUNDS, { padding: [20, 20] });
  }, [trigger, map]);
  return null;
}

function MapRefBinder({ onReady }: { onReady: (m: L.Map) => void }) {
  const map = useMap();
  useEffect(() => { onReady(map); }, [map, onReady]);
  return null;
}

// ============================================================================
// Main view
// ============================================================================
export default function NigeriaMapView({
  manufacturerId,
  onSwitchToRadial,
}: {
  manufacturerId: string;
  onSwitchToRadial?: () => void;
}) {
  const [data, setData] = useState<GeoNetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRegion, setSelectedRegion] = useState<string | "all">("all");
  const [selectedState, setSelectedState] = useState<string | "all">("all");
  const [selectedDist, setSelectedDist] = useState<string | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | GeoStatus>("all");
  const [context, setContext] = useState<ContextLayer>("health");
  const [search, setSearch] = useState("");

  const [layers, setLayers] = useState({
    regions: true,
    distributors: true,
    retailers: true,
    routes: true,
  });

  const [activeRetailer, setActiveRetailer] = useState<GeoRetailer | null>(null);
  const [detail, setDetail] = useState<RetailerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [flyTo, setFlyTo] = useState<{ pos: [number, number]; zoom: number } | null>(null);
  const [zoom, setZoom] = useState(6);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [openPanel, setOpenPanel] = useState<"none" | "layers" | "context">("none");
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  // Load network
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const net = await geoService.getNetwork(manufacturerId);
        if (!cancelled) setData(net);
      } catch (e) {
        if (!cancelled) setError("Could not load network map data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [manufacturerId]);

  // Retailer detail
  useEffect(() => {
    if (!activeRetailer) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    geoService.getRetailer(activeRetailer.id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [activeRetailer]);

  // Auto-fly when filters change
  useEffect(() => {
    if (!data || selectedRegion === "all") return;
    const r = data.regions.find((x) => x.name === selectedRegion);
    if (r) setFlyTo({ pos: [r.lat, r.lon], zoom: 8 });
  }, [selectedRegion, data]);
  useEffect(() => {
    if (!data || selectedDist === "all") return;
    const d = data.distributors.find((x) => x.id === selectedDist);
    if (d) setFlyTo({ pos: [d.lat, d.lon], zoom: 11 });
  }, [selectedDist, data]);

  // Derived: unique states (cities) from distributors
  const stateOptions = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.distributors.forEach((d) => {
      if (selectedRegion === "all" || d.region === selectedRegion) {
        if (d.city) set.add(d.city);
      }
    });
    return Array.from(set).sort();
  }, [data, selectedRegion]);

  // Filtered lists
  const filteredDistributors = useMemo<GeoDistributor[]>(() => {
    if (!data) return [];
    return data.distributors.filter(
      (d) =>
        (selectedRegion === "all" || d.region === selectedRegion) &&
        (selectedState === "all" || d.city === selectedState) &&
        (selectedDist === "all" || d.id === selectedDist) &&
        (selectedStatus === "all" || d.status === selectedStatus) &&
        (!search || d.name.toLowerCase().includes(search.toLowerCase()) || d.city.toLowerCase().includes(search.toLowerCase()))
    );
  }, [data, selectedRegion, selectedState, selectedDist, selectedStatus, search]);

  const filteredRetailers = useMemo<GeoRetailer[]>(() => {
    if (!data) return [];
    const distSet = new Set(filteredDistributors.map((d) => d.id));
    return data.retailers.filter(
      (r) =>
        distSet.has(r.distributor_id) &&
        (selectedStatus === "all" || r.status === selectedStatus) &&
        (!search ||
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.city.toLowerCase().includes(search.toLowerCase()) ||
          r.store_code.toLowerCase().includes(search.toLowerCase()))
    );
  }, [data, filteredDistributors, selectedStatus, search]);

  // Zoom-based layer visibility — match the reference image: regions always
  // visible (as labels), distributors visible from regional zoom up, retailers
  // visible everywhere but heavily clustered when zoomed out.
  const showRegions = layers.regions;
  const showDistributors = layers.distributors;
  const showRetailers = layers.retailers;

  // Connection lines — Region→Distributor (blue) always rendered as soft
  // dashed background; Distributor→Retailer (green) appears at regional+
  // zoom. Lines always thin & low-opacity.
  const routeLines = useMemo(() => {
    if (!data || !layers.routes) return [];
    const lines: { a: [number, number]; b: [number, number]; color: string; weight: number; dash: string; opacity: number }[] = [];

    // Region → Distributor (blue dashed) — always
    filteredDistributors.forEach((d) => {
      const region = data.regions.find((r) => r.name === d.region);
      if (!region) return;
      lines.push({
        a: [region.lat, region.lon],
        b: [d.lat, d.lon],
        color: COLOR.edgeRegion,
        opacity: 0.16,
        weight: 1.0,
        dash: "4 5",
      });
    });

    // Distributor → Retailer (green dashed) — when zoomed in enough that
    // retailers are likely de-clustered. Limit count to keep things light.
    if (zoom >= 9 && filteredRetailers.length < 800) {
      filteredRetailers.forEach((r) => {
        const d = filteredDistributors.find((dd) => dd.id === r.distributor_id);
        if (!d) return;
        lines.push({
          a: [d.lat, d.lon],
          b: [r.lat, r.lon],
          color: COLOR.edgeDistRet,
          opacity: 0.18,
          weight: 0.8,
          dash: "2 4",
        });
      });
    }

    // Active retailer — highlight its distributor line
    if (activeRetailer) {
      const d = data.distributors.find((dd) => dd.id === activeRetailer.distributor_id);
      if (d) {
        lines.push({
          a: [d.lat, d.lon],
          b: [activeRetailer.lat, activeRetailer.lon],
          color: COLOR.manufacturer,
          opacity: 0.65,
          weight: 1.6,
          dash: "",
        });
      }
    }
    return lines;
  }, [data, layers.routes, zoom, filteredDistributors, filteredRetailers, activeRetailer]);

  const onRegionClick = useCallback((r: GeoRegion) => {
    setSelectedRegion(r.name);
    setFlyTo({ pos: [r.lat, r.lon], zoom: 8 });
  }, []);
  const onDistributorClick = useCallback((d: GeoDistributor) => {
    setSelectedDist(d.id);
    setFlyTo({ pos: [d.lat, d.lon], zoom: 11 });
  }, []);
  const onRetailerClick = useCallback((r: GeoRetailer) => {
    setActiveRetailer(r);
    setFlyTo({ pos: [r.lat, r.lon], zoom: 13 });
  }, []);

  const clearFilters = () => {
    setSelectedRegion("all");
    setSelectedState("all");
    setSelectedDist("all");
    setSelectedStatus("all");
    setSearch("");
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try { await el.requestFullscreen(); setFullscreen(true); } catch {}
    } else {
      try { await document.exitFullscreen(); setFullscreen(false); } catch {}
    }
  };

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  if (loading) {
    return <div className="h-full w-full flex items-center justify-center bg-slate-50 text-sm text-slate-500">Loading Nigeria network map…</div>;
  }
  if (error || !data) {
    return <div className="h-full w-full flex items-center justify-center bg-slate-50 text-sm text-rose-600">{error || "No data."}</div>;
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-white flex overflow-hidden"
      data-testid="nigeria-map-view"
    >
      {/* Scoped CSS — soft basemap (green-tinted), clean marker clusters, controls */}
      <style>{`
        [data-testid="nigeria-map-view"] .leaflet-tile-pane {
          filter: saturate(0.65) brightness(1.05) contrast(0.93);
        }
        [data-testid="nigeria-map-view"] .leaflet-container { background: #ffffff; }
        [data-testid="nigeria-map-view"] .tk-marker { background: transparent !important; border: 0 !important; }
        [data-testid="nigeria-map-view"] .marker-cluster {
          background: rgba(37,99,235,0.18) !important;
        }
        [data-testid="nigeria-map-view"] .marker-cluster div {
          background: rgba(255,255,255,0.96) !important;
          color: #1e293b !important;
          font: 700 12px/1 ui-sans-serif, system-ui !important;
          border: 1px solid rgba(37,99,235,0.35) !important;
          box-shadow: 0 4px 12px -4px rgba(15,23,42,0.18);
        }
        [data-testid="nigeria-map-view"] .leaflet-control-attribution {
          font-size: 9.5px !important; background: rgba(255,255,255,0.65) !important;
        }
      `}</style>

      {/* ====================== LEFT FILTER RAIL ====================== */}
      <aside
        className="relative z-10 w-[260px] flex-shrink-0 bg-white border-r border-slate-200/80 flex flex-col"
        data-testid="map-side-rail"
      >
        <div className="px-5 py-4 border-b border-slate-200/70">
          <div className="flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold">Filters</span>
            <button
              onClick={clearFilters}
              className="text-[11.5px] text-indigo-600 hover:text-indigo-700 font-medium"
              data-testid="map-clear-filters"
            >Clear All</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          <SearchBox value={search} onChange={setSearch} />
          <FilterSelect
            label="Region"
            value={selectedRegion}
            onChange={setSelectedRegion}
            options={[
              { value: "all", label: "All Regions" },
              ...data.regions.map((r) => ({ value: r.name, label: r.name })),
            ]}
            testId="map-filter-region"
          />
          <FilterSelect
            label="State / City"
            value={selectedState}
            onChange={setSelectedState}
            options={[
              { value: "all", label: "All States" },
              ...stateOptions.map((s) => ({ value: s, label: s })),
            ]}
            testId="map-filter-state"
          />
          <FilterSelect
            label="Distributor"
            value={selectedDist}
            onChange={setSelectedDist}
            options={[
              { value: "all", label: "All Distributors" },
              ...data.distributors
                .filter((d) => selectedRegion === "all" || d.region === selectedRegion)
                .map((d) => ({ value: d.id, label: d.name })),
            ]}
            testId="map-filter-distributor"
          />
          <FilterSelect
            label="Retailer Status"
            value={selectedStatus}
            onChange={(v) => setSelectedStatus(v as any)}
            options={[
              { value: "all", label: "All Statuses" },
              { value: "healthy", label: "Healthy" },
              { value: "warning", label: "Warning" },
              { value: "critical", label: "Critical" },
            ]}
            testId="map-filter-status"
          />
          <ContextLayerSelect value={context} onChange={setContext} />

          <div className="pt-4 mt-2 border-t border-slate-200/70">
            <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold mb-2">Legend</div>
            <Legend />
          </div>
        </div>
      </aside>

      {/* ====================== CENTER MAP AREA ====================== */}
      <div className="relative flex-1 min-w-0">
        {/* Top floating chrome — view toggle (left) + Network Health + Layers (right) */}
        <div className="absolute top-3 left-3 z-[600]">
          <ViewToggle active="map" onSwitch={onSwitchToRadial} />
        </div>

        <div className="absolute top-3 right-3 z-[600] flex items-center gap-2">
          <ContextDropdown
            value={context}
            onChange={setContext}
            open={openPanel === "context"}
            onToggle={() => setOpenPanel(openPanel === "context" ? "none" : "context")}
          />
          <button
            onClick={() => setOpenPanel(openPanel === "layers" ? "none" : "layers")}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm text-[12.5px] font-medium text-slate-700 hover:text-slate-900 hover:shadow-md transition-all"
            data-testid="map-layers-toggle"
          >
            <Layers className="h-3.5 w-3.5" /> Layers
          </button>
          <button
            onClick={toggleFullscreen}
            className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm text-slate-700 hover:text-slate-900 hover:shadow-md transition-all"
            aria-label="Fullscreen"
            data-testid="map-fullscreen-toggle"
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>

        {openPanel === "layers" && (
          <div className="absolute top-14 right-3 z-[600] w-56 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-lg p-3" data-testid="map-layers-panel">
            <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-2 font-medium">Map Layers</div>
            {(["regions", "distributors", "retailers", "routes"] as const).map((k) => (
              <LayerCheckbox key={k} label={k[0].toUpperCase() + k.slice(1)} checked={layers[k]} onChange={(c) => setLayers({ ...layers, [k]: c })} testId={`map-layer-${k}`} />
            ))}
          </div>
        )}

        {/* Bottom-right floating zoom controls */}
        <div className="absolute bottom-4 right-4 z-[600] flex flex-col items-center gap-2">
          <FloatBtn onClick={() => { setFitTrigger((t) => t + 1); setSelectedRegion("all"); setSelectedDist("all"); }} aria-label="Reset to Nigeria"><Home className="h-3.5 w-3.5" /></FloatBtn>
          <div className="flex flex-col rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm overflow-hidden">
            <button className="h-9 w-9 inline-flex items-center justify-center text-slate-700 hover:bg-slate-50 transition" onClick={() => mapRef.current?.zoomIn()} aria-label="Zoom in">+</button>
            <div className="h-px bg-slate-200" />
            <button className="h-9 w-9 inline-flex items-center justify-center text-slate-700 hover:bg-slate-50 transition" onClick={() => mapRef.current?.zoomOut()} aria-label="Zoom out">−</button>
          </div>
          <FloatBtn onClick={() => { setFlyTo({ pos: NIGERIA_CENTER, zoom: 6 }); }} aria-label="Locate Nigeria"><Crosshair className="h-3.5 w-3.5" /></FloatBtn>
        </div>

        {/* Bottom-left summary chips */}
        <div className="absolute bottom-4 left-4 z-[500] flex items-center gap-2 flex-wrap">
          <Chip accent={COLOR.distributor} label="Distributors" value={filteredDistributors.length} />
          <Chip accent={COLOR.healthy} label="Retailers" value={filteredRetailers.length} />
          <Chip accent={COLOR.critical} label="At risk" value={filteredRetailers.filter((r) => r.status !== "healthy").length} />
          <DrillChip zoom={zoom} />
        </div>

        {/* The Leaflet map */}
        <MapContainer
          center={NIGERIA_CENTER}
          zoom={6}
          minZoom={6}
          maxZoom={16}
          scrollWheelZoom
          zoomControl={false}
          maxBounds={NIGERIA_BOUNDS}
          maxBoundsViscosity={1.0}
          className="absolute inset-0 z-0"
          worldCopyJump={false}
          whenReady={() => { /* map ready */ }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            bounds={NIGERIA_BOUNDS}
            noWrap
          />
          <FitNigeria trigger={fitTrigger} />
          <ZoomTracker onZoom={setZoom} />
          <MapRefBinder onReady={(m) => { mapRef.current = m; }} />
          <FlyTo to={flyTo?.pos || null} zoom={flyTo?.zoom || 8} />

          {/* Mask covering outside Nigeria */}
          <Polygon
            positions={[
              [[-90, -360], [-90, 360], [90, 360], [90, -360]],
              [
                [NIGERIA_BOUNDS[0][0], NIGERIA_BOUNDS[0][1]],
                [NIGERIA_BOUNDS[1][0], NIGERIA_BOUNDS[0][1]],
                [NIGERIA_BOUNDS[1][0], NIGERIA_BOUNDS[1][1]],
                [NIGERIA_BOUNDS[0][0], NIGERIA_BOUNDS[1][1]],
              ],
            ] as any}
            pathOptions={{ fillColor: "#f8fafc", fillOpacity: 0.78, color: "#cbd5e1", weight: 0.6, interactive: false }}
          />

          {/* Connection lines — thin dashed, soft opacity */}
          {routeLines.map((l, i) => (
            <Polyline key={i} positions={[l.a, l.b]} pathOptions={{
              color: l.color, opacity: l.opacity, weight: l.weight, dashArray: l.dash || undefined, lineCap: "round", lineJoin: "round",
            }} />
          ))}

          {/* Manufacturer */}
          <Marker position={[data.manufacturer.lat, data.manufacturer.lon]} icon={manufacturerIcon()} eventHandlers={{ click: () => setFlyTo({ pos: [data.manufacturer.lat, data.manufacturer.lon], zoom: 7 }) }} />

          {/* Regions */}
          {showRegions && data.regions
            .filter((r) => selectedRegion === "all" || r.name === selectedRegion)
            .map((r) => (
              <Marker key={r.name} position={[r.lat, r.lon]} icon={regionIcon(r.distributors)} eventHandlers={{ click: () => onRegionClick(r) }} />
            ))}

          {/* Distributors */}
          {showDistributors && filteredDistributors.map((d) => (
            <Marker key={d.id} position={[d.lat, d.lon]} icon={distributorIcon(d.status, selectedDist === d.id)} eventHandlers={{ click: () => onDistributorClick(d) }} />
          ))}

          {/* Retailers (clustered) */}
          {showRetailers && (
            <MarkerClusterGroup chunkedLoading maxClusterRadius={55} spiderfyOnMaxZoom showCoverageOnHover={false}>
              {filteredRetailers.map((r) => (
                <Marker key={r.id} position={[r.lat, r.lon]} icon={retailerIcon(r.status, activeRetailer?.id === r.id)} eventHandlers={{ click: () => onRetailerClick(r) }} />
              ))}
            </MarkerClusterGroup>
          )}
        </MapContainer>

        {/* RIGHT FLOATING DETAIL PANEL */}
        {activeRetailer && (
          <RetailerDetailCard
            retailer={activeRetailer}
            detail={detail}
            loading={detailLoading}
            onClose={() => setActiveRetailer(null)}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Subcomponents
// ============================================================================
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 h-9 px-3 rounded-xl bg-slate-50 border border-slate-200/80">
      <Search className="h-3.5 w-3.5 text-slate-400" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search store, city, code…"
        className="flex-1 bg-transparent outline-none text-[12.5px] text-slate-700 placeholder:text-slate-400"
        data-testid="map-search-input"
      />
      {value && <button onClick={() => onChange("")} className="text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; testId?: string }) {
  return (
    <label className="block">
      <div className="text-[11px] text-slate-500 mb-1 font-medium">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="w-full h-9 px-3 rounded-xl bg-white border border-slate-200/80 text-[12.5px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300/60 transition"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

const CTX_OPTIONS: { id: ContextLayer; label: string; color: string }[] = [
  { id: "health", label: "Network Health", color: "#10b981" },
  { id: "density", label: "Retailer Density", color: "#4f46e5" },
  { id: "fulfillment", label: "Fulfillment Risk", color: "#dc2626" },
  { id: "shipment", label: "Shipment Activity", color: "#06b6d4" },
  { id: "velocity", label: "Sales Velocity", color: "#ea580c" },
];

function ContextLayerSelect({ value, onChange }: { value: ContextLayer; onChange: (v: ContextLayer) => void }) {
  const opt = CTX_OPTIONS.find((o) => o.id === value) || CTX_OPTIONS[0];
  return (
    <label className="block">
      <div className="text-[11px] text-slate-500 mb-1 font-medium">Context Layer</div>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full" style={{ background: opt.color }} />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as ContextLayer)}
          data-testid="map-filter-context"
          className="w-full h-9 pl-7 pr-3 rounded-xl bg-white border border-slate-200/80 text-[12.5px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300/60 transition appearance-none"
        >
          {CTX_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
    </label>
  );
}

function ContextDropdown({ value, onChange, open, onToggle }: { value: ContextLayer; onChange: (v: ContextLayer) => void; open: boolean; onToggle: () => void }) {
  const opt = CTX_OPTIONS.find((o) => o.id === value) || CTX_OPTIONS[0];
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="inline-flex items-center gap-2 h-9 pl-3 pr-2.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm text-[12.5px] font-medium text-slate-700 hover:text-slate-900 hover:shadow-md transition-all"
        data-testid="map-context-dropdown"
      >
        <Activity className="h-3.5 w-3.5" style={{ color: opt.color }} />
        {opt.label}
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 w-56 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-lg overflow-hidden">
          {CTX_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => { onChange(o.id); onToggle(); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-slate-50 transition ${value === o.id ? "bg-slate-50" : ""}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
              <span className="text-slate-700">{o.label}</span>
              {value === o.id && <span className="ml-auto text-[10px] text-indigo-600 font-semibold">ON</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LayerCheckbox({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (c: boolean) => void; testId?: string }) {
  return (
    <label className="flex items-center gap-2 py-1.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} className="h-3.5 w-3.5 rounded text-indigo-600 focus:ring-indigo-300" />
      <span className="text-[12.5px] text-slate-700">{label}</span>
    </label>
  );
}

function ViewToggle({ active, onSwitch }: { active: "radial" | "map"; onSwitch?: () => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-2xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm p-1" role="tablist" data-testid="map-view-toggle">
      <button
        onClick={onSwitch}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${active === "radial" ? "bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
        data-testid="map-switch-radial"
      >
        <NetworkIcon className="h-3.5 w-3.5" /> Radial View
      </button>
      <button
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold transition-all ${active === "map" ? "bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
        data-testid="map-switch-map"
      >
        <MapIcon className="h-3.5 w-3.5" /> Nigeria Map View
      </button>
    </div>
  );
}

function FloatBtn({ children, onClick, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      onClick={onClick}
      {...rest}
      className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm text-slate-700 hover:text-slate-900 hover:shadow-md transition-all"
    >{children}</button>
  );
}

function Chip({ accent, label, value }: { accent: string; label: string; value: number }) {
  return (
    <div className="inline-flex items-center gap-2 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-full px-3 py-1.5 shadow-sm">
      <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
      <span className="text-[11px] text-slate-500 font-medium">{label}</span>
      <span className="text-[12px] font-semibold text-slate-900">{value.toLocaleString()}</span>
    </div>
  );
}

function DrillChip({ zoom }: { zoom: number }) {
  const level = zoom <= 7 ? { label: "Regional view", color: COLOR.region } : zoom <= 10 ? { label: "Distributor view", color: COLOR.distributor } : { label: "Retailer view", color: COLOR.healthy };
  return (
    <div className="inline-flex items-center gap-1.5 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-full px-3 py-1.5 shadow-sm" data-testid="map-zoom-hint">
      <span className="h-2 w-2 rounded-full" style={{ background: level.color }} />
      <span className="text-[11px] text-slate-500 font-medium">Drill-down:</span>
      <span className="text-[12px] font-semibold text-slate-900">{level.label}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="space-y-1.5">
      <LegendRow color={COLOR.manufacturer} label="Manufacturer" shape="square" />
      <LegendRow color={COLOR.region} label="Region" shape="circle" />
      <LegendRow color={COLOR.distributor} label="Distributor" shape="ring" />
      <LegendRow color={COLOR.healthy} label="Retailer" shape="ring2" />
      <div className="h-px bg-slate-200/70 my-1" />
      <LegendRow color={COLOR.edgeRegion} label="Region → Distributor" shape="dashLine" />
      <LegendRow color={COLOR.edgeDistRet} label="Distributor → Retailer" shape="dashLine" />
      <div className="h-px bg-slate-200/70 my-1" />
      <LegendRow color={COLOR.healthy} label="Healthy" shape="dot" />
      <LegendRow color={COLOR.warning} label="Warning" shape="dot" />
      <LegendRow color={COLOR.critical} label="Critical" shape="dot" />
    </div>
  );
}

function LegendRow({ color, label, shape }: { color: string; label: string; shape: "dot" | "circle" | "square" | "ring" | "ring2" | "dashLine" }) {
  if (shape === "dashLine") {
    return (
      <div className="flex items-center gap-2">
        <svg width="20" height="6" viewBox="0 0 20 6">
          <line x1="0" y1="3" x2="20" y2="3" stroke={color} strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
        <span className="text-[11.5px] text-slate-600">{label}</span>
      </div>
    );
  }
  const cls =
    shape === "square" ? "h-3 w-3 rounded-[4px]" :
    shape === "circle" ? "h-3 w-3 rounded-full" :
    shape === "ring" ? "h-3 w-3 rounded-full ring-2 ring-white" :
    shape === "ring2" ? "h-3 w-3 rounded-full bg-white border-2" :
    "h-2 w-2 rounded-full";
  const style: React.CSSProperties = shape === "ring2"
    ? { borderColor: color }
    : { background: color, ...(shape === "ring" ? { boxShadow: "0 0 0 1px #cbd5e1" } : {}) };
  return (
    <div className="flex items-center gap-2">
      <span className={cls} style={style} />
      <span className="text-[11.5px] text-slate-600">{label}</span>
    </div>
  );
}

// ============================================================================
// Retailer Detail Card
// ============================================================================
type DetailTab = "overview" | "inventory" | "sales" | "shipments";

function RetailerDetailCard({ retailer, detail, loading, onClose }: { retailer: GeoRetailer; detail: RetailerDetail | null; loading: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>("overview");
  const status = retailer.status;
  const statusBg = status === "healthy" ? "bg-emerald-50 text-emerald-700" : status === "warning" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";

  return (
    <div className="absolute top-4 right-4 z-[600] w-[340px] max-h-[calc(100%-2rem)] flex flex-col bg-white/97 backdrop-blur-xl border border-slate-200/80 rounded-2xl shadow-[0_18px_50px_-12px_rgba(15,23,42,0.22)] overflow-hidden" data-testid="map-retailer-detail">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[15px] font-semibold text-slate-900 truncate" title={retailer.name}>{retailer.name}</div>
              <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${statusBg}`}>{status}</span>
            </div>
            <div className="text-[11.5px] text-slate-500 mt-1 flex items-center gap-1">
              {retailer.city ? `${retailer.city}, ` : ""}{retailer.region}
            </div>
            {detail?.distributor.name && (
              <div className="text-[11.5px] text-slate-500 mt-0.5">
                Distributor: <span className="text-indigo-600 font-medium">{detail.distributor.name}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close" data-testid="map-retailer-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-3 grid grid-cols-4 gap-1 bg-slate-50 rounded-xl p-1" role="tablist">
          {([
            { id: "overview", label: "Overview", icon: FileText },
            { id: "inventory", label: "Inventory", icon: Package },
            { id: "sales", label: "Sales", icon: BarChart3 },
            { id: "shipments", label: "Shipments", icon: Send },
          ] as { id: DetailTab; label: string; icon: React.ComponentType<any> }[]).map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                role="tab"
                aria-selected={active}
                data-testid={`map-detail-tab-${t.id}`}
                className={`inline-flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-lg text-[10.5px] font-semibold transition-all ${active ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading || !detail ? (
          <div className="py-8 text-center text-[12px] text-slate-400">Loading insights…</div>
        ) : (
          <>
            {tab === "overview" && <OverviewTab detail={detail} />}
            {tab === "inventory" && <InventoryTab detail={detail} />}
            {tab === "sales" && <SalesTab detail={detail} />}
            {tab === "shipments" && <ShipmentsTab detail={detail} />}
          </>
        )}
      </div>
    </div>
  );
}

function OverviewTab({ detail }: { detail: RetailerDetail }) {
  return (
    <div className="space-y-3">
      <InventoryHealthCard detail={detail} />
      <SalesCard detail={detail} />
      <PendingRequestsCard detail={detail} />
      <LastShipmentCard detail={detail} />
      <AIInsightCard detail={detail} />
    </div>
  );
}

function InventoryTab({ detail }: { detail: RetailerDetail }) {
  return (
    <div className="space-y-3">
      <InventoryHealthCard detail={detail} />
    </div>
  );
}
function SalesTab({ detail }: { detail: RetailerDetail }) {
  return (
    <div className="space-y-3">
      <SalesCard detail={detail} />
      <AIInsightCard detail={detail} />
    </div>
  );
}
function ShipmentsTab({ detail }: { detail: RetailerDetail }) {
  return (
    <div className="space-y-3">
      <LastShipmentCard detail={detail} />
      <PendingRequestsCard detail={detail} />
    </div>
  );
}

function InventoryHealthCard({ detail }: { detail: RetailerDetail }) {
  const pct = detail.inventory.health_pct;
  const color = pct >= 75 ? COLOR.healthy : pct >= 40 ? COLOR.warning : COLOR.critical;
  return (
    <div className="rounded-xl border border-slate-200/70 p-3">
      <div className="text-[12px] font-semibold text-slate-900 mb-2.5">Inventory Health</div>
      <div className="flex items-center gap-3">
        <Donut value={pct} color={color} />
        <div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-2">
          <Stat tone="emerald" label="In Stock" value={detail.inventory.in_stock} />
          <Stat tone="amber" label="Low Stock" value={detail.inventory.low_stock} />
          <Stat tone="rose" label="Out of Stock" value={detail.inventory.out_of_stock} />
        </div>
      </div>
    </div>
  );
}

function Donut({ value, color }: { value: number; color: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  return (
    <div className="relative h-[72px] w-[72px] flex-shrink-0">
      <svg viewBox="0 0 64 64" className="-rotate-90">
        <circle cx="32" cy="32" r={r} stroke="#f1f5f9" strokeWidth="7" fill="none" />
        <circle cx="32" cy="32" r={r} stroke={color} strokeWidth="7" fill="none" strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-[15px] font-bold text-slate-900 leading-none">{value}%</div>
        <div className="text-[9px] text-slate-400 mt-0.5">Healthy</div>
      </div>
    </div>
  );
}

function Stat({ tone, label, value }: { tone: "emerald" | "amber" | "rose"; label: string; value: number }) {
  const color = tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
  return (
    <div>
      <div className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</div>
      <div className={`text-[14px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function SalesCard({ detail }: { detail: RetailerDetail }) {
  return (
    <div className="rounded-xl border border-slate-200/70 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-slate-900">Sales (Last 7 Days)</div>
        <div className={`inline-flex items-center gap-1 text-[11.5px] font-semibold ${detail.sales.delta_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
          {detail.sales.delta_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {Math.abs(detail.sales.delta_pct)}%
        </div>
      </div>
      <div className="mt-1 text-[18px] font-bold text-slate-900">₦{detail.sales.revenue_7d.toLocaleString()}</div>
      <div className="text-[10.5px] text-slate-500">vs prev 7 days</div>
      <Sparkline data={detail.sales.trend} />
    </div>
  );
}

function Sparkline({ data }: { data: { date: string; revenue: number }[] }) {
  if (!data.length) return null;
  const W = 280, H = 40;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const min = Math.min(...data.map((d) => d.revenue));
  const range = max - min || 1;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((d.revenue - min) / range) * (H - 6) - 3;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="mt-2">
      <defs>
        <linearGradient id="spark2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(99,102,241,0.45)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0.02)" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke="rgb(79,70,229)" strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#spark2)" />
    </svg>
  );
}

function PendingRequestsCard({ detail }: { detail: RetailerDetail }) {
  return (
    <div className="rounded-xl border border-slate-200/70 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-slate-900">Pending Requests</div>
        <a className="text-[11.5px] text-indigo-600 hover:text-indigo-700 font-medium" href="#">View all</a>
      </div>
      <div className="mt-1 inline-flex items-center gap-2 text-[18px] font-bold text-slate-900">
        <FileText className="h-4 w-4 text-slate-400" />
        {detail.pending_requests}
      </div>
    </div>
  );
}

function LastShipmentCard({ detail }: { detail: RetailerDetail }) {
  const s = detail.last_shipment;
  const isTransit = s?.status === "in_transit";
  return (
    <div className="rounded-xl border border-slate-200/70 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-semibold text-slate-900">Last Shipment</div>
        <span className={`text-[10.5px] font-semibold ${isTransit ? "text-indigo-600" : "text-slate-500"}`}>
          {s ? s.status.replace("_", " ") : "—"}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-slate-500">
        <Truck className="h-3.5 w-3.5" />
        {s?.eta ? <span>ETA: {new Date(s.eta).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span> : <span>No active shipment</span>}
      </div>
    </div>
  );
}

function AIInsightCard({ detail }: { detail: RetailerDetail }) {
  return (
    <div className="rounded-xl bg-gradient-to-br from-indigo-50 via-indigo-50 to-purple-50 border border-indigo-100/80 p-3">
      <div className="inline-flex items-center gap-1.5 text-[11px] text-indigo-600 font-semibold">
        <Sparkles className="h-3.5 w-3.5" />
        AI Insight
      </div>
      <div className="mt-1.5 text-[12.5px] text-slate-700 leading-relaxed">{detail.ai_insight}</div>
    </div>
  );
}
