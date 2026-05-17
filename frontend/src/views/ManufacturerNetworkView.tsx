// ManufacturerNetworkView.tsx
// Premium light-mode enterprise hierarchy view (Linear/Stripe/Palantir feel).
import React, { useLayoutEffect, useRef, useState } from "react";
import { useSession } from "@/context/SessionContext";
import RadialHierarchyCanvas, {
  CanvasNode,
  NetworkMode,
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
  HeartPulse,
  Layers,
  Truck,
  Zap,
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

type ModeDef = {
  id: NetworkMode;
  label: string;
  short: string;
  icon: React.ComponentType<any>;
  accent: string;       // hex accent color
  description: string;
};

const MODES: ModeDef[] = [
  { id: "health",      label: "Health",            short: "Health",     icon: HeartPulse,    accent: "#10b981", description: "Inventory health · low-stock risk · critical pulse" },
  { id: "density",     label: "Retailer Density",  short: "Density",    icon: Layers,        accent: "#4338ca", description: "Retailer concentration heat — size & color scale with footprint" },
  { id: "fulfillment", label: "Fulfillment Risk",  short: "Risk",       icon: AlertTriangle, accent: "#dc2626", description: "Unfulfilled stock requests · % of retailers low on stock" },
  { id: "shipment",    label: "Shipment Activity", short: "Activity",   icon: Truck,         accent: "#06b6d4", description: "Active distribution traffic with animated route trails" },
  { id: "velocity",    label: "Sales Velocity",    short: "Velocity",   icon: Zap,           accent: "#ea580c", description: "Demand hotspots · fast-moving regions" },
];

export default function ManufacturerNetworkView() {
  const { session } = useSession();
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [path, setPath] = useState<CanvasNode[]>([]);
  const [mode, setMode] = useState<NetworkMode>("health");

  if (session.role !== "manufacturer") {
    return (
      <div className="p-8">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-900 text-sm">
          The Network Map is available for manufacturer accounts.
        </div>
      </div>
    );
  }

  const activeMode = MODES.find((m) => m.id === mode) || MODES[0];

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
      <div className="px-6 pt-5 pb-2 flex items-center justify-between gap-6 z-20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-white/70 backdrop-blur-md border border-slate-200/80 shadow-sm flex items-center justify-center">
            <Factory className="h-4 w-4 text-slate-700" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-slate-500 font-medium">
              Network Intelligence
            </div>
            <div className="text-[15px] font-semibold tracking-tight text-slate-900 truncate">
              {session.entity.name} · Radial Hierarchy
            </div>
          </div>
        </div>

        <Breadcrumb path={path} />
        <Legend mode={mode} />
      </div>

      {/* Context Intelligence — segmented switcher */}
      <div className="px-6 pb-3 z-20 flex items-center justify-between gap-4">
        <ContextSwitcher mode={mode} onChange={setMode} />
        <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-500 max-w-[40%] truncate">
          <activeMode.icon className="h-3.5 w-3.5" style={{ color: activeMode.accent }} />
          <span className="truncate">{activeMode.description}</span>
        </div>
      </div>

      {/* Canvas surface */}
      <div className="relative flex-1 min-h-0">
        <RadialHierarchyCanvas
          manufacturerId={session.entity.id}
          mode={mode}
          onHover={setHover}
          onFocusPathChange={setPath}
        />
        {hover && <NodeTooltip info={hover} mode={mode} />}
        <HintFooter />
      </div>
    </div>
  );
}

