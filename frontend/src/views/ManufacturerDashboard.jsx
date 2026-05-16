import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { KPICard, PageHeader } from "@/components/Common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Truck, Clock, PackageCheck, Boxes, Network, Store, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

export default function ManufacturerDashboard() {
  const { session } = useSession();
  const [analytics, setAnalytics] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [distributors, setDistributors] = useState([]);

  useEffect(() => {
    const id = session.entity.id;
    Api.analytics("manufacturer", id).then(setAnalytics);
    Api.shipments({ manufacturer_id: id }).then((d) => setShipments(d.slice(0, 5)));
    Api.distributors(id).then(setDistributors);
  }, [session.entity.id]);

  const k = analytics?.kpis || {};

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="manufacturer-dashboard">
      <PageHeader
        title={`${session.entity.name}`}
        description="Production-to-distribution overview across your entire network."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard label="Pending" value={k.pending ?? "—"} Icon={Clock} tone="slate" testId="kpi-pending" />
        <KPICard label="In Transit" value={k.in_transit ?? "—"} Icon={Truck} tone="amber" testId="kpi-in-transit" />
        <KPICard label="Delivered" value={k.received ?? "—"} Icon={PackageCheck} tone="emerald" testId="kpi-received" />
        <KPICard label="Distributors" value={k.distributors_count ?? distributors.length} Icon={Network} tone="blue" testId="kpi-distributors" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <KPICard label="Inventory Units" value={k.inventory_total ?? "—"} Icon={Boxes} tone="plain" />
        <KPICard label="Low-Stock SKUs" value={k.low_stock ?? "—"} Icon={AlertTriangle} tone="plain" />
        <KPICard label="Retailers in Network" value={k.retailers_count ?? "—"} Icon={Store} tone="plain" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="recent-shipments-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent outbound shipments</CardTitle>
            <Link to="/shipments" className="text-xs text-slate-500 hover:text-slate-900">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {shipments.length === 0 && <div className="text-sm text-slate-500">No shipments yet.</div>}
            {shipments.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 text-sm">{s.tracking_code}</div>
                  <div className="text-xs text-slate-500 truncate">to {s.to_party?.name}</div>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="top-distributors-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Distributor network</CardTitle>
            <Link to="/network" className="text-xs text-slate-500 hover:text-slate-900">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {distributors.slice(0, 6).map((d) => (
              <div key={d.id} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 text-sm truncate">{d.name}</div>
                  <div className="text-xs text-slate-500">{d.region}{d.city ? ` · ${d.city}` : ""}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
