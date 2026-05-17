import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, ResponsiveContainer, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, Cell,
} from "recharts";
import {
  TrendingUp, TrendingDown, Sparkles, AlertOctagon, AlertTriangle,
  Clock, ShieldCheck, Trophy, Info, Package, Users, MapPin, Activity,
  Truck, Factory, Store, Boxes, CheckCircle2, CircleDashed, Send,
} from "lucide-react";

const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const compact = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e6) return "₦" + (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return "₦" + (n / 1e3).toFixed(1) + "k";
  return "₦" + n.toFixed(0);
};
const shortDate = (s) => {
  if (!s) return "";
  const d = new Date(s);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const INSIGHT_ICONS = {
  "trending-up": TrendingUp, "trending-down": TrendingDown, "sparkles": Sparkles,
  "alert-octagon": AlertOctagon, "alert-triangle": AlertTriangle, "clock": Clock,
  "shield-check": ShieldCheck, "trophy": Trophy, "info": Info,
};

const CHART_COLORS = ["#6366f1", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

export default function AnalyticsView() {
  const { session } = useSession();
  if (session.role === "distributor") {
    return <DistributorExecutiveAnalytics session={session} />;
  }
  return <NetworkAnalytics session={session} />;
}

// =========================================================================
// Distributor Executive Analytics
// =========================================================================
function DistributorExecutiveAnalytics({ session }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Api.distributorExecutiveAnalytics(session.entity.id)
      .then(setData)
      .finally(() => setLoading(false));
  }, [session.entity.id]);

  if (loading || !data) {
    return <div className="p-8 max-w-[1500px] mx-auto">
      <PageHeader title="Executive Analytics" description="Loading network intelligence…" />
    </div>;
  }

  const { kpis, trend, margin_trend, category_performance, region_intelligence,
          best_products, underperforming_products, best_retailers, fastest_growing,
          declining, low_health_retailers, ai_insights } = data;

  const noData = kpis.revenue_30d === 0;

  return (
    <div className="p-6 lg:p-8 max-w-[1500px] mx-auto" data-testid="executive-analytics">
      <PageHeader title="Executive Analytics" description={`Network intelligence across ${kpis.total_retailers} retailers · last 30 days`} />

      {noData ? (
        <Card><CardContent className="p-10 text-center">
          <Activity className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <div className="text-[14px] font-semibold text-slate-900">No sales data yet</div>
          <div className="text-[12.5px] text-slate-500 mt-1">Sales analytics will appear here once retailers begin recording transactions.</div>
        </CardContent></Card>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <KPI label="Revenue · 30d" value={fmtMoney(kpis.revenue_30d)}
                 trend={kpis.mom_pct} trendLabel="M/M" tone="indigo" />
            <KPI label="Revenue · 7d" value={fmtMoney(kpis.revenue_7d)}
                 trend={kpis.wow_pct} trendLabel="W/W" tone="indigo" />
            <KPI label="Gross Margin · 30d" value={fmtMoney(kpis.margin_30d)}
                 sub="20% margin proxy" tone="emerald" />
            <KPI label="Active Retailers" value={`${kpis.active_retailers} / ${kpis.total_retailers}`}
                 sub="sold in last 14d" tone="blue" />
          </div>

          {/* AI Insights ribbon (Claude Haiku) */}
          {ai_insights.length > 0 && (
            <div className="mb-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="exec-ai-insights">
              {ai_insights.slice(0, 3).map((ins, i) => <InsightCard key={i} insight={ins} />)}
            </div>
          )}

          {/* Revenue & Margin trends */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
            <Card><CardContent className="p-5">
              <SectionTitle title="Revenue Trend · 30 Days" right={
                <DeltaBadge value={kpis.wow_pct} label="W/W" />
              } />
              <div className="h-64">
                <ResponsiveContainer>
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={shortDate} fontSize={10} stroke="#94a3b8" />
                    <YAxis tickFormatter={compact} fontSize={10} stroke="#94a3b8" />
                    <Tooltip formatter={(v) => fmtMoney(v)} labelFormatter={shortDate} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Area type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} fill="url(#rev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent></Card>

            <Card><CardContent className="p-5">
              <SectionTitle title="Margin Trend · 30 Days" right={
                <DeltaBadge value={kpis.mom_pct} label="M/M" />
              } />
              <div className="h-64">
                <ResponsiveContainer>
                  <AreaChart data={margin_trend}>
                    <defs>
                      <linearGradient id="mar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={shortDate} fontSize={10} stroke="#94a3b8" />
                    <YAxis tickFormatter={compact} fontSize={10} stroke="#94a3b8" />
                    <Tooltip formatter={(v) => fmtMoney(v)} labelFormatter={shortDate} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Area type="monotone" dataKey="margin" stroke="#10b981" strokeWidth={2} fill="url(#mar)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent></Card>
          </div>

          {/* Category + Region */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
            <Card><CardContent className="p-5">
              <SectionTitle title="Sales by Category" />
              {category_performance.length === 0 ? <Empty /> : (
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={category_performance} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                      <XAxis type="number" tickFormatter={compact} fontSize={10} stroke="#94a3b8" />
                      <YAxis type="category" dataKey="category" fontSize={11} stroke="#475569" width={110} />
                      <Tooltip formatter={(v) => fmtMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                        {category_performance.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent></Card>

            <Card><CardContent className="p-5">
              <SectionTitle title="Regional Intelligence" right={<span className="text-[11px] text-slate-500">{region_intelligence.length} regions</span>} />
              {region_intelligence.length === 0 ? <Empty /> :
                <div className="space-y-2">
                  {region_intelligence.map((r) => {
                    const maxRev = Math.max(...region_intelligence.map((x) => x.revenue), 1);
                    return (
                      <div key={r.region} className="rounded-xl border border-slate-200/70 p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-[13px] font-semibold text-slate-900 flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-indigo-500" />{r.region}
                          </div>
                          <div className="text-[12.5px] font-semibold tabular-nums">{fmtMoney(r.revenue)}</div>
                        </div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2">
                          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-blue-500"
                               style={{ width: `${(r.revenue / maxRev) * 100}%` }} />
                        </div>
                        <div className="flex items-center justify-between mt-1.5 text-[10.5px] text-slate-500">
                          <span>{r.retailers} retailers · {r.units} units</span>
                          {r.low_stock_retailers > 0 && (
                            <span className="text-rose-600 font-medium">{r.low_stock_retailers} low stock</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>}
            </CardContent></Card>
          </div>

          {/* Product Intelligence */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
            <Card><CardContent className="p-5">
              <SectionTitle title="Best-Selling Products" icon={Trophy} />
              <ProductList items={best_products} />
            </CardContent></Card>
            <Card><CardContent className="p-5">
              <SectionTitle title="Underperforming Products" icon={AlertTriangle} tone="amber" />
              <ProductList items={underperforming_products} tone="amber" />
            </CardContent></Card>
          </div>

          {/* Retailer Intelligence */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
            <Card><CardContent className="p-5">
              <SectionTitle title="Top Retailers · 30 days" icon={Users} />
              <RetailerList items={best_retailers} />
            </CardContent></Card>
            <Card><CardContent className="p-5">
              <SectionTitle title="Fastest Growing Retailers" icon={TrendingUp} tone="emerald" />
              <RetailerList items={fastest_growing} showGrowth />
            </CardContent></Card>
            <Card><CardContent className="p-5">
              <SectionTitle title="Retailers in Decline" icon={TrendingDown} tone="rose" />
              <RetailerList items={declining} showGrowth />
            </CardContent></Card>
            <Card><CardContent className="p-5">
              <SectionTitle title="Low Stock Health" icon={AlertOctagon} tone="rose" />
              {low_health_retailers.length === 0 ? <Empty msg="All retailers have healthy stock." /> :
                <div className="space-y-2">
                  {low_health_retailers.map((r) => (
                    <Link key={r.id} to={`/network/retailer/${r.id}`}
                          className="flex items-center justify-between rounded-xl border border-slate-200/70 p-3 hover:bg-slate-50 transition-colors">
                      <div>
                        <div className="text-[13px] font-medium text-slate-900">{r.name}</div>
                        <div className="text-[11px] text-slate-500">{r.region}</div>
                      </div>
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                        {r.low_pct}% low
                      </Badge>
                    </Link>
                  ))}
                </div>}
            </CardContent></Card>
          </div>

          {/* Additional AI insights */}
          {ai_insights.length > 3 && (
            <Card><CardContent className="p-5">
              <SectionTitle title="More Insights" icon={Sparkles} tone="indigo" />
              <div className="space-y-2">{ai_insights.slice(3).map((ins, i) => <InsightRow key={i} insight={ins} />)}</div>
            </CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

function NetworkAnalytics({ session }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Api.analytics(session.role, session.entity.id)
      .then(setData)
      .finally(() => setLoading(false));
  }, [session.role, session.entity.id]);

  const isManufacturer = session.role === "manufacturer";
  const title = isManufacturer ? "Production Network Analytics" : "Retailer Analytics";
  const subtitle = isManufacturer
    ? `${session.entity.name} · last 14 days of shipment & distribution health`
    : `${session.entity.name} · shipment, request & inventory pulse`;

  if (loading || !data) {
    return (
      <div className="p-6 lg:p-8 max-w-[1500px] mx-auto" data-testid="network-analytics-loading">
        <PageHeader title={title} description="Loading network intelligence…" />
      </div>
    );
  }

  const { kpis, status_breakdown, timeline, top_products } = data;
  const totalShipments = kpis.total_shipments || 0;
  const fulfillmentRate = totalShipments > 0
    ? Math.round((kpis.received / totalShipments) * 100)
    : 0;
  const inflightPct = totalShipments > 0
    ? Math.round(((kpis.pending + kpis.in_transit) / totalShipments) * 100)
    : 0;
  const STATUS_COLORS = { Pending: "#f59e0b", "In Transit": "#3b82f6", Received: "#10b981" };

  return (
    <div className="p-6 lg:p-8 max-w-[1500px] mx-auto" data-testid="network-analytics">
      <PageHeader title={title} description={subtitle} />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {isManufacturer ? (
          <>
            <KPI label="Distributors" value={kpis.distributors_count?.toLocaleString() || "0"}
                 sub="connected partners" tone="indigo" />
            <KPI label="Retailers" value={kpis.retailers_count?.toLocaleString() || "0"}
                 sub="reach across network" tone="blue" />
            <KPI label="Inventory Units" value={kpis.inventory_total?.toLocaleString() || "0"}
                 sub={`${kpis.low_stock || 0} SKUs low`} tone="emerald" />
            <KPI label="Total Shipments" value={totalShipments.toLocaleString()}
                 sub={`${fulfillmentRate}% fulfilled`} tone="slate" />
          </>
        ) : (
          <>
            <KPI label="Total Shipments" value={totalShipments.toLocaleString()}
                 sub={`${fulfillmentRate}% received`} tone="indigo" />
            <KPI label="In Flight" value={(kpis.pending + kpis.in_transit).toLocaleString()}
                 sub={`${inflightPct}% of pipeline`} tone="blue" />
            <KPI label="Inventory Units" value={kpis.inventory_total?.toLocaleString() || "0"}
                 sub={`${kpis.low_stock || 0} SKUs low`} tone="emerald" />
            <KPI label="Open Requests" value={(kpis.open_requests || 0).toLocaleString()}
                 sub="awaiting distributor" tone="amber" />
          </>
        )}
      </div>

      {/* Pipeline strip */}
      <Card className="mb-5"><CardContent className="p-5">
        <SectionTitle title="Shipment Pipeline" icon={Truck}
          right={<span className="text-[11px] text-slate-500">{totalShipments} shipments tracked</span>} />
        <div className="grid grid-cols-3 gap-3">
          <PipelineTile icon={CircleDashed} label="Pending" value={kpis.pending}
            total={totalShipments} tone="amber" />
          <PipelineTile icon={Send} label="In Transit" value={kpis.in_transit}
            total={totalShipments} tone="blue" />
          <PipelineTile icon={CheckCircle2} label="Received" value={kpis.received}
            total={totalShipments} tone="emerald" />
        </div>
      </CardContent></Card>

      {/* Shipment trend + status mix */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-5">
        <Card className="xl:col-span-2"><CardContent className="p-5">
          <SectionTitle title="Shipments · last 14 days" icon={Activity}
            right={<span className="text-[11px] text-slate-500">Daily volume</span>} />
          {timeline.every((t) => t.shipments === 0) ? (
            <Empty msg="No shipment activity in this window yet." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={timeline}>
                  <defs>
                    <linearGradient id="ships" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis dataKey="date" fontSize={10} stroke="#94a3b8" />
                  <YAxis allowDecimals={false} fontSize={10} stroke="#94a3b8" />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Area type="monotone" dataKey="shipments" stroke="#6366f1"
                    strokeWidth={2} fill="url(#ships)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <SectionTitle title="Status Mix" icon={Boxes} />
          {totalShipments === 0 ? <Empty msg="No shipments yet." /> : (
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={status_breakdown.filter((s) => s.value > 0)} dataKey="value"
                       nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
                    {status_breakdown.filter((s) => s.value > 0).map((s, i) => (
                      <Cell key={i} fill={STATUS_COLORS[s.name] || "#94a3b8"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>
      </div>

      {/* Top products + Network snapshot */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-5">
        <Card><CardContent className="p-5">
          <SectionTitle title="Top Products by Units Shipped" icon={Trophy} />
          {(!top_products || top_products.length === 0) ? <Empty /> : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={top_products} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" />
                  <XAxis type="number" fontSize={10} stroke="#94a3b8" allowDecimals={false} />
                  <YAxis type="category" dataKey="name" fontSize={11} stroke="#475569" width={130} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    formatter={(v) => [`${v} units`, "Volume"]} />
                  <Bar dataKey="units" radius={[0, 4, 4, 0]}>
                    {top_products.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent></Card>

        <Card><CardContent className="p-5">
          <SectionTitle title={isManufacturer ? "Network Snapshot" : "Inventory & Requests"}
            icon={isManufacturer ? Factory : Store}
            right={
              <Link to="/network" className="text-[11px] font-semibold text-indigo-600 hover:underline">
                View network →
              </Link>
            } />
          <div className="grid grid-cols-2 gap-3">
            {isManufacturer ? (
              <>
                <SnapshotTile icon={Factory} label="Distributors" value={kpis.distributors_count?.toLocaleString() || "0"} tone="indigo" />
                <SnapshotTile icon={Store} label="Retailers" value={kpis.retailers_count?.toLocaleString() || "0"} tone="blue" />
                <SnapshotTile icon={Boxes} label="Master Inventory" value={kpis.inventory_total?.toLocaleString() || "0"} tone="emerald" />
                <SnapshotTile icon={AlertTriangle} label="Low-Stock SKUs" value={(kpis.low_stock || 0).toLocaleString()}
                  tone={kpis.low_stock > 0 ? "rose" : "slate"} />
              </>
            ) : (
              <>
                <SnapshotTile icon={Boxes} label="Inventory Units" value={kpis.inventory_total?.toLocaleString() || "0"} tone="emerald" />
                <SnapshotTile icon={AlertTriangle} label="Low-Stock SKUs" value={(kpis.low_stock || 0).toLocaleString()}
                  tone={kpis.low_stock > 0 ? "rose" : "slate"} />
                <SnapshotTile icon={Send} label="Open Requests" value={(kpis.open_requests || 0).toLocaleString()} tone="amber" />
                <SnapshotTile icon={CheckCircle2} label="Fulfillment Rate" value={`${fulfillmentRate}%`} tone="indigo" />
              </>
            )}
          </div>
        </CardContent></Card>
      </div>
    </div>
  );
}

function PipelineTile({ icon: Icon, label, value, total, tone }) {
  const tones = {
    amber: { bg: "from-amber-50 to-white", border: "border-amber-100/80", text: "text-amber-600", bar: "from-amber-400 to-amber-500" },
    blue: { bg: "from-blue-50 to-white", border: "border-blue-100/80", text: "text-blue-600", bar: "from-blue-400 to-blue-500" },
    emerald: { bg: "from-emerald-50 to-white", border: "border-emerald-100/80", text: "text-emerald-600", bar: "from-emerald-400 to-emerald-500" },
  };
  const t = tones[tone] || tones.blue;
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={`rounded-2xl border ${t.border} bg-gradient-to-br ${t.bg} p-4`}>
      <div className="flex items-center justify-between">
        <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${t.text}`}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className="text-[11px] text-slate-500 tabular-nums">{pct}%</div>
      </div>
      <div className="text-[22px] font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
      <div className="h-1.5 rounded-full bg-white/70 overflow-hidden mt-2">
        <div className={`h-full rounded-full bg-gradient-to-r ${t.bar}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SnapshotTile({ icon: Icon, label, value, tone }) {
  const tones = {
    indigo: { bg: "from-indigo-50 to-white", text: "text-indigo-600" },
    blue: { bg: "from-blue-50 to-white", text: "text-blue-600" },
    emerald: { bg: "from-emerald-50 to-white", text: "text-emerald-600" },
    amber: { bg: "from-amber-50 to-white", text: "text-amber-600" },
    rose: { bg: "from-rose-50 to-white", text: "text-rose-600" },
    slate: { bg: "from-slate-50 to-white", text: "text-slate-500" },
  };
  const t = tones[tone] || tones.slate;
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${t.bg} p-3.5`}>
      <div className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider ${t.text}`}>
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="text-[19px] font-bold text-slate-900 mt-1 tabular-nums">{value}</div>
    </div>
  );
}

// ============ Shared bits ============
function SectionTitle({ title, right, icon: Icon, tone }) {
  const toneColors = { emerald: "text-emerald-600", amber: "text-amber-600", rose: "text-rose-600", indigo: "text-indigo-600" };
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500 font-semibold inline-flex items-center gap-1.5">
        {Icon && <Icon className={`h-3.5 w-3.5 ${toneColors[tone] || "text-slate-500"}`} />}
        {title}
      </div>
      {right}
    </div>
  );
}

function KPI({ label, value, sub, trend, trendLabel, tone = "slate" }) {
  const tones = { slate: "from-slate-50 to-white", emerald: "from-emerald-50 to-white",
                  indigo: "from-indigo-50 to-white", blue: "from-blue-50 to-white",
                  amber: "from-amber-50 to-white", rose: "from-rose-50 to-white" };
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-gradient-to-br ${tones[tone]} p-4`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10.5px] uppercase tracking-[0.16em] text-slate-500 font-semibold">{label}</div>
          <div className="text-[21px] font-bold text-slate-900 mt-1">{value}</div>
          {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
        </div>
        {typeof trend === "number" && <DeltaBadge value={trend} label={trendLabel} />}
      </div>
    </div>
  );
}

function DeltaBadge({ value, label }) {
  const positive = value >= 0;
  return (
    <div className={`inline-flex items-center gap-1 text-[11px] font-semibold ${positive ? "text-emerald-600" : "text-rose-600"}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? "+" : ""}{value}% {label}
    </div>
  );
}

function ProductList({ items, tone }) {
  if (!items || items.length === 0) return <Empty />;
  const max = Math.max(...items.map((p) => p.revenue), 1);
  const color = tone === "amber" ? "from-amber-400 to-amber-500" : "from-indigo-500 to-violet-500";
  return (
    <div className="space-y-2.5">
      {items.slice(0, 6).map((p, i) => (
        <div key={i}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="inline-flex items-center justify-center h-5 w-5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-semibold flex-shrink-0">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-[12.5px] font-medium text-slate-800 truncate flex items-center gap-1">
                  <Package className="h-3 w-3 text-slate-400" /> {p.name}
                </div>
                <div className="text-[10.5px] text-slate-500">{p.category} · {p.units} units</div>
              </div>
            </div>
            <span className="text-[12.5px] font-semibold tabular-nums flex-shrink-0 ml-2">{fmtMoney(p.revenue)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className={`h-full rounded-full bg-gradient-to-r ${color}`} style={{ width: `${(p.revenue / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RetailerList({ items, showGrowth }) {
  if (!items || items.length === 0) return <Empty />;
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map((r, i) => (
        <div key={i} className="flex items-center justify-between rounded-xl border border-slate-200/70 p-3 hover:bg-slate-50/60 transition-colors">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium text-slate-900 truncate">{r.name}</div>
            <div className="text-[10.5px] text-slate-500">{r.city || "—"}, {r.region || "—"} · {r.units} units</div>
          </div>
          <div className="text-right flex-shrink-0 ml-3">
            <div className="text-[12.5px] font-semibold text-slate-900 tabular-nums">{fmtMoney(r.revenue)}</div>
            {showGrowth && typeof r.growth_pct === "number" && (
              <div className={`text-[10.5px] font-semibold ${r.growth_pct >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {r.growth_pct >= 0 ? "+" : ""}{r.growth_pct}%
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Empty({ msg = "No data yet." }) {
  return <div className="text-[12.5px] text-slate-500 py-8 text-center">{msg}</div>;
}

function InsightCard({ insight }) {
  const Icon = INSIGHT_ICONS[insight.icon] || Info;
  const tones = {
    positive: { bg: "from-emerald-50 to-emerald-50/30", border: "border-emerald-100/80", text: "text-emerald-700" },
    warning: { bg: "from-amber-50 to-amber-50/30", border: "border-amber-100/80", text: "text-amber-700" },
    critical: { bg: "from-rose-50 to-rose-50/30", border: "border-rose-100/80", text: "text-rose-700" },
    info: { bg: "from-indigo-50 to-indigo-50/30", border: "border-indigo-100/80", text: "text-indigo-700" },
  };
  const t = tones[insight.tone] || tones.info;
  return (
    <div className={`rounded-2xl border ${t.border} bg-gradient-to-br ${t.bg} p-3.5`}>
      <div className={`inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${t.text}`}>
        <Icon className="h-3.5 w-3.5" /> {insight.tone === "info" ? "AI Insight" : insight.tone}
      </div>
      <div className="text-[13px] font-semibold text-slate-900 mt-1">{insight.title}</div>
      <div className="text-[11.5px] text-slate-600 mt-0.5 leading-relaxed">{insight.detail}</div>
    </div>
  );
}

function InsightRow({ insight }) {
  const Icon = INSIGHT_ICONS[insight.icon] || Info;
  const colors = { positive: "text-emerald-600", warning: "text-amber-600", critical: "text-rose-600", info: "text-indigo-600" };
  return (
    <div className="flex items-start gap-2">
      <Icon className={`h-4 w-4 mt-0.5 ${colors[insight.tone] || colors.info}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-slate-800">{insight.title}</div>
        <div className="text-[11.5px] text-slate-500">{insight.detail}</div>
      </div>
    </div>
  );
}
