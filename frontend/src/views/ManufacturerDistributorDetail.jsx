import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Edit2, ExternalLink, Mail, Phone, MapPin, Building2,
  Package, TrendingUp, Receipt, BarChart3,
} from "lucide-react";
import EditDistributorDialog from "@/components/EditDistributorDialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString();
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function ManufacturerDistributorDetail() {
  const { distributorId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);

  const load = () => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.manufacturerDistributorDetail(session.entity.id, distributorId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [distributorId, session?.entity?.id]);

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-4" data-testid="manufacturer-distributor-detail-loading">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-8 max-w-7xl mx-auto" data-testid="manufacturer-distributor-detail-empty">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
        <Card><CardContent className="p-8 text-center text-graphite">
          Distributor not found in your network.
        </CardContent></Card>
      </div>
    );
  }

  const d = data.distributor;
  const m = data.business_metrics;

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="manufacturer-distributor-detail">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 -ml-3" data-testid="back-btn">
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-8">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-1.5">
            <Building2 className="h-3 w-3" /> Distributor
          </div>
          <h1 className="font-display text-4xl tracking-tight mt-1">{d.name}</h1>
          <div className="text-sm text-graphite mt-2 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />
              {d.region}{d.city ? ` · ${d.city}` : ""}
            </span>
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
              {d.status || "active"}
            </Badge>
            <span className="text-xs">Onboarded {fmtDate(d.created_at)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {d.contact_email && (
            <a href={`mailto:${d.contact_email}`} data-testid="contact-distributor-btn">
              <Button variant="outline"><Mail className="h-4 w-4 mr-1.5" /> Contact</Button>
            </a>
          )}
          <Button onClick={() => setEditOpen(true)} className="bg-ink hover:bg-ink/90 text-paper" data-testid="page-edit-distributor-btn">
            <Edit2 className="h-4 w-4 mr-1.5" /> Edit distributor
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="distributor-kpis">
        <KPI label="Revenue generated" value={fmtMoney(m.revenue_generated)} tone="moss" />
        <KPI label="Total orders" value={m.total_orders.toLocaleString()} />
        <KPI label="Units distributed" value={m.total_units_distributed.toLocaleString()} />
        <KPI label="Retailers downstream" value={m.retailers_count.toLocaleString()} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Card><CardContent className="p-5" data-testid="contact-card">
          <SectionTitle icon={Receipt}>Contact</SectionTitle>
          <ContactRow icon={Mail} label="Email" value={d.contact_email} action={d.contact_email && `mailto:${d.contact_email}`} />
          <ContactRow icon={Phone} label="Phone" value={d.contact_phone} action={d.contact_phone && `tel:${d.contact_phone}`} />
          <ContactRow icon={MapPin} label="Address" value={d.address || `${d.city || ""}${d.city && d.region ? ", " : ""}${d.region || ""}`} />
        </CardContent></Card>

        <Card><CardContent className="p-5" data-testid="performance-card">
          <SectionTitle icon={TrendingUp}>Performance</SectionTitle>
          <Row label="Last order" value={fmtDate(m.last_order_at)} />
          <Row label="Avg order cadence" value={m.avg_order_freq_days ? `${m.avg_order_freq_days}d` : "—"} />
          <Row label="Growth (30d vs prior 30d)"
            value={m.growth_rate_pct === null ? "—" : `${m.growth_rate_pct >= 0 ? "+" : ""}${m.growth_rate_pct}%`}
            tone={m.growth_rate_pct >= 0 ? "moss" : "amber"} />
          <Row label="Outstanding orders" value={`${m.outstanding_units}u`}
            tone={m.outstanding_units > 0 ? "amber" : "default"} />
          <Row label="Outstanding value" value={fmtMoney(m.outstanding_value)} />
        </CardContent></Card>

        <Card><CardContent className="p-5" data-testid="downstream-card">
          <SectionTitle icon={BarChart3}>Downstream (90d)</SectionTitle>
          <Row label="Retailer revenue" value={fmtMoney(m.downstream_revenue_90d)} tone="moss" />
          <Row label="Retailer units sold" value={m.downstream_units_90d.toLocaleString()} />
          <Row label="Retailer count" value={m.retailers_count.toLocaleString()} />
          {data.retailers_summary.regions.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wider text-graphite mb-1">Regions</div>
              <div className="flex flex-wrap gap-1">
                {data.retailers_summary.regions.slice(0, 6).map((r) => (
                  <Badge key={r} variant="outline" className="text-[10px]">{r}</Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent></Card>
      </div>

      {/* Monthly trend */}
      <Card className="mb-6">
        <CardContent className="p-5" data-testid="monthly-trend-card">
          <SectionTitle icon={TrendingUp}>Monthly trend</SectionTitle>
          {data.performance.monthly_trend.length === 0 ? (
            <div className="text-sm text-graphite py-3">No order history yet.</div>
          ) : (
            <MonthlyDualBars data={data.performance.monthly_trend} />
          )}
        </CardContent>
      </Card>

      {/* Top products + Product portfolio */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-5" data-testid="top-products-card">
            <SectionTitle icon={Package}>Top products · 90d</SectionTitle>
            {data.performance.top_products.length === 0 ? (
              <div className="text-sm text-graphite py-3">No orders yet.</div>
            ) : (
              <div className="space-y-1.5">
                {data.performance.top_products.map((p) => (
                  <div key={p.product_id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
                    <Link to={`/products/${p.product_id}`} className="min-w-0 flex-1 hover:text-amber" data-testid={`top-product-${p.product_id}`}>
                      <div className="text-ink truncate">{p.product_name}</div>
                      <div className="text-xs text-graphite font-mono">{p.sku}</div>
                    </Link>
                    <div className="text-right">
                      <div className="font-medium">{fmtMoney(p.revenue)}</div>
                      <div className="text-xs text-graphite">{p.units.toLocaleString()}u</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0" data-testid="product-portfolio-card">
            <div className="p-5 pb-3 flex items-center justify-between">
              <h3 className="font-display text-xl tracking-tight">Product portfolio</h3>
              <span className="text-xs text-graphite">{data.product_portfolio.length} SKUs · {data.total_stock_units.toLocaleString()}u</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Reorder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.product_portfolio.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-graphite py-6">
                      No products carried yet.
                    </TableCell>
                  </TableRow>
                )}
                {data.product_portfolio.slice(0, 12).map((p) => {
                  const low = p.quantity <= p.reorder_level;
                  return (
                    <TableRow key={p.product_id} data-testid={`portfolio-row-${p.product_id}`}>
                      <TableCell>
                        <Link to={`/products/${p.product_id}`} className="hover:text-amber">
                          <div className="text-ink">{p.product_name}</div>
                          <div className="text-[11px] text-graphite font-mono">{p.sku}</div>
                        </Link>
                      </TableCell>
                      <TableCell className={`text-right font-mono ${low ? "text-amber font-semibold" : ""}`}>
                        {p.quantity.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-graphite font-mono">{p.reorder_level}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <EditDistributorDialog
        open={editOpen} onOpenChange={setEditOpen}
        distributor={d}
        onSaved={() => { setEditOpen(false); load(); }}
      />
    </div>
  );
}

function KPI({ label, value, tone = "default" }) {
  const toneClass = tone === "moss" ? "text-moss" : tone === "amber" ? "text-amber" : "text-ink";
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-graphite">{label}</div>
      <div className={`font-display text-2xl tracking-tight mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}
function SectionTitle({ icon: Icon, children }) {
  return (
    <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-1.5 mb-3">
      <Icon className="h-3 w-3" /> {children}
    </div>
  );
}
function Row({ label, value, tone = "default" }) {
  const toneClass = tone === "amber" ? "text-amber" : tone === "moss" ? "text-moss" : "text-ink";
  return (
    <div className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
      <span className="text-graphite">{label}</span>
      <span className={`font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}
function ContactRow({ icon: Icon, label, value, action }) {
  if (!value) return (
    <div className="flex items-center gap-2 py-1.5 text-sm">
      <Icon className="h-3.5 w-3.5 text-graphite" />
      <span className="text-graphite">{label}:</span>
      <span className="text-graphite">—</span>
    </div>
  );
  return (
    <div className="flex items-start gap-2 py-1.5 text-sm">
      <Icon className="h-3.5 w-3.5 mt-0.5 text-graphite flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-graphite">{label}</div>
        {action ? (
          <a href={action} className="text-ink hover:text-amber underline-offset-2 hover:underline break-all">{value}</a>
        ) : (
          <div className="text-ink break-words">{value}</div>
        )}
      </div>
    </div>
  );
}
function MonthlyDualBars({ data }) {
  const maxOrders = Math.max(...data.map((d) => d.orders), 1);
  const maxUnits = Math.max(...data.map((d) => d.units), 1);
  return (
    <div className="flex items-end gap-3 h-40">
      {data.map((d) => (
        <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5">
          <div className="w-full flex items-end gap-1 flex-1">
            <div className="flex-1 bg-amber/20 hover:bg-amber/40 transition-colors rounded-t relative group"
                 style={{ height: `${(d.orders / maxOrders) * 100}%` }}>
              <div className="absolute -top-7 left-0 opacity-0 group-hover:opacity-100 transition-opacity bg-ink text-paper text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                {d.orders} orders
              </div>
            </div>
            <div className="flex-1 bg-moss/25 hover:bg-moss/50 transition-colors rounded-t relative group"
                 style={{ height: `${(d.units / maxUnits) * 100}%` }}>
              <div className="absolute -top-7 left-0 opacity-0 group-hover:opacity-100 transition-opacity bg-ink text-paper text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                {d.units.toLocaleString()} units
              </div>
            </div>
          </div>
          <div className="text-[10px] text-graphite font-mono">{d.month.slice(2)}</div>
        </div>
      ))}
      <div className="flex flex-col gap-1.5 text-[10px] text-graphite pl-3 border-l">
        <div className="flex items-center gap-1"><span className="h-2 w-2 bg-amber/50 rounded-sm" /> Orders</div>
        <div className="flex items-center gap-1"><span className="h-2 w-2 bg-moss/50 rounded-sm" /> Units</div>
      </div>
    </div>
  );
}
