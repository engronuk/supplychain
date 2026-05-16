// ManufacturerNetworkView.tsx
// Page wrapper that hosts the radial hierarchy canvas with a tooltip,
// breadcrumb of the active focus path, and a legend.
import React, { useState } from "react";
import { useSession } from "@/context/SessionContext";
import RadialHierarchyCanvas, {
  CanvasNode,
} from "@/components/RadialHierarchyCanvas";
import {
  Factory,
  Globe2,
  MapPin,
  Warehouse,
  Store,
  AlertTriangle,
  TrendingUp,
  Boxes,
} from "lucide-react";

type HoverInfo = { node: CanvasNode; clientX: number; clientY: number };

const TYPE_ICON: Record<string, React.ComponentType<any>> = {
  manufacturer: Factory,
  region: Globe2,
  state: MapPin,
  distributor: Warehouse,
  retailer: Store,
};

const TYPE_LABEL: Record<string, string> = {
  manufacturer: "Manufacturer",
  region: "Region",
  state: "State / City",
  distributor: "Distributor",
  retailer: "Retailer",
};

export default function ManufacturerNetworkView() {
  const { session } = useSession();
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [path, setPath] = useState<CanvasNode[]>([]);

  if (session.role !== "manufacturer") {
    return (
      <div className="p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 text-sm">
          The Network Map is available for manufacturer accounts.
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col" data-testid="manufacturer-network-view">
      {/* Header strip */}
      <div className="px-6 py-3 bg-[#070b14] text-slate-200 border-b border-slate-800 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Network Intelligence</div>
          <div className="text-base font-semibold tracking-tight">Radial Hierarchy · {session.entity.name}</div>
        </div>
        <Breadcrumb path={path} />
        <Legend />
      </div>

      {/* Canvas + tooltip overlay */}
      <div className="relative flex-1 min-h-0">
        <RadialHierarchyCanvas
          manufacturerId={session.entity.id}
          onHover={setHover}
          onFocusPathChange={setPath}
        />
        {hover && <NodeTooltip info={hover} />}
        <HintFooter />
      </div>
    </div>
  );
}

function Breadcrumb({ path }: { path: CanvasNode[] }) {
  if (!path.length) return <div />;
  return (
    <div className="hidden md:flex items-center gap-1.5 text-xs text-slate-400 max-w-[40%] truncate" data-testid="hierarchy-breadcrumb">
      {path.map((n, i) => {
        const Icon = TYPE_ICON[n.data.type] || Globe2;
        const last = i === path.length - 1;
        return (
          <React.Fragment key={n.id}>
            {i > 0 && <span className="text-slate-600">/</span>}
            <span className={`inline-flex items-center gap-1 ${last ? "text-white font-medium" : ""}`}>
              <Icon className="h-3 w-3 opacity-70" />
              <span className="truncate max-w-[120px]">{n.data.name}</span>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="hidden lg:flex items-center gap-4 text-xs text-slate-400" data-testid="hierarchy-legend">
      <LegendDot color="#10b981" label="Healthy" />
      <LegendDot color="#f59e0b" label="Warning" />
      <LegendDot color="#ef4444" label="Critical" />
    </div>
  );
}
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}

function HintFooter() {
  return (
    <div className="absolute bottom-4 left-4 text-[11px] text-slate-500 z-10 pointer-events-none">
      Click a node to expand · drag to pan · scroll to zoom
    </div>
  );
}

function NodeTooltip({ info }: { info: HoverInfo }) {
  const { node, clientX, clientY } = info;
  const d = node.data;
  const Icon = TYPE_ICON[d.type] || Globe2;
  // Position tooltip relative to viewport using fixed positioning
  const style: React.CSSProperties = {
    position: "fixed",
    left: clientX + 16,
    top: clientY + 16,
    zIndex: 50,
    pointerEvents: "none",
    maxWidth: 280,
  };

  const statusBadge = (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
      style={{
        background: d.status === "healthy" ? "rgba(16,185,129,0.15)" :
                    d.status === "warning" ? "rgba(245,158,11,0.18)" :
                                              "rgba(239,68,68,0.18)",
        color: d.status === "healthy" ? "#34d399" :
               d.status === "warning" ? "#fbbf24" : "#fca5a5",
      }}
    >
      {d.status}
    </span>
  );

  return (
    <div
      style={style}
      className="rounded-xl border border-slate-700/70 bg-slate-900/95 backdrop-blur-md shadow-2xl text-slate-100 p-3.5"
      data-testid="hierarchy-tooltip"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
            <Icon className="h-3 w-3" />
            {TYPE_LABEL[d.type]}
          </div>
          <div className="font-semibold text-sm leading-tight truncate" title={d.name}>{d.name}</div>
        </div>
        {statusBadge}
      </div>

      {/* Common summary */}
      {d.type === "distributor" ? (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Stat icon={<Store className="h-3 w-3" />} label="Retailers" value={d.summary?.total_retailers ?? 0} />
          <Stat icon={<AlertTriangle className="h-3 w-3" />} label="Low-stock retailers" value={d.summary?.low_stock_retailers ?? 0} tone={d.summary?.low_stock_retailers ? "warn" : undefined} />
          <Stat icon={<TrendingUp className="h-3 w-3" />} label="Active shipments" value={d.summary?.shipment_activity ?? 0} />
          <Stat icon={<Boxes className="h-3 w-3" />} label="Alerts" value={d.alerts} tone={d.alerts ? "warn" : undefined} />
          <div className="col-span-2 text-[10px] text-slate-500 mt-1">
            {d.summary?.region}{d.summary?.city ? ` · ${d.summary.city}` : ""}
          </div>
        </div>
      ) : d.type === "retailer" ? (
        <div className="grid grid-cols-1 gap-1.5 mt-2">
          <Stat icon={<Boxes className="h-3 w-3" />} label="Low-stock SKUs" value={d.summary?.low_stock_skus ?? 0} tone={d.summary?.low_stock_skus ? "warn" : undefined} />
          <div className="text-[10px] text-slate-500">
            {d.summary?.region}{d.summary?.city ? ` · ${d.summary.city}` : ""}
          </div>
          {d.summary?.address && (
            <div className="text-[10px] text-slate-500 truncate" title={d.summary.address}>{d.summary.address}</div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 mt-2">
          {Object.entries(d.summary || {}).slice(0, 6).map(([k, v]) => (
            <Stat key={k} label={k.replace(/_/g, " ")} value={v as number | string} />
          ))}
          <Stat icon={<AlertTriangle className="h-3 w-3" />} label="Alerts" value={d.alerts} tone={d.alerts ? "warn" : undefined} />
        </div>
      )}

      <div className="mt-2.5 pt-2 border-t border-slate-700/60 text-[10px] text-slate-500">
        {d.has_children ? "Click to expand →" : "Leaf node"}
      </div>
    </div>
  );
}

function Stat({
  icon, label, value, tone,
}: { icon?: React.ReactNode; label: string; value: React.ReactNode; tone?: "warn" | "critical" }) {
  const toneCls = tone === "warn" ? "text-amber-300" : tone === "critical" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="bg-slate-800/60 rounded-md px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-400 flex items-center gap-1 capitalize">
        {icon}{label}
      </div>
      <div className={`text-sm font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}
