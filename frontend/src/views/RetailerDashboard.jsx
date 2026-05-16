import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { KPICard, PageHeader } from "@/components/Common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { Truck, Clock, PackageCheck, MessageSquare, Boxes, AlertTriangle, Warehouse } from "lucide-react";
import { Link } from "react-router-dom";

export default function RetailerDashboard() {
  const { session } = useSession();
  const [analytics, setAnalytics] = useState(null);
  const [shipments, setShipments] = useState([]);
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    const id = session.entity.id;
    Api.analytics("retailer", id).then(setAnalytics);
    Api.shipments({ retailer_id: id }).then((d) => setShipments(d.slice(0, 5)));
    Api.requests({ retailer_id: id }).then((r) => setRequests(r.slice(0, 5)));
  }, [session.entity.id]);

  const k = analytics?.kpis || {};

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="retailer-dashboard">
      <PageHeader
        title={`Welcome, ${session.entity.name}`}
        description="Track incoming shipments, request stock, and watch your shelves."
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KPICard label="Pending" value={k.pending ?? "—"} Icon={Clock} tone="slate" testId="kpi-pending" />
        <KPICard label="In Transit" value={k.in_transit ?? "—"} Icon={Truck} tone="amber" testId="kpi-in-transit" />
        <KPICard label="Received" value={k.received ?? "—"} Icon={PackageCheck} tone="emerald" testId="kpi-received" />
        <KPICard label="My Requests Open" value={k.open_requests ?? "—"} Icon={MessageSquare} tone="blue" testId="kpi-open-requests" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <KPICard label="Inventory Units" value={k.inventory_total ?? "—"} Icon={Boxes} tone="plain" />
        <KPICard label="Low-Stock SKUs" value={k.low_stock ?? "—"} Icon={AlertTriangle} tone="plain" />
        <KPICard label="Primary Distributor" value={session.entity.region} sub="region" Icon={Warehouse} tone="plain" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="incoming-shipments-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Incoming shipments</CardTitle>
            <Link to="/shipments" className="text-xs text-slate-500 hover:text-slate-900">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {shipments.length === 0 && <div className="text-sm text-slate-500">No shipments yet.</div>}
            {shipments.map((s) => (
              <div key={s.id} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                <div>
                  <div className="font-medium text-slate-900 text-sm">{s.tracking_code}</div>
                  <div className="text-xs text-slate-500">from {s.distributor?.name}</div>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card data-testid="my-requests-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">My requests</CardTitle>
            <Link to="/requests" className="text-xs text-slate-500 hover:text-slate-900">View all</Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {requests.length === 0 && <div className="text-sm text-slate-500">No requests yet.</div>}
            {requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b last:border-0 pb-3 last:pb-0">
                <div>
                  <div className="font-medium text-slate-900 text-sm">
                    {r.items.length} item{r.items.length === 1 ? "" : "s"} · {r.items.reduce((a, b) => a + b.quantity, 0)} units
                  </div>
                  <div className="text-xs text-slate-500 truncate max-w-[240px]">{r.note || "—"}</div>
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
