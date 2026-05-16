import { useEffect, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader, KPICard } from "@/components/Common";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Truck, Clock, PackageCheck, MessageSquare } from "lucide-react";

const COLORS = ["#64748b", "#f59e0b", "#10b981"]; // slate, amber, emerald

export default function AnalyticsView() {
  const { session } = useSession();
  const [data, setData] = useState(null);

  useEffect(() => {
    Api.analytics(session.role, session.entity.id).then(setData);
  }, [session.role, session.entity.id]);

  if (!data) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <PageHeader title="Analytics" description="Loading insights…" />
      </div>
    );
  }

  const k = data.kpis || {};

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="analytics-view">
      <PageHeader title="Analytics" description="Trends, throughput and the health of your supply chain." />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KPICard label="Pending" value={k.pending} Icon={Clock} tone="slate" testId="an-kpi-pending" />
        <KPICard label="In Transit" value={k.in_transit} Icon={Truck} tone="amber" testId="an-kpi-in-transit" />
        <KPICard label="Received" value={k.received} Icon={PackageCheck} tone="emerald" testId="an-kpi-received" />
        <KPICard label="Open Requests" value={k.open_requests} Icon={MessageSquare} tone="blue" testId="an-kpi-requests" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" data-testid="chart-timeline">
          <CardHeader><CardTitle className="text-base">Shipments — last 14 days</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer>
                <AreaChart data={data.timeline}>
                  <defs>
                    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0f172a" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#0f172a" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="shipments" stroke="#0f172a" strokeWidth={2} fill="url(#grad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="chart-status">
          <CardHeader><CardTitle className="text-base">Status breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={data.status_breakdown} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                    {data.status_breakdown.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3" data-testid="chart-top-products">
          <CardHeader><CardTitle className="text-base">Top products by units moved</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={data.top_products} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#334155" }} width={170} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Bar dataKey="units" fill="#0f172a" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
