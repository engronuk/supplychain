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
  Truck, Package, Sparkles, Wallet, ShoppingCart,
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
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard testid="inv-units" icon={Package} label="On Hand" value={fmtNumber(data.inventory.total_units)} />
            <KpiCard testid="inv-reserved" icon={Activity} label="Reserved" value={fmtNumber(data.inventory.reserved)} tone="warning" />
            <KpiCard testid="inv-transit" icon={Truck} label="In Transit" value={fmtNumber(data.inventory.in_transit)} />
            <KpiCard testid="inv-damaged" icon={AlertTriangle} label="Damaged" value={fmtNumber(data.inventory.damaged)} tone={data.inventory.damaged > 0 ? "alert" : "default"} />
            <KpiCard testid="inv-turnover-90d" icon={TrendingUp} label="Turnover (90d)" value={`${data.inventory.turnover_90d}x`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">ABC Classification</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <ABCRow label="Class A (Top 80% value)" count={data.inventory.abc_summary.A} tone="positive" />
                <ABCRow label="Class B (next 15%)" count={data.inventory.abc_summary.B} tone="warning" />
                <ABCRow label="Class C (bottom 5%)" count={data.inventory.abc_summary.C} tone="neutral" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" /> Fast Movers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SkuMiniList rows={data.inventory.fast_movers} emptyLabel="No fast-moving SKUs" testid="fast-movers" valueKey="velocity" valueSuffix="/day" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-amber-600" /> Slow Movers
                </CardTitle>
              </CardHeader>
              <CardContent>
                <SkuMiniList rows={data.inventory.slow_movers} emptyLabel="No slow movers" testid="slow-movers" valueKey="velocity" valueSuffix="/day" />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" /> Dead Stock (0 velocity)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.inventory.dead_stock.length === 0 ? (
                <EmptyState title="No dead stock detected" />
              ) : (
                <SkuMiniList rows={data.inventory.dead_stock} emptyLabel="" testid="dead-stock" valueKey="value" valuePrefix="₦" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Distributors */}
        <TabsContent value="distributors" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top Distributors (90d revenue)</CardTitle>
            </CardHeader>
            <CardContent>
              <DistTable rows={data.distributors.top} emptyLabel="No active distributors" testid="top-dist" />
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" /> Fastest Growing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DistTable rows={data.distributors.fastest_growing} emptyLabel="No growth data" testid="fast-growing" showGrowth />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-rose-600" /> Declining
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DistTable rows={data.distributors.declining} emptyLabel="No declining distributors" testid="declining" showGrowth />
              </CardContent>
            </Card>
          </div>
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
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-600" /> {data.demand_forecast.horizon_days}-Day Demand Forecast (rule-based)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.demand_forecast.rows.length === 0 ? (
                <EmptyState title="No velocity data yet" body="Forecast becomes available after 30 days of orders." />
              ) : (
                <table className="w-full text-sm" data-testid="forecast-table">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b">
                      <th className="py-2 px-3 font-medium">Product</th>
                      <th className="py-2 px-3 font-medium text-right">Daily Velocity</th>
                      <th className="py-2 px-3 font-medium text-right">Projected (14d)</th>
                      <th className="py-2 px-3 font-medium text-right">On Hand</th>
                      <th className="py-2 px-3 font-medium text-right">Days of Cover</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.demand_forecast.rows.map((r) => (
                      <tr key={r.product_id} className="border-b border-slate-100">
                        <td className="py-2 px-3">
                          <div className="font-medium text-slate-800">{r.product_name}</div>
                          <div className="text-xs text-slate-500">{r.sku || "—"}</div>
                        </td>
                        <td className="py-2 px-3 text-right">{r.daily_velocity}</td>
                        <td className="py-2 px-3 text-right">{fmtNumber(r.projected_demand_14d)}</td>
                        <td className="py-2 px-3 text-right">{fmtNumber(r.on_hand)}</td>
                        <td className="py-2 px-3 text-right">
                          {r.days_of_cover == null ? "—" : (
                            <Badge className={
                              r.days_of_cover < 7 ? "bg-rose-100 text-rose-700"
                              : r.days_of_cover < 14 ? "bg-amber-100 text-amber-700"
                              : "bg-emerald-100 text-emerald-700"
                            }>{r.days_of_cover}d</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" /> Replenishment Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.demand_forecast.replenishment_recommendations.length === 0 ? (
                <EmptyState title="No replenishment alerts" body="All SKUs have ≥14 days of cover." />
              ) : (
                data.demand_forecast.replenishment_recommendations.map((rec) => (
                  <div key={rec.product_id} className={`rounded-lg border p-3 ${
                    rec.type === "urgent_reorder" ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"
                  }`} data-testid={`rec-${rec.product_id}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{rec.product_name}</span>
                      <Badge className={rec.type === "urgent_reorder" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}>
                        {rec.type === "urgent_reorder" ? "URGENT" : "Plan reorder"}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-700 mt-1">{rec.message}</div>
                    <div className="text-xs text-slate-500 mt-1">Suggested reorder qty: <strong>{fmtNumber(rec.suggested_qty)} units</strong></div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
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
