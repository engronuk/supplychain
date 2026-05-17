// NigeriaMapView.tsx
// Leaflet-based geographic visualization of the supply chain network.
// Manufacturer → Region clusters → Distributors → Retailers (clustered).
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
  Factory,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Truck,
  FileText,
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

// ---------------- Marker factories ----------------
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
    `<div style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:14px;background:linear-gradient(180deg,#6366f1,#4f46e5);color:#fff;box-shadow:0 8px 24px -8px rgba(79,70,229,0.55),0 0 0 4px rgba(255,255,255,0.9);">
       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/></svg>
     </div>`,
    44
  );
}

function regionIcon(count: number): L.DivIcon {
  return divIcon(
    `<div style="display:flex;align-items:center;justify-content:center;width:54px;height:54px;border-radius:50%;background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;font-weight:700;font-size:18px;font-family:ui-sans-serif,system-ui;box-shadow:0 8px 22px -8px rgba(37,99,235,0.55),0 0 0 5px rgba(219,234,254,0.9);">
       ${count}
     </div>`,
    54
  );
}

function distributorIcon(status: GeoStatus): L.DivIcon {
  const color = geoService.statusColor(status);
  return divIcon(
    `<div style="position:relative;width:22px;height:22px;">
       <div style="position:absolute;inset:0;border-radius:50%;background:#ffffff;box-shadow:0 6px 14px -6px rgba(15,23,42,0.35);"></div>
       <div style="position:absolute;inset:4px;border-radius:50%;background:${color};border:2px solid #ffffff;"></div>
     </div>`,
    22
  );
}

function retailerIcon(status: GeoStatus, selected: boolean): L.DivIcon {
  const color = geoService.statusColor(status);
  const size = selected ? 18 : 12;
  const ring = selected ? "0 0 0 4px rgba(99,102,241,0.35)," : "";
  return divIcon(
    `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #ffffff;box-shadow:${ring}0 4px 10px -4px rgba(15,23,42,0.35);"></div>`,
    size
  );
}

const NIGERIA_CENTER: [number, number] = [9.082, 8.6753];
const NIGERIA_BOUNDS: [[number, number], [number, number]] = [
  [3.0, 2.5],
  [14.5, 15.5],
];

// ---------------- Fly helpers ----------------
function FlyTo({ to, zoom = 9 }: { to: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (to) map.flyTo(to, zoom, { duration: 0.9 });
  }, [to, zoom, map]);
  return null;
}

// ---------------- Layer toggle types ----------------
type Layers = {
  regions: boolean;
  distributors: boolean;
  retailers: boolean;
  routes: boolean;
};

