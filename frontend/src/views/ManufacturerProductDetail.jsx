import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Edit2, ExternalLink, Tag, Boxes, Truck, AlertTriangle,
  TrendingUp, BarChart3, Warehouse,
} from "lucide-react";
import EditProductDialog from "@/components/EditProductDialog";
import AdjustInventoryDialog from "@/components/AdjustInventoryDialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString();
const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

export default function ManufacturerProductDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);

  const load = () => {
    if (!session?.entity?.id) return;
    setLoading(true);
    Api.manufacturerProductDetail(session.entity.id, productId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [productId, session?.entity?.id]);

  if (loading) {
    return (
      <div className="p-8 max-w-7xl mx-auto space-y-4" data-testid="manufacturer-product-detail-loading">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="p-8 max-w-7xl mx-auto" data-testid="manufacturer-product-detail-empty">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
        </Button>
        <Card><CardContent className="p-8 text-center text-graphite">
          Product not found in your catalog.
        </CardContent></Card>
      </div>
    );
  }

  const inv = data.inventory;
  const dist = data.distribution;
  const analytics = data.analytics;

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="manufacturer-product-detail">
      <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4 -ml-3" data-testid="back-btn">
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Back
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap mb-8">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-1.5">
            <Tag className="h-3 w-3" /> {data.product.category || "Product"}
          </div>
          <h1 className="font-display text-4xl tracking-tight mt-1">{data.product.name}</h1>
          <div className="text-sm text-graphite mt-2 font-mono">
            SKU {data.product.sku} · {fmtMoney(data.product.unit_price)} per unit
            {data.product.barcode && <span> · barcode {data.product.barcode}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setAdjustOpen(true)} data-testid="page-adjust-inventory-btn">
            <Boxes className="h-4 w-4 mr-1.5" /> Adjust inventory
          </Button>
          <Button onClick={() => setEditOpen(true)} className="bg-ink hover:bg-ink/90 text-paper" data-testid="page-edit-product-btn">
            <Edit2 className="h-4 w-4 mr-1.5" /> Edit product
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6" data-testid="product-kpis">
        <KPI label="Revenue · 90d" value={fmtMoney(analytics.total_revenue_90d)} tone="moss" />
        <KPI label="Units sold · 90d" value={analytics.total_units_90d.toLocaleString()} />
        <KPI label="Avg daily sales" value={`${analytics.avg_daily_sales}u`} />
        <KPI label="Inventory turnover" value={`${analytics.inventory_turnover}x`} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        {/* Inventory card */}
        <Card><CardContent className="p-5" data-testid="inventory-card">
          <SectionTitle icon={Boxes}>Inventory</SectionTitle>
          <Row label="Distributor stock" value={inv.distributor_units.toLocaleString()} />
          <Row label="Retailer stock" value={inv.retailer_units.toLocaleString()} />
          <Row label="Available" value={inv.available.toLocaleString()} />
          <Row label="Reserved" value={inv.reserved.toLocaleString()} tone={inv.reserved > 0 ? "amber" : "default"} />
          <Row label="Last restock" value={fmtDate(inv.last_restock_at)} />
        </CardContent></Card>

        {/* Distribution card */}
        <Card><CardContent className="p-5" data-testid="distribution-card">
          <SectionTitle icon={Warehouse}>Distribution</SectionTitle>
          <Row label="Distributors carrying" value={`${dist.distributors_carrying} / ${dist.distributors_total}`} />
          <Row label="Retailers stocking" value={`${dist.retailers_stocking} / ${dist.retailers_total}`} />
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-graphite mb-1">Top regions (90d revenue)</div>
            <div className="space-y-1">
              {dist.by_region.slice(0, 4).map((r) => (
                <div key={r.region} className="flex items-center justify-between text-xs">
                  <span className="text-ink">{r.region}</span>
                  <span className="font-mono text-graphite">{fmtMoney(r.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent></Card>

        {/* Trend card */}
        <Card><CardContent className="p-5" data-testid="trend-card">
          <SectionTitle icon={TrendingUp}>Monthly revenue trend</SectionTitle>
          <MonthlyBars data={analytics.monthly_trend} />
        </CardContent></Card>
      </div>

      {/* Distribution table */}
      <Card className="mb-6">
        <CardContent className="p-0" data-testid="distributor-breakdown-table">
          <div className="p-5 pb-3 flex items-center justify-between">
            <h3 className="font-display text-xl tracking-tight">By distributor</h3>
            <span className="text-xs text-graphite">{dist.by_distributor.length} total</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Distributor</TableHead>
                <TableHead>Region</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead className="text-right">Retailers stocked</TableHead>
                <TableHead className="text-right">Revenue · 90d</TableHead>
                <TableHead className="text-right">Units sold</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dist.by_distributor.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-graphite py-8">
                    Not yet carried by any distributor.
                  </TableCell>
                </TableRow>
              )}
              {dist.by_distributor.slice(0, 25).map((d) => (
                <TableRow key={d.distributor_id} data-testid={`prod-dist-row-${d.distributor_id}`}>
                  <TableCell className="font-medium text-ink">{d.distributor_name}</TableCell>
                  <TableCell className="text-graphite">{d.region}{d.city ? ` · ${d.city}` : ""}</TableCell>
                  <TableCell className="text-right font-mono">{d.quantity.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-graphite">{d.retailers_stocked} / {d.retailers_count}</TableCell>
                  <TableCell className="text-right font-mono text-moss">{fmtMoney(d.revenue_90d)}</TableCell>
                  <TableCell className="text-right font-mono text-graphite">{d.units_sold_90d.toLocaleString()}</TableCell>
                  <TableCell className="text-right">
                    <Link to={`/distributors/${d.distributor_id}`} className="text-xs text-amber hover:underline inline-flex items-center gap-1" data-testid={`view-distributor-${d.distributor_id}`}>
                      View <ExternalLink className="h-3 w-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Recent orders */}
      <Card>
        <CardContent className="p-5" data-testid="recent-orders-section">
          <SectionTitle icon={Truck}>Recent outbound orders</SectionTitle>
          {data.recent_orders.length === 0 ? (
            <div className="text-sm text-graphite py-3">No outbound shipments for this product yet.</div>
          ) : (
            <div className="space-y-2">
              {data.recent_orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-graphite">{o.tracking_code}</div>
                    <div className="text-ink">{o.to_distributor} <span className="text-graphite">· {o.region}</span></div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">{o.quantity.toLocaleString()}u</div>
                    <div className="text-xs"><Badge variant="outline" className="text-[10px] uppercase tracking-wider">{o.status}</Badge></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <EditProductDialog
        open={editOpen} onOpenChange={setEditOpen}
        product={data.product}
        onSaved={() => { setEditOpen(false); load(); }}
      />
      <AdjustInventoryDialog
        open={adjustOpen} onOpenChange={setAdjustOpen}
        ownerType="manufacturer"
        ownerId={session.entity.id}
        product={data.product}
        currentQty={data.inventory.distributor_units}
        onSaved={() => { setAdjustOpen(false); load(); }}
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

function MonthlyBars({ data }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-graphite py-3">No revenue data yet.</div>;
  }
  const max = Math.max(...data.map((d) => d.revenue), 1);
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map((d) => {
        const h = Math.max(4, (d.revenue / max) * 100);
        return (
          <div key={d.month} className="flex-1 flex flex-col items-center gap-1.5">
            <div className="w-full bg-amber/15 rounded-t hover:bg-amber/30 transition-colors relative group" style={{ height: `${h}%` }}>
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-ink text-paper text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap">
                ₦{Number(d.revenue).toLocaleString()}
              </div>
            </div>
            <div className="text-[10px] text-graphite font-mono">{d.month.slice(2)}</div>
          </div>
        );
      })}
    </div>
  );
}
