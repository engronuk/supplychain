// Live throughput strip for the manufacturer dashboard — polls
// /manufacturer/{id}/activity-pulse every 60s and renders an animated row
// of mini-cards (Orders Placed · Shipments Moving · POs Approved · Sales Logged)
// each with a 12-bucket sparkline and a soft pulse ring.
import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDownRight, ArrowUpRight, PackageCheck, ShoppingCart, Truck, Receipt } from "lucide-react";
import { Api } from "../lib/api";

const POLL_MS = 60_000;

const METRIC_META = [
  { key: "orders_placed",     label: "Orders Placed",     Icon: ShoppingCart, tone: "violet" },
  { key: "shipments_moving",  label: "Shipments Moving",  Icon: Truck,        tone: "amber"  },
  { key: "pos_approved",      label: "POs Approved",      Icon: PackageCheck, tone: "emerald"},
  { key: "sales_logged",      label: "Sales Logged",      Icon: Receipt,      tone: "blue"   },
];

const TONE = {
  violet:  { ring: "ring-violet-200/60",  text: "text-violet-700",  fill: "fill-violet-500",  iconBg: "bg-violet-50",  iconFg: "text-violet-600" },
  amber:   { ring: "ring-amber-200/60",   text: "text-amber-700",   fill: "fill-amber-500",   iconBg: "bg-amber-50",   iconFg: "text-amber-600" },
  emerald: { ring: "ring-emerald-200/60", text: "text-emerald-700", fill: "fill-emerald-500", iconBg: "bg-emerald-50", iconFg: "text-emerald-600" },
  blue:    { ring: "ring-sky-200/60",     text: "text-sky-700",     fill: "fill-sky-500",     iconBg: "bg-sky-50",     iconFg: "text-sky-600" },
};

export default function ActivityPulse({ manufacturerId }) {
  const [data, setData] = useState(null);
  const [tickAt, setTickAt] = useState(null);
  const prevCounts = useRef({});

  useEffect(() => {
    if (!manufacturerId) return undefined;
    let cancelled = false;
    const load = () => {
      Api.manufacturerActivityPulse(manufacturerId)
        .then((d) => {
          if (cancelled) return;
          setData(d);
          setTickAt(new Date());
          prevCounts.current = Object.fromEntries(
            Object.entries(d.metrics || {}).map(([k, v]) => [k, v.current]),
          );
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [manufacturerId]);

  if (!data) return null;
  const m = data.metrics || {};

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-sm" data-testid="activity-pulse">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="relative inline-flex h-2 w-2">
            <span className="absolute inset-0 inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <Activity className="h-4 w-4 text-slate-500" />
          <div>
            <div className="text-sm font-semibold text-slate-900">Activity Pulse</div>
            <div className="text-[11px] text-slate-500">
              Last {data.window_minutes}m · {tickAt ? `updated ${timeAgo(tickAt)}` : "syncing…"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {METRIC_META.map(({ key, label, Icon, tone }) => {
          const v = m[key] || { current: 0, delta_pct: 0, sparkline: [], rate_per_min: 0 };
          const t = TONE[tone];
          const justBumped = (prevCounts.current[key] ?? null) !== null && v.current > (prevCounts.current[key] ?? 0);
          return (
            <div
              key={key}
              className={`relative rounded-xl bg-white ring-1 ${t.ring} px-3 py-2.5 overflow-hidden transition`}
              data-testid={`pulse-card-${key}`}
            >
              {justBumped && (
                <span className={`absolute inset-0 -m-px rounded-xl ring-2 ${t.ring} animate-pulse pointer-events-none`} />
              )}
              <div className="flex items-start gap-2.5">
                <div className={`h-8 w-8 rounded-lg ${t.iconBg} grid place-items-center shrink-0`}>
                  <Icon className={`h-4 w-4 ${t.iconFg}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">{label}</div>
                  <div className="flex items-baseline gap-1.5">
                    <div className={`text-2xl font-bold ${t.text} tabular-nums`}>{v.current}</div>
                    <DeltaChip pct={v.delta_pct} />
                  </div>
                  <div className="text-[10px] text-slate-400 tabular-nums">{v.rate_per_min}/min avg</div>
                </div>
              </div>
              <Sparkline points={v.sparkline} tone={t.fill} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DeltaChip({ pct }) {
  if (pct === 0) return <span className="text-[10px] text-slate-400">—</span>;
  const up = pct > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${up ? "text-emerald-600" : "text-rose-600"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

function Sparkline({ points = [], tone = "fill-slate-400" }) {
  const max = Math.max(1, ...points);
  const w = 100;
  const h = 22;
  const step = w / Math.max(points.length, 1);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 w-full h-5 overflow-visible">
      {points.map((p, i) => {
        const bar = (p / max) * (h - 2);
        return (
          <rect
            key={i}
            x={i * step + 1}
            y={h - bar}
            width={Math.max(step - 1.5, 1.2)}
            height={Math.max(bar, 1.2)}
            rx={0.8}
            className={tone}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

function timeAgo(d) {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return d.toLocaleTimeString();
}