// ---------------- Main component ----------------
export default function NigeriaMapView({ manufacturerId }: { manufacturerId: string }) {
  const [data, setData] = useState<GeoNetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRegion, setSelectedRegion] = useState<string | "all">("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | GeoStatus>("all");
  const [selectedDist, setSelectedDist] = useState<string | "all">("all");

  const [search, setSearch] = useState("");
  const [layers, setLayers] = useState<Layers>({
    regions: true,
    distributors: true,
    retailers: true,
    routes: true,
  });

  const [activeRetailer, setActiveRetailer] = useState<GeoRetailer | null>(null);
  const [detail, setDetail] = useState<RetailerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [flyTo, setFlyTo] = useState<{ pos: [number, number]; zoom: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [openPanel, setOpenPanel] = useState<"none" | "layers">("none");

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
    return () => {
      cancelled = true;
    };
  }, [manufacturerId]);

  // Fetch retailer detail on selection
  useEffect(() => {
    if (!activeRetailer) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    geoService
      .getRetailer(activeRetailer.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [activeRetailer]);

  // Filter logic
  const filteredDistributors = useMemo<GeoDistributor[]>(() => {
    if (!data) return [];
    return data.distributors.filter(
      (d) =>
        (selectedRegion === "all" || d.region === selectedRegion) &&
        (selectedStatus === "all" || d.status === selectedStatus) &&
        (selectedDist === "all" || d.id === selectedDist) &&
        (!search ||
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.city.toLowerCase().includes(search.toLowerCase()))
    );
  }, [data, selectedRegion, selectedStatus, selectedDist, search]);

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

  // KPIs for sidebar
  const distributorList = useMemo(() => data?.distributors ?? [], [data]);

  // Region click → fly to centroid
  const onRegionClick = useCallback((r: GeoRegion) => {
    setSelectedRegion(r.name);
    setFlyTo({ pos: [r.lat, r.lon], zoom: 8 });
  }, []);

  // Distributor click → reveal retailers + fly
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
    setSelectedStatus("all");
    setSelectedDist("all");
    setSearch("");
  };

  const toggleFullscreen = async () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      try {
        await el.requestFullscreen();
        setFullscreen(true);
      } catch {
        /* noop */
      }
    } else {
      try {
        await document.exitFullscreen();
        setFullscreen(false);
      } catch {
        /* noop */
      }
    }
  };

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ---- Lines: manufacturer → distributor and distributor → retailer ----
  const routeLines = useMemo(() => {
    if (!data || !layers.routes) return null;
    const lines: { a: [number, number]; b: [number, number]; color: string; opacity: number; weight: number }[] = [];
    const mfg: [number, number] = [data.manufacturer.lat, data.manufacturer.lon];
    filteredDistributors.forEach((d) => {
      lines.push({
        a: mfg,
        b: [d.lat, d.lon],
        color: "#6366f1",
        opacity: 0.18,
        weight: 1.2,
      });
    });
    // distributor → retailer only when zoomed enough — we just always include
    // them when 1 distributor is filtered, to keep the line count manageable.
    if (selectedDist !== "all") {
      filteredRetailers.forEach((r) => {
        const dist = filteredDistributors.find((d) => d.id === r.distributor_id);
        if (!dist) return;
        lines.push({
          a: [dist.lat, dist.lon],
          b: [r.lat, r.lon],
          color: geoService.statusColor(r.status),
          opacity: 0.45,
          weight: 1.1,
        });
      });
    }
    return lines;
  }, [data, filteredDistributors, filteredRetailers, selectedDist, layers.routes]);

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-50">
        <div className="text-slate-500 text-sm">Loading Nigeria network map…</div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-slate-50">
        <div className="text-rose-600 text-sm">{error || "No data."}</div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full bg-white overflow-hidden"
      data-testid="nigeria-map-view"
    >
      {/* Left filter rail */}
      <aside
        className="absolute top-3 left-3 z-[500] w-[260px] bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-lg p-3 max-h-[calc(100%-1.5rem)] overflow-y-auto"
        data-testid="map-filter-rail"
      >
        <div className="flex items-center gap-2 mb-3">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search store, city, code…"
            className="flex-1 bg-transparent outline-none text-[13px] text-slate-700 placeholder:text-slate-400"
            data-testid="map-search-input"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-slate-400 hover:text-slate-600"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="h-px bg-slate-200/70 mb-3" />
        <SectionTitle title="Filters" right={
          <button
            onClick={clearFilters}
            className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium"
            data-testid="map-clear-filters"
          >
            Clear all
          </button>
        } />
        <FilterSelect
          label="Region"
          value={selectedRegion}
          onChange={setSelectedRegion}
          options={[
            { value: "all", label: "All Regions" },
            ...data.regions.map((r) => ({ value: r.name, label: `${r.name} (${r.retailers})` })),
          ]}
          testId="map-filter-region"
        />
        <FilterSelect
          label="Distributor"
          value={selectedDist}
          onChange={setSelectedDist}
          options={[
            { value: "all", label: "All Distributors" },
            ...distributorList
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
        <div className="h-px bg-slate-200/70 my-3" />
        <SectionTitle title="Legend" />
        <Legend />
      </aside>

      {/* Top-right controls */}
      <div className="absolute top-3 right-3 z-[500] flex items-center gap-2">
        <button
          onClick={() => setOpenPanel(openPanel === "layers" ? "none" : "layers")}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm text-[12px] font-medium text-slate-700 hover:text-slate-900 hover:shadow-md transition-shadow"
          data-testid="map-layers-toggle"
        >
          <Layers className="h-3.5 w-3.5" />
          Layers
        </button>
        <button
          onClick={toggleFullscreen}
          className="inline-flex items-center justify-center h-9 w-9 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200/80 shadow-sm text-slate-700 hover:text-slate-900 hover:shadow-md transition-shadow"
          aria-label="Toggle fullscreen"
          data-testid="map-fullscreen-toggle"
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {openPanel === "layers" && (
        <div
          className="absolute top-14 right-3 z-[500] w-56 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-lg p-3"
          data-testid="map-layers-panel"
        >
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 mb-2 font-medium">
            Map Layers
          </div>
          <LayerCheckbox
            label="Regions"
            checked={layers.regions}
            onChange={(c) => setLayers({ ...layers, regions: c })}
            testId="map-layer-regions"
          />
          <LayerCheckbox
            label="Distributors"
            checked={layers.distributors}
            onChange={(c) => setLayers({ ...layers, distributors: c })}
            testId="map-layer-distributors"
          />
          <LayerCheckbox
            label="Retailers"
            checked={layers.retailers}
            onChange={(c) => setLayers({ ...layers, retailers: c })}
            testId="map-layer-retailers"
          />
          <LayerCheckbox
            label="Connection routes"
            checked={layers.routes}
            onChange={(c) => setLayers({ ...layers, routes: c })}
            testId="map-layer-routes"
          />
        </div>
      )}

      {/* The map itself */}
      <MapContainer
        center={NIGERIA_CENTER}
        zoom={6}
        minZoom={5}
        maxZoom={17}
        scrollWheelZoom
        zoomControl={false}
        maxBounds={NIGERIA_BOUNDS}
        maxBoundsViscosity={0.6}
        className="absolute inset-0 z-0 bg-slate-50"
      >
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ZoomControl position="bottomright" />
        <FlyTo to={flyTo?.pos || null} zoom={flyTo?.zoom || 8} />

        {/* Connection routes */}
        {routeLines &&
          routeLines.map((l, i) => (
            <Polyline
              key={i}
              positions={[l.a, l.b]}
              pathOptions={{
                color: l.color,
                opacity: l.opacity,
                weight: l.weight,
                dashArray: "4 6",
              }}
            />
          ))}

        {/* Manufacturer marker */}
        <Marker
          position={[data.manufacturer.lat, data.manufacturer.lon]}
          icon={manufacturerIcon()}
          eventHandlers={{ click: () => setFlyTo({ pos: [data.manufacturer.lat, data.manufacturer.lon], zoom: 7 }) }}
        />

        {/* Region cluster markers (visual aggregates, not Leaflet clusters) */}
        {layers.regions &&
          data.regions
            .filter((r) => selectedRegion === "all" || r.name === selectedRegion)
            .map((r) => (
              <Marker
                key={r.name}
                position={[r.lat, r.lon]}
                icon={regionIcon(r.distributors)}
                eventHandlers={{ click: () => onRegionClick(r) }}
              />
            ))}

        {/* Distributor markers */}
        {layers.distributors &&
          filteredDistributors.map((d) => (
            <Marker
              key={d.id}
              position={[d.lat, d.lon]}
              icon={distributorIcon(d.status)}
              eventHandlers={{ click: () => onDistributorClick(d) }}
            />
          ))}

        {/* Retailer markers — clustered for performance */}
        {layers.retailers && (
          <MarkerClusterGroup
            chunkedLoading
            maxClusterRadius={45}
            spiderfyOnMaxZoom
            showCoverageOnHover={false}
          >
            {filteredRetailers.map((r) => (
              <Marker
                key={r.id}
                position={[r.lat, r.lon]}
                icon={retailerIcon(r.status, activeRetailer?.id === r.id)}
                eventHandlers={{ click: () => onRetailerClick(r) }}
              />
            ))}
          </MarkerClusterGroup>
        )}
      </MapContainer>

      {/* Bottom-left summary chips */}
      <div className="absolute bottom-3 left-3 z-[500] flex items-center gap-2">
        <SummaryChip label="Distributors" value={filteredDistributors.length} accent="#2563eb" />
        <SummaryChip label="Retailers" value={filteredRetailers.length} accent="#10b981" />
        <SummaryChip
          label="At risk"
          value={filteredRetailers.filter((r) => r.status !== "healthy").length}
          accent="#ef4444"
        />
      </div>

      {/* Retailer detail card */}
      {activeRetailer && (
        <RetailerDetailCard
          retailer={activeRetailer}
          detail={detail}
          loading={detailLoading}
          onClose={() => setActiveRetailer(null)}
        />
      )}
    </div>
  );
}

