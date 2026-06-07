/**
 * Retailer Inventory Command Center.
 *
 * Replaces the simple inventory table for retailers with an enterprise
 * cockpit: 7 KPI cards, stock-health donut, AI insights, low-stock center,
 * inventory value analysis (by category · 30-day trend · fast/slow movers)
 * and the full inventory table at the bottom.
 */
import { useNavigate } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Boxes, Layers, Coins, AlertTriangle, AlertOctagon, Hourglass, Ban,
  Sparkles, TrendingUp, TrendingDown, ShieldCheck, ArrowRight,
  BrainCircuit, Loader2, Search, ShoppingCart, ArrowRightLeft, Info, Eye,
  BarChart3, Zap, Snowflake,
} from "lucide-react";
import { toast } from "sonner";

const fmtMoney = (n) => {
  const v = Number(n || 0);
  if (v >= 1_000_000_000) return `₦${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `₦${(v / 1_000).toFixed(1)}K`;
  return `₦${v.toLocaleString()}`;
};
const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—";

const SEVERITY = {
  critical: { tile: "bg-rose-50", chip: "bg-rose-100 text-rose-700", text: "text-rose-700", icon: AlertOctagon, label: "Critical" },
  high:     { tile: "bg-orange-50", chip: "bg-orange-100 text-orange-700", text: "text-orange-700", icon: AlertTriangle, label: "High" },
  warning:  { tile: "bg-amber-50", chip: "bg-amber-100 text-amber-700", text: "text-amber-700", icon: TrendingDown, label: "Slow" },
  info:     { tile: "bg-violet-50", chip: "bg-violet-100 text-violet-700", text: "text-violet-700", icon: TrendingUp, label: "Trend" },
  positive: { tile: "bg-emerald-50", chip: "bg-emerald-100 text-emerald-700", text: "text-emerald-700", icon: ShieldCheck, label: "All Clear" },
};
const ICON_BY_NAME = {
  "alert-octagon": AlertOctagon, "alert-triangle": AlertTriangle,
  "trending-up": TrendingUp, "trending-down": TrendingDown,
  "shield-check": ShieldCheck, info: Info,
};

export default function RetailerInventoryCommand({ retailerId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!retailerId) return;
    let cancelled = false;
    let timer = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    Api.retailerInventoryCommand(retailerId)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [retailerId]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-[#FAFAF7] flex items-center justify-center" data-testid="retailer-inv-loading">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading inventory command center…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#FAFAF7]" data-testid="retailer-inventory-command">
      <div className="px-8 py-7 max-w-[1760px] mx-auto space-y-7">
        <Header retailer={data.retailer} />

        <KPIStrip kpis={data.kpis} />

        <div className="grid grid-cols-12 gap-6">
          <StockHealthCard health={data.stock_health} />
          <AIInsightsCard insights={data.ai_insights} retailerId={retailerId} />
        </div>

        <LowStockCenter rows={data.low_stock_center} retailerId={retailerId} />

        <div className="grid grid-cols-12 gap-6">
          <ValueByCategoryCard rows={data.value_by_category} />
          <InventoryTrendCard trend={data.inventory_trend} />
        </div>

        <div className="grid grid-cols-12 gap-6">
          <MoversCard title="Fast Moving Products" rows={data.fast_moving} variant="fast" />
          <MoversCard title="Slow Moving Products" rows={data.slow_moving} variant="slow" />
        </div>

        <FullInventoryTable
          inventory={data.inventory}
          search={search}
          setSearch={setSearch}
        />
      </div>
    </div>
  );
}

/* ---------- Header ---------- */
function Header({ retailer }) {
  return (
    <div className="flex items-start justify-between gap-6" data-testid="inv-cc-header">
      <div>
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.25em] text-violet-700 font-semibold mb-1">
          <Sparkles className="h-3 w-3" /> Inventory Command Center
        </div>
        <h1 className="text-3xl font-semibold text-slate-900 tracking-tight">
          {retailer?.name || "Your store"} · stock & replenishment
        </h1>
        <p className="text-sm text-slate-500 mt-1.5 max-w-2xl">
          Live view of inventory health, AI-driven replenishment alerts, and the products that need
          your attention next.
        </p>
      </div>
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <div className="inline-flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white px-3 text-[11px] font-semibold shadow-sm">
          <BrainCircuit className="h-3.5 w-3.5" /> AI ASSISTED
        </div>
      </div>
    </div>
  );
}

/* ---------- KPI Strip (7 cards) ---------- */
function KPIStrip({ kpis }) {
  const items = [
    { key: "inventory_value", label: "Inventory Value", fmt: fmtMoney, icon: Coins,       accent: "text-violet-700" },
    { key: "total_skus",      label: "Total SKUs",      fmt: fmtInt,   icon: Layers,      accent: "text-slate-700" },
    { key: "inventory_units", label: "Inventory Units", fmt: fmtInt,   icon: Boxes,       accent: "text-blue-700" },
    { key: "low_stock",       label: "Low Stock",       fmt: fmtInt,   icon: AlertTriangle, accent: "text-amber-700" },
    { key: "critical_stock",  label: "Critical Stock",  fmt: fmtInt,   icon: AlertOctagon, accent: "text-rose-700" },
    { key: "expiring_soon",   label: "Aging Stock",     fmt: fmtInt,   icon: Hourglass,   accent: "text-orange-700",
      hint: "Items with positive stock and no sale in the last 60 days" },
    { key: "dead_stock",      label: "Dead Stock",      fmt: fmtInt,   icon: Ban,         accent: "text-slate-700",
      hint: "Items with positive stock and zero sales in the last 90 days" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3" data-testid="inv-cc-kpi-strip">
      {items.map((it) => (
        <KPICard key={it.key} {...it} kpi={kpis?.[it.key]} testId={`inv-kpi-${it.key}`} />
      ))}
    </div>
  );
}
function KPICard({ label, fmt, icon: Icon, accent, kpi, hint, testId }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
         data-testid={testId} title={hint || ""}>
      <div className="flex items-start justify-between">
        <div className="text-[10.5px] uppercase tracking-wider text-slate-500 font-semibold leading-tight max-w-[120px]">
          {label}
        </div>
        <div className={`h-7 w-7 rounded-lg bg-slate-50 flex items-center justify-center ${accent}`}>
          {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        </div>
      </div>
      <div className="mt-2 text-[26px] font-semibold text-slate-900 tabular-nums tracking-tight">
        {fmt(kpi?.value)}
      </div>
    </div>
  );
}

/* ---------- Stock Health donut ---------- */
function StockHealthCard({ health }) {
  const donut = health?.donut || [];
  const total = donut.reduce((a, d) => a + (d.value || 0), 0) || 1;
  const R = 64, C = 2 * Math.PI * R;
  // Pre-compute slice offsets so the JSX can stay pure (no mutation during render).
  const slices = [];
  let offsetAcc = 0;
  for (const d of donut) {
    const len = (d.value / total) * C;
    slices.push({ ...d, len, offset: -offsetAcc });
    offsetAcc += len;
  }
  return (
    <div className="col-span-12 lg:col-span-5 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="inv-cc-stock-health">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Stock Health</div>
      <h3 className="text-base font-semibold text-slate-900 mt-0.5">Shelf-level distribution</h3>
      <div className="flex items-center gap-6 mt-4">
        <div className="relative h-[170px] w-[170px] shrink-0">
          <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
            <circle cx="80" cy="80" r={R} fill="none" stroke="#f1f5f9" strokeWidth="16" />
            {slices.map((s, i) => (
              <circle key={i} cx="80" cy="80" r={R} fill="none"
                      stroke={s.color} strokeWidth="16"
                      strokeDasharray={`${s.len} ${C}`} strokeDashoffset={s.offset}
                      strokeLinecap="butt" />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-3xl font-semibold text-slate-900 tabular-nums">{fmtInt(health?.total)}</div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">SKUs</div>
          </div>
        </div>
        <div className="flex-1 space-y-3">
          {donut.map((d) => {
            const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
            return (
              <div key={d.label} data-testid={`stock-health-${d.label.toLowerCase()}`}>
                <div className="flex items-center gap-2 text-sm mb-1">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                  <span className="text-slate-700 font-medium flex-1">{d.label}</span>
                  <span className="text-slate-500 tabular-nums">{d.value}</span>
                  <span className="text-slate-400 tabular-nums text-[12px]">{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ background: d.color, width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- AI Inventory Insights ---------- */
function AIInsightsCard({ insights, retailerId }) {
  const nav = useNavigate();

  const onReorder = async (rec) => {
    try {
      await Api.cartAddItem(retailerId, {
        product_id: rec.product_id,
        distributor_id: rec.suggested_supplier_id || "",
        quantity: rec.recommended_qty || 50,
        unit_cost: 0,
      });
      toast.success(`${rec.product_name} added to cart`);
      nav("/procurement?tab=cart");
    } catch {
      toast.error("Could not add to cart — open Procurement to choose a supplier.");
      nav("/procurement?tab=cart");
    }
  };

  return (
    <div className="col-span-12 lg:col-span-7 rounded-2xl bg-gradient-to-br from-[#1e1b4b] via-[#312e81] to-[#5b21b6] text-white shadow-xl overflow-hidden"
         data-testid="inv-cc-ai-insights">
      <div className="px-5 pt-5 pb-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-white/15 flex items-center justify-center">
            <BrainCircuit className="h-4 w-4" />
          </div>
          <div>
            <div className="text-[10px] tracking-[0.18em] uppercase text-white/60">AI Inventory Insights</div>
            <div className="text-sm font-semibold">Stock intelligence</div>
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[10px] text-emerald-200 bg-emerald-500/15 border border-emerald-400/30 rounded-full px-2 h-6">
          <ShieldCheck className="h-3 w-3" /> Real-time
        </div>
      </div>
      <div className="px-5 py-4 space-y-3 max-h-[420px] overflow-y-auto">
        {(insights || []).map((it, i) => {
          const sev = SEVERITY[it.severity] || SEVERITY.info;
          const Icon = ICON_BY_NAME[it.icon] || sev.icon;
          return (
            <div key={i} className="rounded-xl bg-white/10 backdrop-blur border border-white/15 p-3.5"
                 data-testid={`inv-ai-insight-${i}`}>
              <div className="flex items-start gap-2.5">
                <div className={`h-8 w-8 rounded-lg ${sev.chip} flex items-center justify-center shrink-0`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold leading-tight">{it.title}</div>
                  <div className="text-[12px] text-white/70 mt-1 leading-snug">{it.detail}</div>
                  {(it.actions || []).length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {it.actions.includes("reorder") && (
                        <button
                          onClick={() => onReorder(it)}
                          className="inline-flex items-center gap-1 h-7 rounded-full bg-white text-slate-900 px-3 text-[11px] font-semibold hover:bg-white/95"
                          data-testid={`inv-ai-reorder-${i}`}
                        ><ShoppingCart className="h-3 w-3" /> Reorder</button>
                      )}
                      {it.actions.includes("transfer") && (
                        <button
                          onClick={() => toast.info("Transfer flow coming soon")}
                          className="inline-flex items-center gap-1 h-7 rounded-full bg-white/10 border border-white/20 px-3 text-[11px] font-semibold hover:bg-white/15"
                          data-testid={`inv-ai-transfer-${i}`}
                        ><ArrowRightLeft className="h-3 w-3" /> Transfer</button>
                      )}
                      {it.actions.includes("review") && it.product_id && (
                        <button
                          onClick={() => nav(`/inventory/product/${it.product_id}`)}
                          className="inline-flex items-center gap-1 h-7 rounded-full bg-white/10 border border-white/20 px-3 text-[11px] font-semibold hover:bg-white/15"
                          data-testid={`inv-ai-review-${i}`}
                        ><Eye className="h-3 w-3" /> Review</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Low Stock Center ---------- */
function LowStockCenter({ rows, retailerId }) {
  const nav = useNavigate();
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden"
         data-testid="inv-cc-low-stock">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Low Stock Center</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">Products needing attention</h3>
        </div>
        <Button variant="outline" onClick={() => nav("/procurement?tab=cart")}
                className="border-violet-200 text-violet-700 hover:bg-violet-50">
          Open Procurement <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="p-10 text-center text-slate-400">
          <ShieldCheck className="h-6 w-6 mx-auto text-emerald-400 mb-2" />
          All shelves are healthy — nothing needs attention right now.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table data-testid="low-stock-table">
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Reorder Level</TableHead>
                <TableHead className="text-right">Days Remaining</TableHead>
                <TableHead className="text-right">Recommended Qty</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.product_id} data-testid={`low-stock-row-${r.product?.sku}`}>
                  <TableCell>
                    <div className="font-medium text-slate-900">{r.product?.name || "—"}</div>
                    <div className="text-[11px] text-slate-500">{r.product?.category}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Badge className={
                      r.status === "critical"
                        ? "bg-rose-100 text-rose-800 hover:bg-rose-100"
                        : "bg-amber-100 text-amber-800 hover:bg-amber-100"
                    }>{r.current_stock}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-slate-500">{r.reorder_level}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.days_remaining == null
                      ? <span className="text-slate-400 italic">no velocity</span>
                      : <span className={r.days_remaining <= 3 ? "text-rose-700 font-bold" : r.days_remaining <= 7 ? "text-orange-700 font-semibold" : "text-slate-700"}>{r.days_remaining}d</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-violet-700">
                    {r.recommended_qty}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      className="h-8 bg-violet-700 hover:bg-violet-800 text-white"
                      onClick={() => nav("/procurement?tab=cart")}
                      data-testid={`low-stock-reorder-${r.product?.sku}`}
                    >
                      <ShoppingCart className="h-3 w-3 mr-1" /> Reorder
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ---------- Inventory Value by Category ---------- */
function ValueByCategoryCard({ rows }) {
  const max = Math.max(...(rows || []).map((r) => r.value), 1);
  return (
    <div className="col-span-12 lg:col-span-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="inv-cc-value-by-category">
      <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Inventory Value</div>
      <h3 className="text-base font-semibold text-slate-900 mt-0.5">By Category</h3>
      <div className="mt-4 space-y-3">
        {(rows || []).length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-10">No data yet.</div>
        ) : rows.map((r) => {
          const pct = (r.value / max) * 100;
          return (
            <div key={r.category} className="text-sm" data-testid={`category-row-${r.category}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="font-medium text-slate-700">{r.category}</div>
                <div className="text-slate-600 tabular-nums">
                  {fmtMoney(r.value)}
                  <span className="text-slate-400 ml-2 text-[12px]">{r.skus} SKU{r.skus === 1 ? "" : "s"} · {r.pct}%</span>
                </div>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Inventory Trend ---------- */
function InventoryTrendCard({ trend }) {
  const max = Math.max(...trend.map((t) => t.value), 1);
  const min = Math.min(...trend.map((t) => t.value), max);
  const w = 600, h = 200, padL = 44, padR = 12, padT = 12, padB = 26;
  const innerW = w - padL - padR, innerH = h - padT - padB;
  const step = innerW / Math.max(1, trend.length - 1);
  const range = max - min || 1;
  const pts = trend.map((t, i) => ({
    x: padL + i * step,
    y: padT + innerH - ((t.value - min) / range) * innerH,
    raw: t,
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = pts.length
    ? `${path} L ${pts[pts.length - 1].x} ${padT + innerH} L ${pts[0].x} ${padT + innerH} Z`
    : "";
  const change = pts.length > 1
    ? ((pts[pts.length - 1].raw.value - pts[0].raw.value) / pts[0].raw.value * 100)
    : 0;
  return (
    <div className="col-span-12 lg:col-span-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid="inv-cc-trend">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Inventory Trend</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">30-day projected value</h3>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Today</div>
          <div className="text-lg font-semibold text-slate-900 tabular-nums">
            {fmtMoney(trend[trend.length - 1]?.value)}
          </div>
          <div className={`text-[11px] font-semibold ${change >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {change >= 0 ? "+" : ""}{change.toFixed(1)}% vs 30d ago
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[200px]" preserveAspectRatio="none">
        <defs>
          <linearGradient id="inv-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.30" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
          <line key={i} x1={padL} x2={w - padR}
                y1={padT + innerH * p} y2={padT + innerH * p}
                stroke="#f1f5f9" strokeWidth="1" />
        ))}
        {area && <path d={area} fill="url(#inv-area)" />}
        {path && <path d={path} fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
        {pts.filter((_, i) => i % 5 === 0).map((p, i) => (
          <text key={i} x={p.x} y={h - 8} fontSize="9" fill="#94a3b8" textAnchor="middle">
            {p.raw.date.slice(5)}
          </text>
        ))}
        {[0, 0.5, 1].map((p, i) => (
          <text key={i} x={padL - 6} y={padT + innerH * (1 - p) + 4} fontSize="9" fill="#94a3b8" textAnchor="end">
            {fmtMoney(min + range * p)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/* ---------- Fast / Slow Movers ---------- */
function MoversCard({ title, rows, variant }) {
  const Icon = variant === "fast" ? Zap : Snowflake;
  const accent = variant === "fast" ? "text-emerald-600" : "text-amber-600";
  const tone = variant === "fast" ? "from-emerald-500 to-teal-500" : "from-amber-400 to-orange-500";
  return (
    <div className="col-span-12 lg:col-span-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-6"
         data-testid={`inv-cc-${variant}-movers`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">{variant === "fast" ? "Top Sellers" : "Slow Movers"}</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">{title}</h3>
        </div>
        <Icon className={`h-5 w-5 ${accent}`} />
      </div>
      {(rows || []).length === 0 ? (
        <div className="text-sm text-slate-400 text-center py-10">No data yet.</div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((m) => {
            const max = Math.max(...rows.map((r) => r.units_30d), 1);
            const pct = (m.units_30d / max) * 100;
            return (
              <div key={m.product_id} className="text-sm" data-testid={`${variant}-mover-${m.product?.sku}`}>
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-slate-700 truncate flex-1 min-w-0">{m.product?.name || "—"}</div>
                  <div className="text-slate-600 tabular-nums whitespace-nowrap">
                    {fmtInt(m.units_30d)} <span className="text-slate-400 text-[12px]">units · {fmtMoney(m.revenue_30d)}</span>
                  </div>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full bg-gradient-to-r ${tone} rounded-full`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------- Full Inventory Table ---------- */
function FullInventoryTable({ inventory, search, setSearch }) {
  const nav = useNavigate();
  const q = search.trim().toLowerCase();
  const rows = q
    ? inventory.filter((i) =>
        (i.product?.name || "").toLowerCase().includes(q) ||
        (i.product?.sku || "").toLowerCase().includes(q) ||
        (i.product?.category || "").toLowerCase().includes(q)
      )
    : inventory;

  const STATUS_BADGE = {
    healthy: "bg-emerald-100 text-emerald-800",
    low: "bg-amber-100 text-amber-800",
    critical: "bg-rose-100 text-rose-800",
  };

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden"
         data-testid="inv-cc-full-table">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold">Full Inventory</div>
          <h3 className="text-base font-semibold text-slate-900 mt-0.5">All {inventory.length} SKUs on your shelves</h3>
        </div>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKUs, products, categories…"
            className="pl-9 w-80"
            data-testid="inventory-search"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table data-testid="inventory-table">
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Reorder Level</TableHead>
              <TableHead className="text-right">Velocity / day</TableHead>
              <TableHead className="text-right">Last Sale</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-slate-400 py-12">
                  No inventory matches your search.
                </TableCell>
              </TableRow>
            )}
            {rows.map((i) => (
              <TableRow
                key={i.id}
                onClick={() => nav(`/inventory/product/${i.product_id}`)}
                className="cursor-pointer hover:bg-violet-50/40 transition-colors"
                data-testid={`inventory-row-${i.product?.sku}`}
              >
                <TableCell className="font-mono text-xs text-slate-500">{i.product?.sku}</TableCell>
                <TableCell className="font-medium text-slate-900">{i.product?.name}</TableCell>
                <TableCell className="text-slate-600">{i.product?.category}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{i.quantity}</TableCell>
                <TableCell className="text-right text-slate-500 tabular-nums">{i.reorder_level}</TableCell>
                <TableCell className="text-right text-slate-500 tabular-nums">{i.velocity_30d}</TableCell>
                <TableCell className="text-right text-slate-500 tabular-nums">{fmtDate(i.last_sale)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmtMoney(i.value)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={`${STATUS_BADGE[i.status]} border-transparent`}>
                    {i.status === "healthy" ? "Healthy" : i.status === "low" ? "Low stock" : "Critical"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
