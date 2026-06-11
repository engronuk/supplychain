import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import {
  PageHeader, KpiCard, fmtCurrency, fmtNumber, EmptyState,
} from "./wholesaler/ui";
import {
  Boxes, Activity, TrendingUp, TrendingDown, AlertTriangle, Users,
  Truck, Package, Sparkles, Wallet, ShoppingCart, Target, Gauge,
  ShieldCheck, Repeat, AlertCircle, Clock, Snowflake, FlaskConical,
  Calendar, LayoutGrid, Building2,
} from "lucide-react";

export default function WholesalerAnalytics() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wid) return;
    setLoading(true);
    WholesalerApi.analytics(wid).then(setData).finally(() => setLoading(false));
  }, [wid]);

  if (loading || !data) {
    return <div className="p-8 text-sm text-slate-500" data-testid="analytics-loading">Loading analytics…</div>;
  }

  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="wholesaler-analytics">
      <PageHeader
        title="Analytics"
        subtitle="Inventory · Distributors · Orders · Procurement · Demand Forecast — fully grounded in your live database."
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList data-testid="analytics-tabs" className="flex-wrap h-auto">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="inventory" data-testid="tab-inv">Inventory</TabsTrigger>
          <TabsTrigger value="distributors" data-testid="tab-dist">Distributors</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders-analytics">Orders</TabsTrigger>
          <TabsTrigger value="procurement" data-testid="tab-procurement">Procurement</TabsTrigger>
          <TabsTrigger value="forecast" data-testid="tab-forecast">Demand Forecast</TabsTrigger>
          <TabsTrigger value="control_tower" data-testid="tab-control-tower">Control Tower</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard testid="ov-inv-value" icon={Boxes} label="Inventory Value" value={fmtCurrency(data.inventory.total_value)} />
            <KpiCard testid="ov-inv-units" icon={Package} label="Inventory Units" value={fmtNumber(data.inventory.total_units)} />
            <KpiCard testid="ov-rev-30d" icon={Wallet} label="Revenue (30d)" value={fmtCurrency(data.orders.revenue_30d)} tone="positive"
                     hint={data.orders.revenue_growth_pct > 0 ? `▲ ${data.orders.revenue_growth_pct}%` : data.orders.revenue_growth_pct < 0 ? `▼ ${Math.abs(data.orders.revenue_growth_pct)}%` : "flat"} />
            <KpiCard testid="ov-fill-rate" icon={Activity} label="Fill Rate (90d)" value={`${data.orders.fill_rate_pct}%`}
                     tone={data.orders.fill_rate_pct >= 80 ? "positive" : data.orders.fill_rate_pct >= 50 ? "warning" : "alert"} />
            <KpiCard testid="ov-turnover" icon={TrendingUp} label="Inventory Turnover (90d)" value={`${data.inventory.turnover_90d}x`} />
            <KpiCard testid="ov-dos" icon={Activity} label="Days of Supply" value={data.inventory.days_of_supply || "—"} />
            <KpiCard testid="ov-active-dist" icon={Users} label="Active Distributors" value={fmtNumber(data.distributors.active_90d)} />
            <KpiCard testid="ov-po-lead" icon={Truck} label="Avg PO Lead Time"
                     value={data.procurement.avg_lead_hours != null ? `${data.procurement.avg_lead_hours}h` : "—"} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">90-Day Order Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {data.orders.trend_90d.length === 0 ? (
                <EmptyState title="No order activity yet" />
              ) : (
                <TrendChart rows={data.orders.trend_90d} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Inventory */}
        <TabsContent value="inventory" className="space-y-4">
          <InventoryAnalyticsCenter
            deep={data.inventory.deep || {}}
            legacy={data.inventory}
          />
        </TabsContent>

        {/* Distributors */}
        <TabsContent value="distributors" className="space-y-4">
          <DistributorAnalyticsCenter deep={data.distributors.deep || {}} />
        </TabsContent>

        {/* Orders */}
        <TabsContent value="orders" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard testid="ord-90d" icon={ShoppingCart} label="Orders (90d)" value={fmtNumber(data.orders.total_90d)} />
            <KpiCard testid="ord-30d" icon={ShoppingCart} label="Orders (30d)" value={fmtNumber(data.orders.total_30d)} />
            <KpiCard testid="ord-rev-30d" icon={Wallet} label="Revenue (30d)" value={fmtCurrency(data.orders.revenue_30d)}
                     tone={data.orders.revenue_growth_pct > 0 ? "positive" : data.orders.revenue_growth_pct < 0 ? "warning" : "default"}
                     hint={`${data.orders.revenue_growth_pct >= 0 ? "▲" : "▼"} ${Math.abs(data.orders.revenue_growth_pct)}% vs prev 30d`} />
            <KpiCard testid="ord-fill-rate" icon={Activity} label="Fill Rate (90d)" value={`${data.orders.fill_rate_pct}%`}
                     tone={data.orders.fill_rate_pct >= 80 ? "positive" : data.orders.fill_rate_pct >= 50 ? "warning" : "alert"} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">90-Day Order Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {data.orders.trend_90d.length === 0 ? (
                <EmptyState title="No order activity yet" />
              ) : (
                <TrendChart rows={data.orders.trend_90d} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Status Distribution</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(data.orders.status_distribution).map(([s, n]) => (
                <div key={s} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs uppercase tracking-wider text-slate-500">{s}</div>
                  <div className="text-xl font-semibold mt-1">{fmtNumber(n)}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Procurement */}
        <TabsContent value="procurement" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard testid="proc-open" icon={ShoppingCart} label="Open POs" value={fmtNumber(data.procurement.pos_open)} tone="warning" />
            <KpiCard testid="proc-total" icon={ShoppingCart} label="Total POs" value={fmtNumber(data.procurement.pos_total)} />
            <KpiCard testid="proc-lead" icon={Truck} label="Avg Lead Time"
                     value={data.procurement.avg_lead_hours != null ? `${data.procurement.avg_lead_hours}h` : "—"} />
            <KpiCard testid="proc-suppliers" icon={Users} label="Active Suppliers" value={fmtNumber(data.procurement.supplier_performance.length)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Supplier Performance</CardTitle>
            </CardHeader>
            <CardContent>
              {data.procurement.supplier_performance.length === 0 ? (
                <EmptyState title="No supplier data yet" />
              ) : (
                <table className="w-full text-sm" data-testid="supplier-perf-table">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b">
                      <th className="py-2 px-3 font-medium">Supplier</th>
                      <th className="py-2 px-3 font-medium">Type</th>
                      <th className="py-2 px-3 font-medium text-right">POs</th>
                      <th className="py-2 px-3 font-medium text-right">PO Value</th>
                      <th className="py-2 px-3 font-medium text-right">Fill Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.procurement.supplier_performance.map((s) => (
                      <tr key={s.supplier_id} className="border-b border-slate-100">
                        <td className="py-2 px-3 font-medium">{s.supplier_name}</td>
                        <td className="py-2 px-3 text-xs text-slate-500">{s.supplier_type}</td>
                        <td className="py-2 px-3 text-right">{fmtNumber(s.po_count)}</td>
                        <td className="py-2 px-3 text-right">{fmtCurrency(s.po_value)}</td>
                        <td className="py-2 px-3 text-right">
                          <Badge className={s.fill_rate_pct >= 80 ? "bg-emerald-100 text-emerald-700"
                                : s.fill_rate_pct >= 50 ? "bg-amber-100 text-amber-700"
                                : "bg-rose-100 text-rose-700"}>{s.fill_rate_pct}%</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Demand Forecast */}
        <TabsContent value="forecast" className="space-y-4">
          <ForecastCenter
            deep={data.demand_forecast.deep || {}}
            legacy={data.demand_forecast}
          />
        </TabsContent>

        {/* Control Tower */}
        <TabsContent value="control_tower" className="space-y-4">
          <ControlTower control={data.control_tower || {}} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ABCRow({ label, count, tone }) {
  const cls = tone === "positive" ? "bg-emerald-500"
            : tone === "warning" ? "bg-amber-500" : "bg-slate-400";
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium text-slate-800">{count} SKUs</span>
      </div>
      <div className="mt-1 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${cls}`} style={{ width: `${Math.min(100, count * 10)}%` }} />
      </div>
    </div>
  );
}

function SkuMiniList({ rows, emptyLabel, testid, valueKey, valuePrefix = "", valueSuffix = "" }) {
  if (!rows || rows.length === 0) return <EmptyState title={emptyLabel} />;
  return (
    <div className="space-y-2" data-testid={testid}>
      {rows.map((r) => (
        <div key={r.product_id} className="flex justify-between items-center text-sm">
          <div className="min-w-0">
            <div className="font-medium text-slate-800 truncate">{r.product_name}</div>
            <div className="text-xs text-slate-500">{r.sku || "—"} · {fmtNumber(r.on_hand)} on hand</div>
          </div>
          <div className="text-sm font-medium text-slate-700">
            {valuePrefix}{typeof r[valueKey] === "number" ? r[valueKey].toLocaleString() : r[valueKey]}{valueSuffix}
          </div>
        </div>
      ))}
    </div>
  );
}

function DistTable({ rows, emptyLabel, testid, showGrowth = false }) {
  if (!rows || rows.length === 0) return <EmptyState title={emptyLabel} />;
  return (
    <table className="w-full text-sm" data-testid={testid}>
      <thead>
        <tr className="text-left text-xs text-slate-500 border-b">
          <th className="py-2 px-3 font-medium">Distributor</th>
          <th className="py-2 px-3 font-medium">Region</th>
          <th className="py-2 px-3 font-medium text-right">Orders</th>
          <th className="py-2 px-3 font-medium text-right">Revenue</th>
          {showGrowth && <th className="py-2 px-3 font-medium text-right">Growth</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-slate-100">
            <td className="py-2 px-3 font-medium">{r.name}</td>
            <td className="py-2 px-3 text-slate-500">{r.region}</td>
            <td className="py-2 px-3 text-right">{fmtNumber(r.orders)}</td>
            <td className="py-2 px-3 text-right">{fmtCurrency(r.revenue)}</td>
            {showGrowth && (
              <td className="py-2 px-3 text-right">
                <Badge className={
                  r.growth_pct > 10 ? "bg-emerald-100 text-emerald-700"
                  : r.growth_pct < 0 ? "bg-rose-100 text-rose-700"
                  : "bg-slate-100 text-slate-700"
                }>
                  {r.growth_pct > 0 ? "+" : ""}{r.growth_pct}%
                </Badge>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TrendChart({ rows }) {
  const maxOrders = Math.max(...rows.map((r) => r.orders), 1);
  const maxRevenue = Math.max(...rows.map((r) => r.revenue), 1);
  return (
    <div>
      <div className="flex items-end gap-1 h-32" data-testid="orders-trend-chart">
        {rows.map((r) => (
          <div
            key={r.date}
            className="flex-1 flex flex-col items-center justify-end relative group"
            title={`${r.date}: ${r.orders} orders · ${fmtCurrency(r.revenue)}`}
          >
            <div
              className="w-full bg-violet-500 hover:bg-violet-600 rounded-t transition-colors"
              style={{ height: `${(r.orders / maxOrders) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 mt-2">
        <span>{rows[0]?.date}</span>
        <span>{rows[Math.floor(rows.length / 2)]?.date}</span>
        <span>{rows[rows.length - 1]?.date}</span>
      </div>
    </div>
  );
}


/* =========================================================================
 * Distributor Analytics Center (Phase 3A) — KPI strip + Ranking + BCG
 * matrix + Churn risk + 6-month trend. Pure operational math (no AI).
 * ======================================================================= */

const STATUS_META = {
  high_growth: { label: "High Growth", dot: "bg-emerald-500", text: "text-emerald-700",
                  pill: "bg-emerald-50 ring-emerald-200" },
  stable:      { label: "Stable",      dot: "bg-amber-500",   text: "text-amber-700",
                  pill: "bg-amber-50 ring-amber-200" },
  at_risk:     { label: "At Risk",     dot: "bg-rose-500",    text: "text-rose-700",
                  pill: "bg-rose-50 ring-rose-200" },
};

const CHURN_META = {
  low:    { label: "Low",    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  medium: { label: "Medium", pill: "bg-amber-50 text-amber-700 ring-amber-200" },
  high:   { label: "High",   pill: "bg-rose-50 text-rose-700 ring-rose-200" },
};

function DistributorAnalyticsCenter({ deep }) {
  const k = deep.kpis || {};
  const ranking = deep.ranking || [];
  const churn = deep.churn || [];
  const bcg = deep.bcg || { items: [] };
  const trendMonths = deep.trend_months || [];
  const monthly = deep.monthly_purchases || {};

  if ((ranking || []).length === 0) {
    return <EmptyState title="No distributor activity yet" />;
  }

  return (
    <div className="space-y-4" data-testid="distributor-analytics-center">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard testid="dac-active" icon={Users}      label="Active Distributors"
                 value={fmtNumber(k.active_distributors)} />
        <KpiCard testid="dac-revenue" icon={Wallet}    label="Revenue (90d)"
                 value={fmtCurrency(k.total_revenue)} tone="positive" />
        <KpiCard testid="dac-aov"     icon={ShoppingCart} label="Avg Order Value"
                 value={fmtCurrency(k.average_order_value)} />
        <KpiCard testid="dac-freq"    icon={Repeat}    label="Avg Order Frequency"
                 value={`${k.average_order_frequency || 0}/wk`} />
        <KpiCard testid="dac-fill"    icon={Activity}  label="Fill Rate"
                 value={`${k.fill_rate_pct || 0}%`}
                 tone={(k.fill_rate_pct || 0) >= 80 ? "positive"
                        : (k.fill_rate_pct || 0) >= 50 ? "warning" : "alert"} />
        <KpiCard testid="dac-service" icon={ShieldCheck} label="Service Level"
                 value={`${k.service_level_pct || 0}%`}
                 tone={(k.service_level_pct || 0) >= 80 ? "positive"
                        : (k.service_level_pct || 0) >= 50 ? "warning" : "alert"} />
      </div>

      {/* Status mix */}
      <div className="grid grid-cols-3 gap-3">
        <StatusTile testid="dac-status-high" tint="emerald" Icon={TrendingUp}
                    label="High Growth" count={k.high_growth} />
        <StatusTile testid="dac-status-stable" tint="amber" Icon={Gauge}
                    label="Stable" count={k.stable} />
        <StatusTile testid="dac-status-risk" tint="rose" Icon={AlertTriangle}
                    label="At Risk" count={k.at_risk} />
      </div>

      {/* Ranking + Churn side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-indigo-600" /> Distributor Ranking
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DistributorRankingTable rows={ranking} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600" /> Churn Risk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3" data-testid="dac-churn-list">
            {churn.slice(0, 8).map((c) => (
              <ChurnRow key={c.id} c={c} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* BCG matrix */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" /> Distributor BCG Matrix
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BcgMatrix items={bcg.items}
                     revThreshold={bcg.rev_threshold}
                     growthThreshold={bcg.growth_threshold} />
        </CardContent>
      </Card>

      {/* 6-month trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-600" /> 6-Month Distributor Purchases
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MonthlyTrendChart months={trendMonths} values={monthly} />
        </CardContent>
      </Card>
    </div>
  );
}

function StatusTile({ testid, tint, Icon, label, count }) {
  const cls = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
  }[tint];
  return (
    <div className={`rounded-lg border ring-1 ${cls} p-3 flex items-center gap-3`}
         data-testid={testid}>
      <Icon className="h-5 w-5" />
      <div className="flex-1">
        <div className="text-[11px] uppercase tracking-wider font-medium opacity-80">{label}</div>
        <div className="text-2xl font-bold leading-none mt-1">{count ?? 0}</div>
      </div>
    </div>
  );
}

function DistributorRankingTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="dac-ranking-table">
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-medium py-2">Distributor</th>
            <th className="text-left font-medium py-2">Region</th>
            <th className="text-right font-medium py-2">Revenue</th>
            <th className="text-right font-medium py-2">Orders</th>
            <th className="text-right font-medium py-2">Fill %</th>
            <th className="text-right font-medium py-2">Growth %</th>
            <th className="text-left font-medium py-2 pl-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((r) => {
            const s = STATUS_META[r.status] || STATUS_META.stable;
            return (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50"
                  data-testid={`dac-rank-${r.id}`}>
                <td className="py-2 pr-2 text-slate-800 font-medium">{r.name}</td>
                <td className="py-2 text-slate-600">{r.region || "—"}</td>
                <td className="py-2 text-right text-slate-800">{fmtCurrency(r.revenue)}</td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(r.orders)}</td>
                <td className="py-2 text-right text-slate-700">
                  {r.fill_rate_pct != null ? `${r.fill_rate_pct}%` : "—"}
                </td>
                <td className={`py-2 text-right font-medium ${
                  r.growth_pct > 0 ? "text-emerald-700" :
                  r.growth_pct < 0 ? "text-rose-700" : "text-slate-600"}`}>
                  {r.growth_pct > 0 ? "▲" : r.growth_pct < 0 ? "▼" : ""}{" "}
                  {Math.abs(r.growth_pct).toFixed(1)}%
                </td>
                <td className="py-2 pl-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ring-1 text-xs ${s.pill} ${s.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    {s.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChurnRow({ c }) {
  const m = CHURN_META[c.level] || CHURN_META.low;
  return (
    <div className="border-l-2 pl-3 py-1.5"
         style={{ borderColor: c.level === "high" ? "#f43f5e"
                  : c.level === "medium" ? "#f59e0b" : "#10b981" }}
         data-testid={`dac-churn-${c.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-800 truncate">{c.name}</div>
        <span className={`shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ring-1 ${m.pill}`}>
          {m.label} · {c.score}
        </span>
      </div>
      <ul className="text-xs text-slate-600 mt-1 space-y-0.5">
        {(c.reasons || []).slice(0, 2).map((r, i) => (
          <li key={i}>• {r}</li>
        ))}
      </ul>
    </div>
  );
}

const QUAD_META = {
  star:           { label: "Stars",         color: "bg-emerald-500",
                     pill: "bg-emerald-50 text-emerald-700" },
  cash_cow:       { label: "Cash Cows",     color: "bg-indigo-500",
                     pill: "bg-indigo-50 text-indigo-700" },
  question_mark:  { label: "Question Marks", color: "bg-amber-500",
                     pill: "bg-amber-50 text-amber-700" },
  at_risk:        { label: "At Risk",       color: "bg-rose-500",
                     pill: "bg-rose-50 text-rose-700" },
};

function BcgMatrix({ items, revThreshold, growthThreshold }) {
  if (!items || items.length === 0) {
    return <EmptyState title="No distributor data for matrix" />;
  }

  // Normalise to plot range.
  const maxShare = Math.max(...items.map((i) => i.revenue_share_pct), revThreshold * 2, 5);
  const minGrowth = Math.min(...items.map((i) => i.growth_pct), growthThreshold - 25, -25);
  const maxGrowth = Math.max(...items.map((i) => i.growth_pct), growthThreshold + 25, 25);
  const growthRange = (maxGrowth - minGrowth) || 1;

  const xFor = (share) => Math.min(98, Math.max(2, (share / maxShare) * 96 + 2));
  const yFor = (g) => Math.min(98, Math.max(2, 98 - ((g - minGrowth) / growthRange) * 96));

  const xLine = xFor(revThreshold);
  const yLine = yFor(growthThreshold);

  const counts = items.reduce((acc, i) => {
    acc[i.quadrant] = (acc[i.quadrant] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-3" data-testid="dac-bcg-matrix">
      <div className="relative w-full h-72 md:h-80 bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
        {/* Axes */}
        <div className="absolute bg-slate-300" style={{ left: `${xLine}%`, top: 0, bottom: 0, width: 1 }} />
        <div className="absolute bg-slate-300" style={{ top: `${yLine}%`, left: 0, right: 0, height: 1 }} />
        {/* Quadrant labels */}
        <div className="absolute top-2 right-3 text-[11px] font-medium text-emerald-600">★ Stars</div>
        <div className="absolute bottom-2 right-3 text-[11px] font-medium text-indigo-600">Cash Cows</div>
        <div className="absolute top-2 left-3 text-[11px] font-medium text-amber-600">? Question Marks</div>
        <div className="absolute bottom-2 left-3 text-[11px] font-medium text-rose-600">At Risk</div>
        {/* Bubbles */}
        {items.map((it) => {
          const m = QUAD_META[it.quadrant] || QUAD_META.at_risk;
          const size = Math.max(8, Math.min(28, Math.sqrt(Math.max(it.revenue, 1)) / 80));
          return (
            <div key={it.id}
                 className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white ${m.color} shadow-sm hover:scale-125 transition cursor-help`}
                 style={{
                   left: `${xFor(it.revenue_share_pct)}%`,
                   top: `${yFor(it.growth_pct)}%`,
                   width: `${size}px`, height: `${size}px`,
                 }}
                 title={`${it.name} · ${it.region}\nRevenue share: ${it.revenue_share_pct}%\nGrowth: ${it.growth_pct.toFixed(1)}%`}
                 data-testid={`dac-bcg-bubble-${it.id}`}
            />
          );
        })}
        {/* Axis labels */}
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-slate-500 bg-white px-1">
          Revenue Share % →
        </div>
        <div className="absolute top-1/2 -left-1 -translate-y-1/2 text-[10px] text-slate-500 bg-white px-1 -rotate-90 origin-top-left">
          Growth % ↑
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        {Object.entries(QUAD_META).map(([k, m]) => (
          <div key={k} className={`px-2 py-1.5 rounded ${m.pill} flex items-center justify-between`}>
            <span className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${m.color}`} />
              {m.label}
            </span>
            <span className="font-semibold" data-testid={`dac-bcg-count-${k}`}>{counts[k] || 0}</span>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-slate-500">
        Thresholds — Revenue share: {(revThreshold || 0).toFixed(1)}%  ·  Growth: {(growthThreshold || 0).toFixed(1)}%
      </div>
    </div>
  );
}

function MonthlyTrendChart({ months, values }) {
  if (!months || months.length === 0) {
    return <EmptyState title="No monthly trend data" />;
  }
  const vals = months.map((m) => values[m] || 0);
  const max = Math.max(...vals, 1);
  return (
    <div data-testid="dac-monthly-trend">
      <div className="flex items-end gap-3 h-32 px-2">
        {months.map((m, idx) => {
          const h = (vals[idx] / max) * 100;
          return (
            <div key={m} className="flex-1 flex flex-col items-center justify-end gap-1"
                 title={`${m}: ${fmtCurrency(vals[idx])}`}>
              <div className="w-full bg-indigo-500 hover:bg-indigo-600 rounded-t transition-colors"
                   style={{ height: `${h}%` }} />
              <div className="text-[10px] text-slate-500">{m.slice(5)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================================
 * Inventory Analytics Center (Phase 3B) — pure operational math.
 * ======================================================================= */

const DOS_META = {
  green:  { label: "Healthy",  pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  yellow: { label: "Watch",    pill: "bg-amber-50 text-amber-700 ring-amber-200",       dot: "bg-amber-500" },
  red:    { label: "Critical", pill: "bg-rose-50 text-rose-700 ring-rose-200",          dot: "bg-rose-500" },
  unknown:{ label: "No data",  pill: "bg-slate-100 text-slate-600 ring-slate-200",      dot: "bg-slate-400" },
};

const AGE_META = {
  "0_30":   { label: "0–30 days",  tint: "emerald" },
  "31_60":  { label: "31–60 days", tint: "amber" },
  "61_90":  { label: "61–90 days", tint: "orange" },
  "over_90":{ label: "90+ days",   tint: "rose" },
};

const DEAD_META = {
  dead_30: { label: "Stale 30+ days",  tint: "amber" },
  dead_60: { label: "Stale 60+ days",  tint: "orange" },
  dead_90: { label: "Dead 90+ days",   tint: "rose" },
};

const EXPIRY_META = {
  expired: { label: "Expired",       tint: "rose" },
  exp_30:  { label: "Expires ≤ 30d", tint: "rose" },
  exp_60:  { label: "Expires ≤ 60d", tint: "orange" },
  exp_90:  { label: "Expires ≤ 90d", tint: "amber" },
};

function InventoryAnalyticsCenter({ deep, legacy }) {
  const k = deep.kpis || {};
  const dos = deep.days_of_supply || { items: [], green: 0, yellow: 0, red: 0 };
  const aging = deep.aging || { buckets: {}, value_by_bucket: {} };
  const dead = deep.dead_stock || { buckets: {}, value_by_bucket: {}, items: [] };
  const expiry = deep.expiry || { buckets: {}, value_by_bucket: {}, items: [] };
  const byCategory = deep.turnover_by_category || [];
  const byWarehouse = deep.turnover_by_warehouse || [];

  if (!legacy || (legacy.total_units === 0 && (dos.items || []).length === 0)) {
    return <EmptyState title="No inventory on hand" />;
  }

  return (
    <div className="space-y-4" data-testid="inventory-analytics-center">
      {/* Top KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard testid="iac-value"     icon={Wallet}        label="Inventory Value"
                 value={fmtCurrency(k.inventory_value)} tone="positive" />
        <KpiCard testid="iac-turnover"  icon={Repeat}        label="Turnover / yr"
                 value={`${k.turnover_per_year || 0}x`} />
        <KpiCard testid="iac-dos"       icon={Calendar}      label="Avg Days of Supply"
                 value={k.avg_days_of_supply != null ? `${k.avg_days_of_supply}d` : "—"}
                 tone={(k.avg_days_of_supply || 0) >= 21 ? "positive"
                        : (k.avg_days_of_supply || 0) >= 7 ? "warning" : "alert"} />
        <KpiCard testid="iac-coverage"  icon={ShieldCheck}   label="Stock Coverage"
                 value={`${k.stock_coverage_pct || 0}%`}
                 tone={(k.stock_coverage_pct || 0) >= 80 ? "positive"
                        : (k.stock_coverage_pct || 0) >= 50 ? "warning" : "alert"} />
        <KpiCard testid="iac-stockout"  icon={AlertTriangle} label="Stockout Risk"
                 value={fmtNumber(k.stockout_risk_count || 0)}
                 tone={(k.stockout_risk_count || 0) === 0 ? "positive" : "alert"} />
        <KpiCard testid="iac-expiring"  icon={Snowflake}     label="Expiring Value (60d)"
                 value={fmtCurrency(k.expiring_value_60d)}
                 tone={(k.expiring_value_60d || 0) > 0 ? "warning" : "default"} />
      </div>

      {/* Days of Supply band breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="h-4 w-4 text-indigo-600" /> Days of Supply
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm" data-testid="iac-dos-bands">
            <DosBandRow band="green"  count={dos.green}  total={dos.green + dos.yellow + dos.red} />
            <DosBandRow band="yellow" count={dos.yellow} total={dos.green + dos.yellow + dos.red} />
            <DosBandRow band="red"    count={dos.red}    total={dos.green + dos.yellow + dos.red} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="h-4 w-4 text-rose-600" /> Critical Stock — Lowest Days of Supply
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DosProductTable items={(dos.items || []).slice(0, 8)} />
          </CardContent>
        </Card>
      </div>

      {/* Turnover by Category + Warehouse */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-indigo-600" /> Turnover by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TurnoverList rows={byCategory} labelKey="category" testid="iac-by-category" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Building2 className="h-4 w-4 text-indigo-600" /> Turnover by Warehouse
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TurnoverList rows={byWarehouse} labelKey="warehouse_name" testid="iac-by-warehouse" />
          </CardContent>
        </Card>
      </div>

      {/* Aging */}
      <Card data-testid="iac-aging">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-indigo-600" /> Inventory Aging
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BucketStrip
            entries={Object.entries(AGE_META).map(([key, meta]) => ({
              key,
              label: meta.label,
              tint: meta.tint,
              count: aging.buckets?.[key] || 0,
              value: aging.value_by_bucket?.[key] || 0,
            }))}
            testidPrefix="iac-age"
          />
        </CardContent>
      </Card>

      {/* Dead stock */}
      <Card data-testid="iac-dead-stock">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600" /> Dead Stock Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <BucketStrip
            entries={Object.entries(DEAD_META).map(([key, meta]) => ({
              key,
              label: meta.label,
              tint: meta.tint,
              count: dead.buckets?.[key] || 0,
              value: dead.value_by_bucket?.[key] || 0,
            }))}
            testidPrefix="iac-dead"
          />
          {(dead.items || []).length > 0 ? (
            <RiskProductTable items={dead.items.slice(0, 8)} riskKey="days_since_movement" riskLabel="Idle days" />
          ) : (
            <EmptyState title="No dead stock detected" />
          )}
        </CardContent>
      </Card>

      {/* Expiry Risk */}
      <Card data-testid="iac-expiry">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-rose-600" /> Expiry Risk Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <BucketStrip
            entries={Object.entries(EXPIRY_META).map(([key, meta]) => ({
              key,
              label: meta.label,
              tint: meta.tint,
              count: expiry.buckets?.[key] || 0,
              value: expiry.value_by_bucket?.[key] || 0,
            }))}
            testidPrefix="iac-exp"
          />
          {(expiry.items || []).length > 0 ? (
            <RiskProductTable items={expiry.items.slice(0, 8)} riskKey="days_to_expiry" riskLabel="Days to expiry" />
          ) : (
            <EmptyState title="No SKUs flagged for expiry in the next 90 days" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DosBandRow({ band, count, total }) {
  const m = DOS_META[band];
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" data-testid={`iac-dos-${band}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${m.dot}`} />
      <span className="text-slate-700 flex-1">{m.label}</span>
      <span className="font-semibold text-slate-800">{count}</span>
      <span className="text-xs text-slate-500 w-12 text-right">{pct}%</span>
    </div>
  );
}

function DosProductTable({ items }) {
  if (items.length === 0) {
    return <EmptyState title="All SKUs are healthy" />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="iac-dos-table">
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-medium py-2">Product</th>
            <th className="text-right font-medium py-2">Available</th>
            <th className="text-right font-medium py-2">Velocity/day</th>
            <th className="text-right font-medium py-2">DoS</th>
            <th className="text-left font-medium py-2 pl-3">Band</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const m = DOS_META[it.dos_band] || DOS_META.unknown;
            return (
              <tr key={it.product_id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="py-2 pr-2 text-slate-800 font-medium">{it.product_name}</td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(it.available)}</td>
                <td className="py-2 text-right text-slate-700">{(it.velocity || 0).toFixed(1)}</td>
                <td className="py-2 text-right font-medium text-slate-800">
                  {it.days_of_supply != null ? `${it.days_of_supply}d` : "—"}
                </td>
                <td className="py-2 pl-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ring-1 text-xs ${m.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                    {m.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TurnoverList({ rows, labelKey, testid }) {
  if (!rows || rows.length === 0) {
    return <EmptyState title="No turnover data" />;
  }
  const max = Math.max(...rows.map((r) => r.turnover_per_year || 0), 1);
  return (
    <div className="space-y-2" data-testid={testid}>
      {rows.map((r, idx) => (
        <div key={r[labelKey] + idx} className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-700 truncate">{r[labelKey] || "—"}</span>
            <span className="text-slate-800 font-medium">{r.turnover_per_year || 0}x</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500"
                 style={{ width: `${Math.min(100, ((r.turnover_per_year || 0) / max) * 100)}%` }} />
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 mt-0.5">
            <span>{fmtCurrency(r.value)}</span>
            <span>{fmtNumber(r.on_hand)} units</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function BucketStrip({ entries, testidPrefix }) {
  const TINT = {
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-700",
    amber: "bg-amber-50 ring-amber-200 text-amber-700",
    orange: "bg-orange-50 ring-orange-200 text-orange-700",
    rose: "bg-rose-50 ring-rose-200 text-rose-700",
  };
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {entries.map((e) => (
        <div key={e.key}
             className={`rounded-lg border ring-1 ${TINT[e.tint] || TINT.amber} p-3`}
             data-testid={`${testidPrefix}-${e.key}`}>
          <div className="text-[10px] uppercase tracking-wider font-medium opacity-75">
            {e.label}
          </div>
          <div className="flex items-baseline justify-between mt-1">
            <div className="text-xl font-bold">{e.count}</div>
            <div className="text-xs opacity-80">{fmtCurrency(e.value)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RiskProductTable({ items, riskKey, riskLabel }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-medium py-2">Product</th>
            <th className="text-left font-medium py-2">Category</th>
            <th className="text-right font-medium py-2">On Hand</th>
            <th className="text-right font-medium py-2">Value</th>
            <th className="text-right font-medium py-2">{riskLabel}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.product_id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="py-2 pr-2 text-slate-800 font-medium">{it.product_name}</td>
              <td className="py-2 text-slate-600">{it.category}</td>
              <td className="py-2 text-right text-slate-700">{fmtNumber(it.on_hand)}</td>
              <td className="py-2 text-right text-slate-800">{fmtCurrency(it.value)}</td>
              <td className="py-2 text-right text-rose-700 font-medium">
                {it[riskKey] != null ? `${it[riskKey]}d` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


/* =========================================================================
 * Forecast Center + Replenishment Intelligence (Phase 3C) — pure math.
 * ======================================================================= */

const PRIORITY_META = {
  urgent: { label: "Urgent",     pill: "bg-rose-50 text-rose-700 ring-rose-200",     dot: "bg-rose-500"    },
  soon:   { label: "Soon",       pill: "bg-amber-50 text-amber-700 ring-amber-200",   dot: "bg-amber-500"   },
  plan:   { label: "Plan",       pill: "bg-indigo-50 text-indigo-700 ring-indigo-200", dot: "bg-indigo-500" },
};

const SAFETY_META = {
  ok:      { label: "OK",      pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  warn:    { label: "Watch",   pill: "bg-amber-50 text-amber-700 ring-amber-200",       dot: "bg-amber-500"   },
  breach:  { label: "Breach",  pill: "bg-rose-50 text-rose-700 ring-rose-200",          dot: "bg-rose-500"    },
  unknown: { label: "No data", pill: "bg-slate-100 text-slate-600 ring-slate-200",      dot: "bg-slate-400"   },
};

const RISK_META = {
  low:    { label: "Low",    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  medium: { label: "Medium", pill: "bg-amber-50 text-amber-700 ring-amber-200" },
  high:   { label: "High",   pill: "bg-rose-50 text-rose-700 ring-rose-200" },
};

function ForecastCenter({ deep, legacy }) {
  const k = deep.kpis || {};
  const products = deep.products || [];
  const regional = deep.regional || [];
  const distributorFcst = deep.distributors || [];
  const replenishment = deep.replenishment || [];
  const safety = deep.safety || [];

  if (products.length === 0 && (legacy?.rows || []).length === 0) {
    return <EmptyState title="No velocity data yet"
                       body="Forecast becomes available after 30 days of orders." />;
  }

  return (
    <div className="space-y-4" data-testid="forecast-center">
      {/* Forecast KPIs (3 horizons + safety + replenishment) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard testid="fc-demand-7d"  icon={Sparkles}      label="7-day Demand"
                 value={fmtNumber(k.total_projected_demand_7d)} />
        <KpiCard testid="fc-demand-30d" icon={Sparkles}      label="30-day Demand"
                 value={fmtNumber(k.total_projected_demand_30d)} />
        <KpiCard testid="fc-demand-90d" icon={Sparkles}      label="90-day Demand"
                 value={fmtNumber(k.total_projected_demand_90d)} />
        <KpiCard testid="fc-revenue"    icon={Wallet}        label="Proj. Revenue (30d)"
                 value={fmtCurrency(k.total_projected_revenue_30d)} tone="positive" />
        <KpiCard testid="fc-urgent"     icon={AlertTriangle} label="Urgent Replenishments"
                 value={fmtNumber(k.urgent_replenishments)}
                 tone={(k.urgent_replenishments || 0) > 0 ? "alert" : "positive"} />
        <KpiCard testid="fc-safety-breach" icon={ShieldCheck} label="Safety Breaches"
                 value={fmtNumber(k.safety_stock_breaches)}
                 tone={(k.safety_stock_breaches || 0) > 0 ? "alert" : "positive"} />
      </div>

      {/* Product forecast table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" /> Product Demand Forecast — 7 / 30 / 90 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ProductForecastTable rows={products} />
        </CardContent>
      </Card>

      {/* Regional + Distributor side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-indigo-600" /> Regional Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <RegionalForecastTable rows={regional} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-600" /> Distributor Demand Forecast
            </CardTitle>
          </CardHeader>
          <CardContent>
            <DistributorForecastTable rows={distributorFcst} />
          </CardContent>
        </Card>
      </div>

      {/* Replenishment Recommendations */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" /> Replenishment Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ReplenishmentList rows={replenishment} />
        </CardContent>
      </Card>

      {/* Safety Stock Monitoring */}
      <Card data-testid="fc-safety">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Safety Stock Monitoring
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SafetyStockTable rows={safety} />
        </CardContent>
      </Card>
    </div>
  );
}

function ProductForecastTable({ rows }) {
  if (!rows.length) return <EmptyState title="No products in forecast" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="fc-products-table">
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-medium py-2">Product</th>
            <th className="text-right font-medium py-2">This Week</th>
            <th className="text-right font-medium py-2">Growth</th>
            <th className="text-right font-medium py-2">7d</th>
            <th className="text-right font-medium py-2">30d</th>
            <th className="text-right font-medium py-2">90d</th>
            <th className="text-right font-medium py-2">On Hand</th>
            <th className="text-right font-medium py-2">Cover</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 15).map((r) => {
            const coverTone = r.days_of_cover == null ? "bg-slate-100 text-slate-600"
              : r.days_of_cover < 7 ? "bg-rose-100 text-rose-700"
              : r.days_of_cover < 14 ? "bg-amber-100 text-amber-700"
              : "bg-emerald-100 text-emerald-700";
            return (
              <tr key={r.product_id} className="border-t border-slate-100 hover:bg-slate-50"
                  data-testid={`fc-product-${r.product_id}`}>
                <td className="py-2 pr-2 text-slate-800 font-medium">{r.product_name}</td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(r.current_weekly_demand)}</td>
                <td className={`py-2 text-right font-medium ${
                  r.growth_pct > 0 ? "text-emerald-700" : r.growth_pct < 0 ? "text-rose-700" : "text-slate-600"}`}>
                  {r.growth_pct > 0 ? "▲" : r.growth_pct < 0 ? "▼" : ""} {Math.abs(r.growth_pct).toFixed(1)}%
                </td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(r.projected_7d)}</td>
                <td className="py-2 text-right text-slate-800 font-medium">{fmtNumber(r.projected_30d)}</td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(r.projected_90d)}</td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(r.on_hand)}</td>
                <td className="py-2 text-right">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${coverTone}`}>
                    {r.days_of_cover != null ? `${r.days_of_cover}d` : "—"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RegionalForecastTable({ rows }) {
  if (!rows.length) return <EmptyState title="No regional data" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="fc-regional-table">
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-medium py-2">Region</th>
            <th className="text-right font-medium py-2">Orders (30d)</th>
            <th className="text-right font-medium py-2">Revenue</th>
            <th className="text-right font-medium py-2">Growth</th>
            <th className="text-left font-medium py-2 pl-3">Risk</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = RISK_META[r.risk_level] || RISK_META.low;
            return (
              <tr key={r.region} className="border-t border-slate-100">
                <td className="py-2 pr-2 text-slate-800 font-medium">{r.region}</td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(r.orders_30d)}</td>
                <td className="py-2 text-right text-slate-800">{fmtCurrency(r.revenue_30d)}</td>
                <td className={`py-2 text-right font-medium ${
                  r.growth_pct > 0 ? "text-emerald-700" : r.growth_pct < 0 ? "text-rose-700" : "text-slate-600"}`}>
                  {Math.abs(r.growth_pct).toFixed(1)}%
                </td>
                <td className="py-2 pl-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full ring-1 text-xs ${m.pill}`}>
                    {m.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DistributorForecastTable({ rows }) {
  if (!rows.length) return <EmptyState title="No distributor data" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="fc-distributors-table">
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-medium py-2">Distributor</th>
            <th className="text-right font-medium py-2">Exp. Orders</th>
            <th className="text-right font-medium py-2">Exp. Revenue</th>
            <th className="text-right font-medium py-2">Next Replen.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.distributor_id} className="border-t border-slate-100">
              <td className="py-2 pr-2 text-slate-800 font-medium">{r.name}
                <span className="text-xs text-slate-500 ml-1">· {r.region}</span>
              </td>
              <td className="py-2 text-right text-slate-700">{fmtNumber(r.expected_orders_next_30d)}</td>
              <td className="py-2 text-right text-slate-800">{fmtCurrency(r.expected_revenue_next_30d)}</td>
              <td className="py-2 text-right text-slate-700">{r.next_replenishment_est || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReplenishmentList({ rows }) {
  if (!rows.length) {
    return <EmptyState title="No replenishment alerts" body="All SKUs have ≥21 days of cover." />;
  }
  return (
    <div className="space-y-2" data-testid="fc-replenishment-list">
      {rows.map((r) => {
        const m = PRIORITY_META[r.priority] || PRIORITY_META.plan;
        return (
          <div key={r.product_id}
               className={`rounded-lg border p-3 flex items-center justify-between gap-3 ${
                 r.priority === "urgent" ? "border-rose-200 bg-rose-50"
                 : r.priority === "soon" ? "border-amber-200 bg-amber-50"
                 : "border-indigo-200 bg-indigo-50"
               }`}
               data-testid={`fc-rec-${r.product_id}`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ring-1 text-xs ${m.pill}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />{m.label}
                </span>
                <span className="font-medium text-sm text-slate-800 truncate">{r.product_name}</span>
              </div>
              <div className="text-xs text-slate-700 mt-1">{r.message}</div>
              <div className="text-xs text-slate-500 mt-1">
                Supplier: <strong>{r.supplier_name}</strong>
                {r.order_by ? <> · Order by <strong>{r.order_by}</strong></> : null}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs text-slate-500">Suggested</div>
              <div className="text-lg font-bold text-slate-800">{fmtNumber(r.suggested_quantity)}</div>
              <div className="text-[10px] text-slate-500">units</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SafetyStockTable({ rows }) {
  if (!rows.length) return <EmptyState title="No safety stock data" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-testid="fc-safety-table">
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left font-medium py-2">Product</th>
            <th className="text-right font-medium py-2">On Hand</th>
            <th className="text-right font-medium py-2">Target SS</th>
            <th className="text-right font-medium py-2">Daily Velocity</th>
            <th className="text-right font-medium py-2">Lead Time</th>
            <th className="text-left font-medium py-2 pl-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = SAFETY_META[r.status] || SAFETY_META.unknown;
            return (
              <tr key={r.product_id} className="border-t border-slate-100">
                <td className="py-2 pr-2 text-slate-800 font-medium">{r.product_name}</td>
                <td className="py-2 text-right text-slate-700">{fmtNumber(r.on_hand)}</td>
                <td className="py-2 text-right text-slate-800">{fmtNumber(r.target_safety_stock)}</td>
                <td className="py-2 text-right text-slate-700">{r.daily_velocity}</td>
                <td className="py-2 text-right text-slate-700">{r.lead_time_days}d</td>
                <td className="py-2 pl-3">
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ring-1 text-xs ${m.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
                    {m.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


/* =========================================================================
 * Control Tower View (Phase 3E) — composite Network Health Score, heat maps,
 * and network node summary. Pure rule-based math.
 * ======================================================================= */

const BAND_META = {
  excellent: { text: "Excellent", color: "text-emerald-700", ring: "ring-emerald-300",
                bg: "bg-emerald-50", bar: "bg-emerald-500" },
  good:      { text: "Good",      color: "text-indigo-700",  ring: "ring-indigo-300",
                bg: "bg-indigo-50", bar: "bg-indigo-500" },
  watch:     { text: "Watch",     color: "text-amber-700",   ring: "ring-amber-300",
                bg: "bg-amber-50",  bar: "bg-amber-500" },
  critical:  { text: "Critical",  color: "text-rose-700",    ring: "ring-rose-300",
                bg: "bg-rose-50",   bar: "bg-rose-500" },
};

function ControlTower({ control }) {
  const hs = control.health_score || {};
  const heat = control.heat_maps || {};
  const net = control.network || {};
  const components = hs.components || {};
  const m = BAND_META[hs.band] || BAND_META.watch;

  if (!hs.composite && !heat.revenue_by_region) {
    return <EmptyState title="Control Tower data unavailable" />;
  }

  return (
    <div className="space-y-4" data-testid="control-tower">
      {/* Composite health score gauge */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-indigo-600" /> Network Health Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-center">
            <div className={`rounded-xl ring-2 ${m.ring} ${m.bg} p-6 text-center`}
                 data-testid="ct-health-score">
              <div className={`text-6xl font-extrabold leading-none ${m.color}`}>
                {hs.composite || 0}
                <span className="text-xl text-slate-500 font-medium">/100</span>
              </div>
              <div className={`mt-2 text-sm font-semibold uppercase tracking-wider ${m.color}`}>
                {m.text}
              </div>
            </div>
            <div className="lg:col-span-2 space-y-3" data-testid="ct-components">
              <ScoreComponent label="Inventory Health"        value={components.inventory_health} />
              <ScoreComponent label="Distributor Health"      value={components.distributor_health} />
              <ScoreComponent label="Fulfillment Performance" value={components.fulfillment_performance} />
              <ScoreComponent label="Shipment Reliability"    value={components.shipment_reliability} />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Heat Maps */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <HeatCard
          testid="ct-heat-revenue"
          title="Revenue Concentration"
          icon={Wallet}
          rows={heat.revenue_by_region || []}
          formatter={fmtCurrency}
          subFormatter={(r) => `${r.growth_pct >= 0 ? "+" : ""}${r.growth_pct}%`}
        />
        <HeatCard
          testid="ct-heat-inventory"
          title="Inventory Allocation"
          icon={Package}
          rows={heat.inventory_by_category || []}
          formatter={fmtCurrency}
          subFormatter={(r) => `${r.turnover_per_year || 0}x / yr`}
        />
        <HeatCard
          testid="ct-heat-distributors"
          title="Distributor Activity"
          icon={Users}
          rows={heat.distributor_activity || []}
          formatter={fmtCurrency}
          subFormatter={(r) => `${r.region}`}
        />
      </div>

      {/* Network nodes summary */}
      <Card data-testid="ct-network">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4 text-indigo-600" /> Supply Chain Network
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <NetworkStat label="Warehouses"     value={net.summary?.warehouses || 0} icon={Building2} />
            <NetworkStat label="Distributors"   value={net.summary?.distributors || 0} icon={Users} />
            <NetworkStat label="Active Shipments" value={net.summary?.active_shipments || 0} icon={Truck} />
          </div>
          <NetworkGraph nodes={net.nodes || []} />
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreComponent({ label, value }) {
  const v = Math.max(0, Math.min(100, value || 0));
  const bar = v >= 80 ? "bg-emerald-500"
            : v >= 60 ? "bg-indigo-500"
            : v >= 40 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-700">{label}</span>
        <span className="font-medium text-slate-900">{v}/100</span>
      </div>
      <div className="mt-1 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${bar} transition-all`} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function HeatCard({ testid, title, icon: Icon, rows, formatter, subFormatter }) {
  if (rows.length === 0) {
    return (
      <Card data-testid={testid}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon className="h-4 w-4 text-indigo-600" /> {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState title="No data" />
        </CardContent>
      </Card>
    );
  }
  return (
    <Card data-testid={testid}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Icon className="h-4 w-4 text-indigo-600" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rows.slice(0, 8).map((r, idx) => {
            const intensity = Math.max(0.08, r.intensity || 0);
            return (
              <div key={r.label + idx} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-800 truncate">{r.label}</span>
                  <span className="text-slate-700 font-medium">{formatter(r.value)}</span>
                </div>
                <div className="mt-1 h-3 w-full bg-slate-100 rounded-md overflow-hidden">
                  <div
                    className="h-full rounded-md"
                    style={{
                      width: `${Math.round(intensity * 100)}%`,
                      backgroundColor: `rgba(99,102,241,${0.25 + intensity * 0.75})`,
                    }}
                  />
                </div>
                {subFormatter && (
                  <div className="text-[11px] text-slate-500 mt-0.5">{subFormatter(r)}</div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function NetworkStat({ label, value, icon: Icon }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex items-center gap-3">
      <div className="h-9 w-9 rounded-lg bg-white grid place-items-center text-indigo-600">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider font-medium text-slate-500">{label}</div>
        <div className="text-2xl font-bold text-slate-900 leading-none mt-0.5">{value}</div>
      </div>
    </div>
  );
}

function NetworkGraph({ nodes }) {
  const warehouses = nodes.filter((n) => n.type === "warehouse");
  const distributors = nodes.filter((n) => n.type === "distributor");
  if (warehouses.length === 0 && distributors.length === 0) {
    return <EmptyState title="No network nodes" />;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6" data-testid="ct-network-graph">
      <div>
        <div className="text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-2">
          Warehouses
        </div>
        <div className="space-y-2">
          {warehouses.map((w) => (
            <div key={w.id} className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-3"
                 data-testid={`ct-wh-${w.id}`}>
              <div className="text-sm font-medium text-indigo-900">{w.name}</div>
              <div className="text-xs text-indigo-700/80">{w.label} inventory value</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="text-[11px] uppercase tracking-wider font-medium text-slate-500 mb-2">
          Distributors
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {distributors.map((d) => {
            const tint = d.status === "high_growth" ? "border-emerald-200 bg-emerald-50/60"
                       : d.status === "at_risk" ? "border-rose-200 bg-rose-50/60"
                       : "border-slate-200 bg-slate-50";
            return (
              <div key={d.id} className={`rounded-lg border p-2.5 ${tint}`}
                   data-testid={`ct-dist-${d.id}`}>
                <div className="text-sm font-medium text-slate-800 truncate">{d.name}</div>
                <div className="text-[11px] text-slate-600 flex items-center justify-between mt-1">
                  <span>{d.region}</span>
                  <span className="font-medium">{d.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