// ---------------- Subcomponents ----------------
function SectionTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 font-medium">{title}</div>
      {right}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  testId?: string;
}) {
  return (
    <label className="block mb-2.5">
      <div className="text-[11px] text-slate-500 mb-1 font-medium">{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="w-full h-9 px-3 rounded-xl bg-white border border-slate-200/80 text-[13px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-300/60 transition-shadow"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function LayerCheckbox({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (c: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-center gap-2 py-1.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="h-3.5 w-3.5 rounded text-indigo-600 focus:ring-indigo-300"
      />
      <span className="text-[12.5px] text-slate-700">{label}</span>
    </label>
  );
}

function SummaryChip({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="inline-flex items-center gap-2 bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-full px-3 py-1.5 shadow-sm">
      <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
      <span className="text-[11px] text-slate-500 font-medium">{label}</span>
      <span className="text-[12px] font-semibold text-slate-900">{value.toLocaleString()}</span>
    </div>
  );
}

function Legend() {
  return (
    <div className="space-y-1.5">
      <LegendRow color="#6366f1" label="Manufacturer" shape="square" />
      <LegendRow color="#3b82f6" label="Region" shape="circle" />
      <LegendRow color="#10b981" label="Retailer · Healthy" shape="dot" />
      <LegendRow color="#f59e0b" label="Retailer · Warning" shape="dot" />
      <LegendRow color="#ef4444" label="Retailer · Critical" shape="dot" />
    </div>
  );
}

function LegendRow({ color, label, shape }: { color: string; label: string; shape: "dot" | "circle" | "square" }) {
  const cls =
    shape === "square"
      ? "h-3 w-3 rounded-[4px]"
      : shape === "circle"
      ? "h-3 w-3 rounded-full border-2 border-white shadow"
      : "h-2 w-2 rounded-full";
  return (
    <div className="flex items-center gap-2">
      <span className={cls} style={{ background: color }} />
      <span className="text-[11.5px] text-slate-600">{label}</span>
    </div>
  );
}

// ---------------- Retailer Detail Card ----------------
function RetailerDetailCard({
  retailer,
  detail,
  loading,
  onClose,
}: {
  retailer: GeoRetailer;
  detail: RetailerDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const status = retailer.status;
  const statusBg =
    status === "healthy" ? "bg-emerald-50 text-emerald-700" : status === "warning" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700";

  return (
    <div
      className="absolute top-3 right-3 z-[600] w-[340px] bg-white/97 backdrop-blur-xl border border-slate-200/80 rounded-2xl shadow-[0_18px_50px_-12px_rgba(15,23,42,0.22)] overflow-hidden"
      data-testid="map-retailer-detail"
    >
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14.5px] font-semibold text-slate-900 truncate" title={retailer.name}>
              {retailer.name}
            </div>
            <div className="text-[11.5px] text-slate-500 mt-0.5 truncate">
              {retailer.city ? `${retailer.city}, ` : ""}{retailer.region}
            </div>
          </div>
          <span className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full ${statusBg}`}>
            {status}
          </span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 ml-1" aria-label="Close" data-testid="map-retailer-close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {detail && detail.distributor.name && (
          <div className="mt-2 text-[11.5px] text-slate-500">
            Distributor: <span className="text-indigo-600 font-medium">{detail.distributor.name}</span>
          </div>
        )}

        {loading || !detail ? (
          <div className="py-8 text-center text-[12px] text-slate-400">Loading insights…</div>
        ) : (
          <>
            <div className="mt-3 rounded-xl border border-slate-200/70 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Inventory health</div>
                <div className="text-[12px] font-semibold text-slate-900">{detail.inventory.health_pct}%</div>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${detail.inventory.health_pct}%`,
                    background:
                      detail.inventory.health_pct >= 75
                        ? "#10b981"
                        : detail.inventory.health_pct >= 40
                        ? "#f59e0b"
                        : "#ef4444",
                  }}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <Stat tone="emerald" label="In stock" value={detail.inventory.in_stock} />
                <Stat tone="amber" label="Low stock" value={detail.inventory.low_stock} />
                <Stat tone="rose" label="Out" value={detail.inventory.out_of_stock} />
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-slate-200/70 p-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Sales · 7 days</div>
                <div className={`inline-flex items-center gap-1 text-[11.5px] font-semibold ${detail.sales.delta_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {detail.sales.delta_pct >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {Math.abs(detail.sales.delta_pct)}%
                </div>
              </div>
              <div className="mt-1 text-[16px] font-semibold text-slate-900">
                ₦{detail.sales.revenue_7d.toLocaleString()}
              </div>
              <Sparkline data={detail.sales.trend} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniStat
                icon={<FileText className="h-3.5 w-3.5" />}
                label="Pending requests"
                value={detail.pending_requests}
                tone={detail.pending_requests > 0 ? "amber" : "slate"}
              />
              <MiniStat
                icon={<Truck className="h-3.5 w-3.5" />}
                label="Last shipment"
                value={detail.last_shipment ? detail.last_shipment.status.replace("_", " ") : "—"}
                tone="slate"
              />
            </div>

            <div className="mt-3 rounded-xl bg-gradient-to-br from-indigo-50 via-indigo-50 to-purple-50 border border-indigo-100/80 p-3">
              <div className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">
                <Sparkles className="h-3 w-3" />
                AI Insight
              </div>
              <div className="mt-1 text-[12.5px] text-slate-700 leading-relaxed">
                {detail.ai_insight}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ tone, label, value }: { tone: "emerald" | "amber" | "rose"; label: string; value: number }) {
  const color =
    tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700";
  return (
    <div>
      <div className={`text-[15px] font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: "amber" | "slate";
}) {
  const tag =
    tone === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200/60"
      : "bg-slate-50 text-slate-700 border-slate-200/60";
  return (
    <div className={`rounded-xl border ${tag} px-3 py-2`}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider opacity-80">
        {icon}
        {label}
      </div>
      <div className="text-[13px] font-semibold mt-0.5 capitalize">{value}</div>
    </div>
  );
}

function Sparkline({ data }: { data: { date: string; revenue: number }[] }) {
  if (!data.length) return null;
  const W = 280;
  const H = 36;
  const max = Math.max(...data.map((d) => d.revenue), 1);
  const min = Math.min(...data.map((d) => d.revenue));
  const range = max - min || 1;
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - ((d.revenue - min) / range) * (H - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="mt-2 overflow-visible">
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(99,102,241,0.45)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0.02)" />
        </linearGradient>
      </defs>
      <polyline
        points={pts}
        fill="none"
        stroke="rgb(79,70,229)"
        strokeWidth={1.8}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <polygon
        points={`0,${H} ${pts} ${W},${H}`}
        fill="url(#spark)"
      />
    </svg>
  );
}
