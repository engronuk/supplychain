import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { KPICard, PageHeader } from "@/components/Common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Truck, Clock, PackageCheck, MessageSquare, Boxes, AlertTriangle, Store } from "lucide-react";
import { Link } from "react-router-dom";

export default function DistributorDashboard() {
  const { session } = useSession();
  const [analytics, setAnalytics] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [requests, setRequests] = useState([]);
  const [retailers, setRetailers] = useState([]);

  useEffect(() => {
    const id = session.entity.id;
    Api.analytics("distributor", id).then(setAnalytics);
    Api.shipments({ distributor_id: id }).then((d) => setShipments(d.slice(0, 5)));
    Api.requests({ distributor_id: id }).then((r) => setRequests(r.filter((x) => x.status === "pending").slice(0, 5)));
    Api.retailers(id).then(setRetailers);
  }, [session.entity.id]);

  const k = analytics?.kpis || {};

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="distributor-dashboard">
      <PageHeader
        title={`Welcome, ${session.entity.name}`}
        description="Monitor outbound shipments, retailer requests, and inventory health."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard label="Pending" value={k.pending ?? "—"} Icon={Clock} tone="slate" testId="kpi-pending" />
        <KPICard label="In Transit" value={k.in_transit ?? "—"} Icon={Truck} tone="amber" testId="kpi-in-transit" />
        <KPICard label="Received" value={k.received ?? "—"} Icon={PackageCheck} tone="emerald" testId="kpi-received" />
        <KPICard label="Open Requests" value={k.open_requests ?? "—"} Icon={MessageSquare} tone="blue" testId="kpi-open-requests" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <KPICard label="Inventory Units" value={k.inventory_total ?? "—"} Icon={Boxes} tone="plain" />
        <KPICard label="Low-Stock SKUs" value={k.low_stock ?? "—"} Icon={AlertTriangle} tone="plain" />
        <KPICard label="Connected Retailers" value={retailers.length} Icon={Store} tone="plain" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="recent-shipments-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent shipments</CardTitle>
            <Link to="/shipments" className="text-xs text-slate-500 hover:text-slate-900">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {shipments.length === 0 && <div className="text-sm text-slate-500">No shipments yet.</div>}
            {shipments.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                <div>
                  <div className="font-medium text-slate-900 text-sm">{s.tracking_code}</div>
                  <div className="text-xs text-slate-500">to {s.retailer?.name}</div>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="pending-requests-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Pending requests</CardTitle>
            <Link to="/requests" className="text-xs text-slate-500 hover:text-slate-900">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {requests.length === 0 && <div className="text-sm text-slate-500">No open requests.</div>}
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                <div>
                  <div className="font-medium text-slate-900 text-sm">{r.retailer?.name}</div>
                  <div className="text-xs text-slate-500">
                    {r.items.length} item{r.items.length === 1 ? "" : "s"} · {r.items.reduce((a, b) => a + b.quantity, 0)} units
                  </div>
                </div>
                <StatusBadge status={r.status} kind="request" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
