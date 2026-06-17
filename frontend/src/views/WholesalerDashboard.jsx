import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import {
  KpiCard, fmtCurrency, fmtNumber, PageHeader, ToneCard,
} from "./wholesaler/ui";
import {
  Boxes, PackageCheck, Truck, ShoppingCart, Network, AlertTriangle,
  RefreshCw, Activity, TrendingUp, Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function WholesalerDashboard() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wid) return;
    setLoading(true);
    WholesalerApi.overview(wid)
      .then(setData)
      .finally(() => setLoading(false));
  }, [wid]);

  if (loading || !data) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="wholesaler-dashboard-loading">
        Loading wholesaler dashboard…
      </div>
    );
  }

  const k = data.kpis;
  const ih = data.inventory_health;

  return (
    <div className="p-6 md:p-8 space-y-8" data-testid="wholesaler-dashboard">
      <PageHeader
        title="Wholesaler Command Center"
        subtitle={`${data.wholesaler.name} · ${data.wholesaler.region}${data.wholesaler.city ? `, ${data.wholesaler.city}` : ""}`}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="wholesaler-kpi-strip">
        <KpiCard
          testid="kpi-inventory-value"
          icon={Boxes}
          label="Inventory Value"
          value={fmtCurrency(k.inventory_value.value)}
        />
        <KpiCard
          testid="kpi-inventory-units"
          icon={PackageCheck}
          label="Inventory Units"
          value={fmtNumber(k.inventory_units.value)}
        />
        <KpiCard
          testid="kpi-pending-pos"
          icon={ShoppingCart}
          label="Pending POs"
          value={fmtNumber(k.pending_pos.value)}
          tone={k.pending_pos.value > 0 ? "warning" : "default"}
        />
        <KpiCard
          testid="kpi-incoming-shipments"
          icon={Truck}
          label="Incoming Shipments"
          value={fmtNumber(k.incoming_shipments.value)}
        />
        <KpiCard
          testid="kpi-outgoing-shipments"
          icon={Truck}
          label="Outgoing Shipments"
          value={fmtNumber(k.outgoing_shipments.value)}
        />
        <KpiCard
          testid="kpi-active-retailers"
          icon={Network}
          label="Active Retailers"
          value={fmtNumber((k.active_retailers || k.active_distributors).value)}
        />
        <KpiCard
          testid="kpi-inventory-turnover"
          icon={Activity}
          label="Inventory Turnover (90d)"
          value={k.inventory_turnover.value.toFixed(2) + "x"}
          hint="Throughput / avg inventory"
        />
        <KpiCard
          testid="kpi-stockout-risks"
          icon={AlertTriangle}
          label="Stockout Risks"
          value={fmtNumber(k.stockout_risks.value)}
          tone={k.stockout_risks.value > 0 ? "alert" : "positive"}
        />
      </div>

      {/* Inventory Health + AI Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1" data-testid="inventory-health-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageCheck className="h-4 w-4 text-emerald-600" />
              Inventory Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <HealthRow label="Healthy" value={ih.in_stock - ih.low_stock - ih.excess} pct={ih.health_score} tone="positive" />
            <HealthRow label="Low Stock" value={ih.low_stock} tone="warning" />
            <HealthRow label="Excess Stock" value={ih.excess_stock} tone="info" />
            <HealthRow label="Expiring (<30d)" value={ih.expiring} tone="alert" />
            <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 flex justify-between">
              <span>Total SKUs</span>
              <span className="font-medium text-slate-700">{ih.total_skus}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2" data-testid="ai-insights-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-600" />
              AI Insights
            </CardTitle>
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">
              {data.ai_insights.length} insight{data.ai_insights.length !== 1 ? "s" : ""}
            </Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.ai_insights.map((i, idx) => (
              <ToneCard
                key={idx}
                tone={i.tone}
                title={i.title}
                body={i.body}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Stockout Risk Panel */}
      <Card data-testid="stockout-risk-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Stockout Risk Watchlist
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.stockout_risks.length === 0 ? (
            <div className="text-sm text-slate-500 text-center py-6">
              No stockout risks detected — your inventory buffer is healthy.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 px-3 font-medium">Product</th>
                    <th className="py-2 px-3 font-medium">SKU</th>
                    <th className="py-2 px-3 font-medium text-right">On Hand</th>
                    <th className="py-2 px-3 font-medium text-right">Reorder Level</th>
                    <th className="py-2 px-3 font-medium text-right">Days Left</th>
                    <th className="py-2 px-3 font-medium">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stockout_risks.map((r) => (
                    <tr key={r.product_id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 font-medium text-slate-800">{r.product_name}</td>
                      <td className="py-2 px-3 text-slate-500">{r.sku || "—"}</td>
                      <td className="py-2 px-3 text-right">{fmtNumber(r.on_hand)}</td>
                      <td className="py-2 px-3 text-right">{fmtNumber(r.reorder_level)}</td>
                      <td className="py-2 px-3 text-right">{r.days_left ?? "—"}</td>
                      <td className="py-2 px-3">
                        <SeverityChip severity={r.severity} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function HealthRow({ label, value, pct, tone = "default" }) {
  const colors = {
    positive: "bg-emerald-500",
    warning:  "bg-amber-500",
    info:     "bg-indigo-500",
    alert:    "bg-rose-500",
  };
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-medium text-slate-800">{fmtNumber(value)}</span>
      </div>
      {pct != null && (
        <div className="mt-1 h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${colors[tone] || colors.positive}`}
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function SeverityChip({ severity }) {
  const map = {
    out:      "bg-rose-100 text-rose-700",
    critical: "bg-amber-100 text-amber-700",
    low:      "bg-yellow-100 text-yellow-700",
  };
  return (
    <Badge className={`${map[severity] || "bg-slate-100 text-slate-700"} font-medium`}>
      {severity}
    </Badge>
  );
}