// -------------- Segmented Context Switcher --------------
function ContextSwitcher({
  mode,
  onChange,
}: {
  mode: NetworkMode;
  onChange: (m: NetworkMode) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number; accent: string }>({
    left: 0,
    width: 0,
    accent: MODES[0].accent,
  });

  useLayoutEffect(() => {
    const btn = btnRefs.current[mode];
    const parent = containerRef.current;
    if (!btn || !parent) return;
    const pRect = parent.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    const def = MODES.find((m) => m.id === mode);
    setIndicator({
      left: bRect.left - pRect.left,
      width: bRect.width,
      accent: def?.accent || "#0f172a",
    });
  }, [mode]);

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Network visualization context"
      className="relative inline-flex items-center gap-0.5 rounded-2xl bg-white/70 backdrop-blur-md border border-slate-200/80 shadow-sm p-1"
      data-testid="network-mode-switcher"
    >
      {/* Animated sliding indicator */}
      <span
        className="absolute top-1 bottom-1 rounded-xl pointer-events-none transition-all duration-[420ms]"
        style={{
          left: indicator.left,
          width: indicator.width,
          transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
          background:
            `linear-gradient(180deg, ${indicator.accent}1c, ${indicator.accent}0a)`,
          boxShadow: `inset 0 0 0 1px ${indicator.accent}44, 0 2px 8px -2px ${indicator.accent}33`,
        }}
        aria-hidden
      />
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = m.id === mode;
        return (
          <button
            key={m.id}
            ref={(el) => { btnRefs.current[m.id] = el; }}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(m.id)}
            data-testid={`network-mode-${m.id}`}
            className={`relative z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium tracking-tight transition-colors duration-200 ${
              active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"
            }`}
            style={active ? { color: m.accent } : undefined}
          >
            <Icon
              className="h-3.5 w-3.5"
              style={{ color: active ? m.accent : "currentColor" }}
            />
            <span className="hidden sm:inline">{m.label}</span>
            <span className="sm:hidden">{m.short}</span>
          </button>
        );
      })}
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

function Legend({ mode }: { mode: NetworkMode }) {
  // Mode-specific legend entries
  type LegEntry = { color: string; label: string };
  const entries: LegEntry[] =
    mode === "health"
      ? [
          { color: STATUS_TONE.healthy.dot, label: "Healthy" },
          { color: STATUS_TONE.warning.dot, label: "Warning" },
          { color: STATUS_TONE.critical.dot, label: "Critical" },
        ]
      : mode === "density"
      ? [
          { color: "#dbeafe", label: "Sparse" },
          { color: "#818cf8", label: "Mid" },
          { color: "#4338ca", label: "Dense" },
        ]
      : mode === "fulfillment"
      ? [
          { color: "#e2e8f0", label: "Stable" },
          { color: "#f59e0b", label: "At risk" },
          { color: "#dc2626", label: "Critical" },
        ]
      : mode === "shipment"
      ? [
          { color: "#cbd5e1", label: "Quiet" },
          { color: "#06b6d4", label: "Active" },
        ]
      : [
          { color: "#fde68a", label: "Slow" },
          { color: "#f97316", label: "Hot" },
          { color: "#dc2626", label: "Hotspot" },
        ];

  return (
    <div
      className="hidden lg:flex items-center gap-4 text-[11px] text-slate-600 bg-white/65 backdrop-blur-md border border-slate-200/70 rounded-full px-3.5 py-1.5 shadow-sm"
      data-testid="hierarchy-legend"
    >
      {entries.map((e, i) => (
        <React.Fragment key={e.label}>
          {i > 0 && <span className="h-3 w-px bg-slate-200" />}
          <LegendDot color={e.color} label={e.label} />
        </React.Fragment>
      ))}
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

function NodeTooltip({ info, mode }: { info: HoverInfo; mode: NetworkMode }) {
  const { node, clientX, clientY } = info;
  const d = node.data;
  const Icon = TYPE_ICON[d.type] || Globe2;
  const tone = STATUS_TONE[d.status] || STATUS_TONE.healthy;
  const modeDef = MODES.find((m) => m.id === mode) || MODES[0];

  // Mode-specific contextual metric
  const s: any = d.summary || {};
  const totalRet = Number(s.total_retailers ?? s.retailers ?? 0);
  const lowRet = Number(s.low_stock_retailers ?? 0);
  const ship = Number(s.shipment_activity ?? 0);
  const contextValue =
    mode === "density"
      ? `${totalRet} retailers`
      : mode === "fulfillment"
      ? totalRet > 0
        ? `${lowRet} / ${totalRet} at risk`
        : `${d.alerts} alerts`
      : mode === "shipment"
      ? `${ship} active shipments`
      : mode === "velocity"
      ? `Demand index · ${Math.round(totalRet * (1 - (totalRet > 0 ? lowRet / totalRet : 0)))}`
      : null;

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

      {/* Mode context strip */}
      {contextValue && (
        <div
          className="mb-3 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg"
          style={{
            background: `linear-gradient(180deg, ${modeDef.accent}12, ${modeDef.accent}04)`,
            color: modeDef.accent,
            boxShadow: `inset 0 0 0 1px ${modeDef.accent}26`,
          }}
        >
          <modeDef.icon className="h-3 w-3" />
          <span className="uppercase tracking-wider text-[10px] opacity-70">{modeDef.short}</span>
          <span className="ml-auto text-slate-900 font-semibold">{contextValue}</span>
        </div>
      )}

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
