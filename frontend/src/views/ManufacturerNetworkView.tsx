// ManufacturerNetworkView.tsx
// Premium light-mode enterprise hierarchy view (Linear/Stripe/Palantir feel).
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
  ChevronRight,
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

const STATUS_TONE: Record<string, { fg: string; bg: string; dot: string }> = {
  healthy:  { fg: "#047857", bg: "rgba(16, 185, 129, 0.10)", dot: "#10b981" },
  warning:  { fg: "#b45309", bg: "rgba(245, 158, 11, 0.12)", dot: "#f59e0b" },
  critical: { fg: "#b91c1c", bg: "rgba(239, 68, 68, 0.10)",  dot: "#ef4444" },
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
    <div
      className="h-[calc(100vh-64px)] flex flex-col relative"
      style={{
        background:
          "radial-gradient(120% 80% at 50% 0%, #ffffff 0%, #f8fafc 45%, #eef2f7 100%)",
      }}
      data-testid="manufacturer-network-view"
    >
      {/* Header — floating glass panel */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between gap-6 z-20">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-white/70 backdrop-blur-md border border-slate-200/80 shadow-sm flex items-center justify-center">
            <Factory className="h-4 w-4 text-slate-700" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 font-medium">
              Network Intelligence
            </div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-900">
              {session.entity.name} · Radial Hierarchy
            </div>
          </div>
        </div>

        <Breadcrumb path={path} />
        <Legend />
      </div>

      {/* Canvas surface */}
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
    <div
      className="hidden md:flex items-center gap-1 text-[12px] text-slate-500 max-w-[50%] truncate bg-white/65 backdrop-blur-md border border-slate-200/70 rounded-full px-3 py-1.5 shadow-sm"
      data-testid="hierarchy-breadcrumb"
    >
      {path.map((n, i) => {
        const Icon = TYPE_ICON[n.data.type] || Globe2;
        const last = i === path.length - 1;
        return (
          <React.Fragment key={n.id}>
            {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 mx-0.5 flex-shrink-0" />}
            <span
              className={`inline-flex items-center gap-1 ${
                last ? "text-slate-900 font-semibold" : "text-slate-500"
              }`}
            >
              <Icon className={`h-3 w-3 ${last ? "text-slate-700" : "text-slate-400"}`} />
              <span className="truncate max-w-[140px]">{n.data.name}</span>
            </span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div
      className="hidden lg:flex items-center gap-4 text-[11px] text-slate-600 bg-white/65 backdrop-blur-md border border-slate-200/70 rounded-full px-3.5 py-1.5 shadow-sm"
      data-testid="hierarchy-legend"
    >
      <LegendDot color={STATUS_TONE.healthy.dot} label="Healthy" />
      <span className="h-3 w-px bg-slate-200" />
      <LegendDot color={STATUS_TONE.warning.dot} label="Warning" />
      <span className="h-3 w-px bg-slate-200" />
      <LegendDot color={STATUS_TONE.critical.dot} label="Critical" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-2 w-2 rounded-full ring-2"
        style={{ background: color, boxShadow: `0 0 0 3px ${color}22` }}
      />
      <span className="font-medium tracking-wide">{label}</span>
    </span>
  );
}

function HintFooter() {
  return (
    <div className="absolute bottom-5 left-6 text-[11px] z-10 pointer-events-none">
      <div className="inline-flex items-center gap-3 text-slate-500 bg-white/55 backdrop-blur-md border border-slate-200/70 rounded-full px-3 py-1.5 shadow-sm">
        <span><kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">click</kbd> expand</span>
        <span><kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">drag</kbd> pan</span>
        <span><kbd className="px-1 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">scroll</kbd> zoom</span>
      </div>
    </div>
  );
}

function NodeTooltip({ info }: { info: HoverInfo }) {
  const { node, clientX, clientY } = info;
  const d = node.data;
  const Icon = TYPE_ICON[d.type] || Globe2;
  const tone = STATUS_TONE[d.status] || STATUS_TONE.healthy;

  // Smart placement: flip side if near right edge
  const flipRight = clientX > window.innerWidth - 320;
  const style: React.CSSProperties = {
    position: "fixed",
    left: flipRight ? clientX - 304 : clientX + 18,
    top: clientY + 16,
    zIndex: 50,
    pointerEvents: "none",
    width: 288,
  };

  return (
    <div
      style={style}
      className="rounded-2xl border border-slate-200/80 bg-white/95 backdrop-blur-xl text-slate-800 p-4 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.18)]"
      data-testid="hierarchy-tooltip"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400 flex items-center gap-1.5 font-medium">
            <Icon className="h-3 w-3" />
            {TYPE_LABEL[d.type]}
          </div>
          <div
            className="font-semibold text-[15px] leading-tight text-slate-900 truncate mt-1"
            title={d.name}
          >
            {d.name}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider flex-shrink-0"
          style={{ background: tone.bg, color: tone.fg }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: tone.dot }}
          />
          {d.status}
        </span>
      </div>

      {/* Body */}
      {d.type === "distributor" ? (
        <div className="grid grid-cols-2 gap-2">
          <Stat
            icon={<Store className="h-3 w-3" />}
            label="Retailers"
            value={d.summary?.total_retailers ?? 0}
          />
          <Stat
            icon={<AlertTriangle className="h-3 w-3" />}
            label="Low-stock retailers"
            value={d.summary?.low_stock_retailers ?? 0}
            tone={d.summary?.low_stock_retailers ? "warn" : undefined}
          />
          <Stat
            icon={<TrendingUp className="h-3 w-3" />}
            label="Active shipments"
            value={d.summary?.shipment_activity ?? 0}
          />
          <Stat
            icon={<Boxes className="h-3 w-3" />}
            label="Alerts"
            value={d.alerts}
            tone={d.alerts ? "warn" : undefined}
          />
          {(d.summary?.region || d.summary?.city) && (
            <div className="col-span-2 text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {d.summary?.region}
              {d.summary?.city ? ` · ${d.summary.city}` : ""}
            </div>
          )}
        </div>
      ) : d.type === "retailer" ? (
        <div className="space-y-2">
          <Stat
            icon={<Boxes className="h-3 w-3" />}
            label="Low-stock SKUs"
            value={d.summary?.low_stock_skus ?? 0}
            tone={d.summary?.low_stock_skus ? "warn" : undefined}
          />
          {(d.summary?.region || d.summary?.city) && (
            <div className="text-[11px] text-slate-500 flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {d.summary?.region}
              {d.summary?.city ? ` · ${d.summary.city}` : ""}
            </div>
          )}
          {d.summary?.address && (
            <div
              className="text-[11px] text-slate-500 truncate"
              title={d.summary.address}
            >
              {d.summary.address}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(d.summary || {})
            .slice(0, 6)
            .map(([k, v]) => (
              <Stat key={k} label={k.replace(/_/g, " ")} value={v as number | string} />
            ))}
          <Stat
            icon={<AlertTriangle className="h-3 w-3" />}
            label="Alerts"
            value={d.alerts}
            tone={d.alerts ? "warn" : undefined}
          />
        </div>
      )}

      <div className="mt-3 pt-2.5 border-t border-slate-200/80 text-[11px] text-slate-500 flex items-center justify-between">
        <span>
          {d.has_children ? "Click to expand" : "Leaf node"}
        </span>
        {d.has_children && <ChevronRight className="h-3 w-3" />}
      </div>
    </div>
  );
}

function Stat({
  icon, label, value, tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: "warn" | "critical";
}) {
  const valTone =
    tone === "warn"
      ? "text-amber-700"
      : tone === "critical"
      ? "text-rose-700"
      : "text-slate-900";
  return (
    <div className="bg-slate-50/80 border border-slate-200/60 rounded-lg px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center gap-1 capitalize font-medium">
        {icon}
        {label}
      </div>
      <div className={`text-[15px] font-semibold mt-0.5 ${valTone}`}>{value}</div>
    </div>
  );
}
