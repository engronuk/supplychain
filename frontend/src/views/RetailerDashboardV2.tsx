// RetailerDashboardV2.tsx — Modern AI-powered Retail OS home
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import retailerAnalyticsService, {
  AIInsight,
  ActivityItem,
  DashboardKpis,
  SalesTrend,
} from "@/services/retailerAnalyticsService";
import { Api } from "@/lib/api";
import RetailerAIInsights from "@/components/RetailerAIInsights";
import RetailerActivityFeed from "@/components/RetailerActivityFeed";
import SmartReorderPanel from "@/components/SmartReorderPanel";
import VoiceOrderModal from "@/components/VoiceOrderModal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles,
  Mic,
  RotateCw,
  Truck,
  PackageCheck,
  AlertTriangle,
  TrendingUp,
  Boxes,
  Flame,
  Wifi,
  WifiOff,
  ShoppingCart,
  ChevronRight,
  CircleDot,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { toast } from "sonner";

interface Dashboard {
  retailer: any;
  kpis: DashboardKpis;
  recent_shipments: any[];
  top_selling: { _id: string; product?: { name?: string }; units: number; revenue: number }[];
  fast_moving: any[];
  near_stockout: any[];
}

const NGN = (n: number) => `₦${n.toLocaleString()}`;

export default function RetailerDashboardV2() {
  const { session } = useSession();
  const navigate = useNavigate();
  const [data, setData] = useState<Dashboard | null>(null);
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [trend, setTrend] = useState<SalesTrend | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [online, setOnline] = useState<boolean>(navigator.onLine);
  const [openReorder, setOpenReorder] = useState(false);
  const [openVoice, setOpenVoice] = useState(false);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const retailerId = session.entity.id;

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const [dash, ins, act, tr] = await Promise.all([
        retailerAnalyticsService.dashboard(retailerId),
        retailerAnalyticsService.insights(retailerId),
        retailerAnalyticsService.activity(retailerId),
        retailerAnalyticsService.salesTrend(retailerId, 7),
      ]);
      setData(dash.data);
      setInsights(ins.data);
      setActivity(act.data);
      setTrend(tr.data);
      setFromCache(dash.fromCache || ins.fromCache || act.fromCache || tr.fromCache);
    } catch (e: any) {
      toast.error("Failed to load — showing what we have.");
    } finally {
      setRefreshing(false);
    }
  }, [retailerId]);

  useEffect(() => {
    loadAll();
    Api.products().then((ps: any[]) => setProducts(ps.map((p) => ({ id: p.id, name: p.name }))));
    const off = retailerAnalyticsService.attachAutoFlush(retailerId, (n) => {
      toast.success(`${n} queued reorder${n === 1 ? "" : "s"} synced.`);
      loadAll();
    });
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    const onOpenReorder = () => setOpenReorder(true);
    const onOpenVoice = () => setOpenVoice(true);
    const onRefresh = () => loadAll();
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    window.addEventListener("retailer:open-smart-reorder", onOpenReorder);
    window.addEventListener("retailer:open-voice-order", onOpenVoice);
    window.addEventListener("retailer:refresh-dashboard", onRefresh);
    return () => {
      off();
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
      window.removeEventListener("retailer:open-smart-reorder", onOpenReorder);
      window.removeEventListener("retailer:open-voice-order", onOpenVoice);
      window.removeEventListener("retailer:refresh-dashboard", onRefresh);
    };
  }, [retailerId, loadAll]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  if (!data) {
    return (
      <div className="p-6 md:p-8 max-w-6xl mx-auto">
        <div className="h-32 rounded-2xl bg-white border border-slate-200 animate-pulse" />
      </div>
    );
  }

  const k = data.kpis;
  const incomingShipments = data.recent_shipments.filter((s) => s.status !== "received").slice(0, 3);

  return (
    <div className="px-4 md:px-8 py-5 md:py-6 max-w-6xl mx-auto" data-testid="retailer-dashboard-v2">
      {/* Status pills */}
      {(fromCache || !online) && (
        <div
          className={`mb-3 inline-flex items-center gap-2 text-[11px] font-medium px-3 py-1.5 rounded-full ${
            online ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-rose-50 text-rose-700 border border-rose-200"
          }`}
          data-testid="retailer-offline-indicator"
        >
          {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {online ? "Showing cached data" : "Offline — reorders will sync when back online"}
        </div>
      )}

      {/* Hero greeting + sales today */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-4 mb-4">
        <Card
          className="lg:col-span-2 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0 shadow-md"
          data-testid="hero-card"
        >
          <CardContent className="p-5 md:p-6">
            <div className="text-[11px] uppercase tracking-[0.18em] text-white/60 font-medium">
              {greeting}, {data.retailer?.name || "Retailer"}
            </div>
            <div className="mt-2 flex items-end gap-3 flex-wrap">
              <div>
                <div className="text-[11px] text-white/60 uppercase tracking-wider">Today's sales</div>
                <div className="text-3xl md:text-4xl font-semibold tracking-tight">
                  {NGN(k.sales_today_revenue)}
                </div>
                <div className="text-[12px] text-white/70 mt-0.5">{k.sales_today_units} units sold</div>
              </div>
              <div className="flex-1" />
              <button
                onClick={loadAll}
                className="ml-auto inline-flex items-center gap-1 text-[12px] text-white/80 hover:text-white"
                data-testid="refresh-btn"
              >
                <RotateCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
            {trend && (
              <div className="mt-3 h-20 -mx-2">
                <ResponsiveContainer>
                  <AreaChart data={trend.series}>
                    <defs>
                      <linearGradient id="hero-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#a5b4fc" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#a5b4fc" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Area type="monotone" dataKey="revenue" stroke="#a5b4fc" strokeWidth={2} fill="url(#hero-grad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 md:gap-4">
          <KPI
            label="Pending Deliveries"
            value={k.pending_deliveries}
            Icon={Truck}
            tone={k.pending_deliveries > 0 ? "amber" : "slate"}
            testId="kpi-pending"
          />
          <KPI
            label="Critical Stock"
            value={k.critical_count}
            Icon={AlertTriangle}
            tone={k.critical_count > 0 ? "rose" : "slate"}
            testId="kpi-critical"
          />
          <KPI label="Inventory Units" value={k.inventory_units.toLocaleString()} Icon={Boxes} tone="slate" testId="kpi-inventory" />
          <KPI
            label="Stock Score"
            value={trend?.stock_efficiency_score ?? "—"}
            Icon={TrendingUp}
            tone="emerald"
            testId="kpi-score"
            sub="/ 100"
          />
        </div>
      </div>

      {/* Quick actions — large touch targets */}
      <div className="grid grid-cols-3 gap-3 mb-5" data-testid="quick-actions">
        <ActionTile
          onClick={() => setOpenReorder(true)}
          gradient="from-indigo-500 to-violet-600"
          Icon={Sparkles}
          label="Restock my store"
          sub="AI suggestions"
          testId="action-smart-reorder"
        />
        <ActionTile
          onClick={() => setOpenVoice(true)}
          gradient="from-rose-500 to-orange-500"
          Icon={Mic}
          label="Voice order"
          sub="Just speak it"
          testId="action-voice"
        />
        <ActionTile
          onClick={() => navigate("/shipments")}
          gradient="from-emerald-500 to-teal-600"
          Icon={ShoppingCart}
          label="Reorder previous"
          sub="One-tap clone"
          testId="action-quick-reorder"
        />
      </div>

      {/* AI Insights */}
      <SectionHeader
        title="AI Insights"
        sub="Smart recommendations from your sales data"
        Icon={Sparkles}
      />
      <div className="mb-5">
        <RetailerAIInsights insights={insights} onAction={() => setOpenReorder(true)} />
      </div>

      {/* Near Stockout + Top Selling */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-5">
        <NearStockoutCard items={data.near_stockout} onReorder={() => setOpenReorder(true)} />
        <TopSellingCard items={data.top_selling} fastMoving={data.fast_moving} />
      </div>

      {/* Pending shipments */}
      {incomingShipments.length > 0 && (
        <>
          <SectionHeader
            title="Incoming Shipments"
            sub="What's on the way to your store"
            Icon={Truck}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5" data-testid="incoming-shipments">
            {incomingShipments.map((s: any) => (
              <Card key={s.id} className="border-slate-200">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-xs font-semibold text-slate-700">{s.tracking_code}</div>
                    <span
                      className={`text-[10px] uppercase tracking-wider font-semibold rounded-full px-2 py-0.5 ${
                        s.status === "in_transit" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {s.status.replace("_", " ")}
                    </span>
                  </div>
                  <div className="mt-2 text-[13px] text-slate-700 truncate">
                    from <span className="font-medium">{s.distributor?.name}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-500">
                    {s.items.length} item{s.items.length === 1 ? "" : "s"} ·{" "}
                    {s.items.reduce((a: number, b: any) => a + b.quantity, 0)} units
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* 7-day trend + activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-5" data-testid="trend-card">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Last 7 days</div>
              <div className="text-base font-semibold text-slate-900">Sales trend</div>
            </div>
            {trend && (
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Total</div>
                <div className="text-lg font-semibold text-slate-900">{NGN(trend.totals.revenue)}</div>
                <div className="text-[11px] text-slate-500">
                  Turnover {trend.inventory_turnover}× · {trend.reorder_count} reorders
                </div>
              </div>
            )}
          </div>
          {trend && (
            <div className="h-44">
              <ResponsiveContainer>
                <AreaChart data={trend.series}>
                  <defs>
                    <linearGradient id="trend-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f172a" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0f172a" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#64748b" }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                    formatter={(v: any, name: string) => [name === "revenue" ? NGN(v) : v, name]}
                  />
                  <Area type="monotone" dataKey="units" stroke="#0f172a" strokeWidth={1.6} fill="url(#trend-grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
        <RetailerActivityFeed items={activity} />
      </div>

      {/* Sheets */}
      <SmartReorderPanel
        open={openReorder}
        onOpenChange={setOpenReorder}
        retailerId={retailerId}
        onSubmitted={loadAll}
      />
      <VoiceOrderModal
        open={openVoice}
        onOpenChange={setOpenVoice}
        retailerId={retailerId}
        products={products}
        onSubmitted={loadAll}
      />
    </div>
  );
}

function KPI({
  label,
  value,
  Icon,
  tone,
  sub,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  Icon: any;
  tone: "slate" | "amber" | "rose" | "emerald";
  sub?: string;
  testId?: string;
}) {
  const tones: Record<string, string> = {
    slate: "bg-white text-slate-900 border-slate-200",
    amber: "bg-amber-50 text-amber-900 border-amber-200",
    rose: "bg-rose-50 text-rose-900 border-rose-200",
    emerald: "bg-emerald-50 text-emerald-900 border-emerald-200",
  };
  const iconBg: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    amber: "bg-amber-100 text-amber-700",
    rose: "bg-rose-100 text-rose-700",
    emerald: "bg-emerald-100 text-emerald-700",
  };
  return (
    <div className={`rounded-2xl border ${tones[tone]} p-3 md:p-4 shadow-sm`} data-testid={testId}>
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] uppercase tracking-wider opacity-70 font-medium">{label}</div>
        <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${iconBg[tone]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="text-2xl md:text-[26px] font-semibold tracking-tight">
        {value}
        {sub && <span className="text-xs text-slate-500 font-normal ml-1">{sub}</span>}
      </div>
    </div>
  );
}

function ActionTile({
  onClick,
  gradient,
  Icon,
  label,
  sub,
  testId,
}: {
  onClick: () => void;
  gradient: string;
  Icon: any;
  label: string;
  sub: string;
  testId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className="group relative rounded-2xl p-4 text-left text-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all overflow-hidden min-h-[96px]"
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient}`} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.25),transparent_60%)]" />
      <div className="relative">
        <div className="h-9 w-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center mb-2">
          <Icon className="h-4 w-4" />
        </div>
        <div className="font-semibold text-[14px] md:text-[15px] leading-tight">{label}</div>
        <div className="text-[11px] opacity-85 mt-0.5">{sub}</div>
      </div>
    </button>
  );
}

function SectionHeader({ title, sub, Icon }: { title: string; sub?: string; Icon?: any }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        {Icon && (
          <div className="h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center">
            <Icon className="h-3.5 w-3.5 text-slate-700" />
          </div>
        )}
        <div>
          <div className="text-[15px] font-semibold tracking-tight text-slate-900">{title}</div>
          {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function NearStockoutCard({
  items,
  onReorder,
}: {
  items: any[];
  onReorder: () => void;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white" data-testid="near-stockout-card">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-rose-500" />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">Near Stockout</div>
            <div className="text-sm font-semibold text-slate-900">Items needing attention</div>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onReorder}
          className="h-8 text-[12px]"
          data-testid="near-stockout-reorder-btn"
        >
          Reorder all
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">All items healthy ✨</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.slice(0, 6).map((it: any) => {
            const tone =
              it.urgency === "critical" ? "bg-rose-100 text-rose-700"
              : "bg-amber-100 text-amber-700";
            return (
              <li
                key={it.product_id}
                className="px-4 py-2.5 flex items-center gap-3"
                data-testid={`stockout-row-${it.product_id}`}
              >
                <CircleDot
                  className={`h-3 w-3 ${it.urgency === "critical" ? "text-rose-500" : "text-amber-500"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-slate-900 truncate">{it.product?.name}</div>
                  <div className="text-[11px] text-slate-500">
                    {it.quantity} in stock · {it.velocity?.toFixed?.(1) ?? it.velocity} u/day
                  </div>
                </div>
                <span className={`text-[10px] uppercase font-semibold tracking-wider rounded-full px-2 py-0.5 ${tone}`}>
                  {it.days_remaining < 999 ? `${it.days_remaining}d` : "slow"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TopSellingCard({
  items,
  fastMoving,
}: {
  items: any[];
  fastMoving: any[];
}) {
  const top = items.length ? items : fastMoving.map((f: any) => ({ _id: f.product_id, product: f.product, units: 0, revenue: 0 }));
  return (
    <div className="rounded-2xl border border-slate-200 bg-white" data-testid="top-selling-card">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-600" />
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
              {items.length ? "Top Selling · 7d" : "Fast Moving"}
            </div>
            <div className="text-sm font-semibold text-slate-900">Best performers</div>
          </div>
        </div>
        <PackageCheck className="h-4 w-4 text-slate-300" />
      </div>
      {top.length === 0 ? (
        <div className="p-6 text-center text-sm text-slate-500">No sales data yet</div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {top.slice(0, 6).map((t: any, idx: number) => (
            <li key={t._id || t.product_id || idx} className="px-4 py-2.5 flex items-center gap-3">
              <div className="h-7 w-7 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center text-[11px] font-semibold text-slate-700">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-slate-900 truncate">{t.product?.name}</div>
                {t.units > 0 ? (
                  <div className="text-[11px] text-slate-500">
                    {t.units} units · {NGN(Math.round(t.revenue || 0))}
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-500">Velocity {(t.velocity || 0).toFixed?.(1) || 0} u/day</div>
                )}
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
