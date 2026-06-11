import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { WholesalerApi } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  PageHeader, KpiCard, fmtCurrency, fmtNumber, ToneCard, EmptyState,
} from "./wholesaler/ui";
import { Network, Users, Sparkles, Activity, TrendingUp } from "lucide-react";

export default function WholesalerDistributors() {
  const { session } = useSession();
  const wid = session?.entity?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!wid) return;
    setLoading(true);
    WholesalerApi.distributors(wid)
      .then(setData)
      .finally(() => setLoading(false));
  }, [wid]);

  if (loading || !data) {
    return (
      <div className="p-8 text-sm text-slate-500" data-testid="wholesaler-distributors-loading">
        Loading distributor network…
      </div>
    );
  }

  const rows = (data.distributors || []).filter((d) =>
    !search || `${d.name} ${d.code} ${d.city}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="wholesaler-distributors">
      <PageHeader
        title="Distributor Network"
        subtitle={`Distributors served by your hub in ${data.region || "your zone"}.`}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          testid="dist-count"
          icon={Network}
          label="Distributors"
          value={fmtNumber(data.totals.distributor_count)}
        />
        <KpiCard
          testid="dist-active"
          icon={Users}
          label="Active (90d)"
          value={fmtNumber(data.totals.active_distributors)}
          tone={data.totals.active_distributors > 0 ? "positive" : "warning"}
        />
        <KpiCard
          testid="dist-revenue"
          icon={Activity}
          label="Revenue (90d)"
          value={fmtCurrency(data.totals.total_revenue_90d)}
        />
        <KpiCard
          testid="dist-avg"
          icon={TrendingUp}
          label="Avg / Distributor"
          value={data.totals.distributor_count
            ? fmtCurrency(data.totals.total_revenue_90d / data.totals.distributor_count)
            : "—"}
        />
      </div>

      {data.insights?.length > 0 && (
        <Card data-testid="dist-insights-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-600" />
              Network Insights
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.insights.map((i, idx) => (
              <ToneCard key={idx} tone={i.tone} title={i.title} body={i.body} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Distributor Directory</CardTitle>
          <Input
            placeholder="Search distributor…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
            data-testid="dist-search"
          />
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState
              title="No distributors found"
              body={data.totals.distributor_count === 0
                ? "Your region currently has no registered distributors under your tenant."
                : "Adjust your search to find a distributor."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="dist-table">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 px-3 font-medium">Distributor</th>
                    <th className="py-2 px-3 font-medium">Code</th>
                    <th className="py-2 px-3 font-medium">City</th>
                    <th className="py-2 px-3 font-medium text-right">Inventory Health</th>
                    <th className="py-2 px-3 font-medium text-right">SKUs</th>
                    <th className="py-2 px-3 font-medium text-right">Orders (90d)</th>
                    <th className="py-2 px-3 font-medium text-right">Revenue (90d)</th>
                    <th className="py-2 px-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50" data-testid={`dist-row-${d.code || d.id}`}>
                      <td className="py-2 px-3 font-medium text-slate-800">{d.name}</td>
                      <td className="py-2 px-3 text-slate-500 text-xs">{d.code || "—"}</td>
                      <td className="py-2 px-3 text-slate-600">{d.city || "—"}</td>
                      <td className="py-2 px-3 text-right">
                        <HealthCell value={d.inventory_health} />
                      </td>
                      <td className="py-2 px-3 text-right">{fmtNumber(d.inventory_skus)}</td>
                      <td className="py-2 px-3 text-right">{fmtNumber(d.purchase_frequency_90d)}</td>
                      <td className="py-2 px-3 text-right">{fmtCurrency(d.revenue_90d)}</td>
                      <td className="py-2 px-3">
                        {d.purchase_frequency_90d > 0 ? (
                          <Badge className="bg-emerald-100 text-emerald-700 font-medium">Active</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700 font-medium">Dormant</Badge>
                        )}
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

function HealthCell({ value }) {
  const v = Number(value || 0);
  const color = v >= 80 ? "bg-emerald-500" : v >= 60 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, v)}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-700 w-10 text-right">{v.toFixed(0)}%</span>
    </div>
  );
}
