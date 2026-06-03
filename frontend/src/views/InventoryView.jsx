import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, AlertTriangle, ArrowUpRight, Boxes, TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ProductDrawer } from "@/components/EntityDrawer";

const fmtMoney = (v) => "₦" + Number(v || 0).toLocaleString();

export default function InventoryView() {
  const { session } = useSession();
  const role = session.role;
  if (role === "manufacturer") return <ManufacturerInventory session={session} />;
  return <DistributorRetailerInventory session={session} role={role} />;
}

// ---------------------------------------------------------------------------
// Manufacturer = product catalog (with drill-down drawer)
// ---------------------------------------------------------------------------
function ManufacturerInventory({ session }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedProductId, setSelectedProductId] = useState(null);

  const load = () => {
    setLoading(true);
    Api.manufacturerProducts(session.entity.id)
      .then(setItems)
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [session.entity.id]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) =>
      (i.name || "").toLowerCase().includes(s) ||
      (i.sku || "").toLowerCase().includes(s) ||
      (i.category || "").toLowerCase().includes(s)
    );
  }, [items, search]);

  const totalUnits = items.reduce((sum, p) => sum + p.units_in_network, 0);
  const totalRevenue = items.reduce((sum, p) => sum + p.revenue_90d, 0);

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="manufacturer-inventory-view">
      <PageHeader
        title="Product catalog"
        description="Every SKU in your network — click a product to drill down."
        actions={
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-graphite" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…" className="pl-9 w-72" data-testid="inventory-search" />
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-6" data-testid="catalog-summary">
        <SummaryStat label="SKUs in catalog" value={items.length} />
        <SummaryStat label="Units across network" value={totalUnits.toLocaleString()} />
        <SummaryStat label="Revenue · 90d" value={fmtMoney(totalRevenue)} tone="moss" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table data-testid="inventory-table">
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Units in network</TableHead>
                <TableHead className="text-right">Distributors</TableHead>
                <TableHead className="text-right">Revenue · 90d</TableHead>
                <TableHead className="w-[130px]">Velocity · 30d</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!loading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-graphite py-12">
                    No products match your search.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((p) => (
                <TableRow
                  key={p.id}
                  onClick={() => setSelectedProductId(p.id)}
                  className="hover:bg-stone-50/80 cursor-pointer transition-colors group"
                  data-testid={`inventory-row-${p.sku}`}
                >
                  <TableCell className="font-mono text-xs text-graphite">{p.sku}</TableCell>
                  <TableCell className="font-medium text-ink">
                    <span className="inline-flex items-center gap-1.5 group-hover:text-amber">
                      {p.name}
                      <ArrowUpRight className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                    </span>
                  </TableCell>
                  <TableCell className="text-graphite">{p.category || "—"}</TableCell>
                  <TableCell className="text-right font-mono">{p.units_in_network.toLocaleString()}</TableCell>
                  <TableCell className="text-right text-graphite">{p.distributor_count}</TableCell>
                  <TableCell className="text-right font-mono text-moss">{fmtMoney(p.revenue_90d)}</TableCell>
                  <TableCell data-testid={`velocity-cell-${p.sku}`}>
                    <VelocityCell points={p.sparkline_30d || []} trendPct={p.trend_pct_7d} />
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={p.status === "active"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-stone-50 text-graphite border-stone-200"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ProductDrawer
        open={!!selectedProductId}
        onOpenChange={(o) => { if (!o) setSelectedProductId(null); }}
        manufacturerId={session.entity.id}
        productId={selectedProductId}
        onUpdated={load}
      />
    </div>
  );
}

function SummaryStat({ label, value, tone = "default" }) {
  const toneClass = tone === "moss" ? "text-moss" : "text-ink";
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-graphite">{label}</div>
      <div className={`font-display text-2xl tracking-tight mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline 30-day velocity sparkline + 7d-vs-prior-7d trend chip
// ---------------------------------------------------------------------------
function VelocityCell({ points, trendPct }) {
  const isEmpty = !points || points.length === 0 || points.every((v) => v === 0);
  if (isEmpty) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-graphite/70">
        <Minus className="h-3 w-3" /> no sales
      </div>
    );
  }
  const w = 96, h = 26;
  const max = Math.max(...points, 1);
  const step = w / Math.max(points.length - 1, 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - (p / max) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  const area = `${path} L ${w} ${h} L 0 ${h} Z`;
  const up = (trendPct ?? 0) >= 0;
  const stroke = up ? "#0F766E" : "#D97706";
  const fill = up ? "rgba(15,118,110,0.18)" : "rgba(217,119,6,0.18)";
  const TrendIcon = trendPct === null || trendPct === 0 ? Minus : up ? TrendingUp : TrendingDown;
  const trendLabel = trendPct === null
    ? "—"
    : `${up ? "+" : ""}${trendPct.toFixed(0)}%`;
  return (
    <div className="flex items-center gap-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-[96px] h-[26px] flex-shrink-0" preserveAspectRatio="none">
        <path d={area} fill={fill} />
        <path d={path} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        <circle
          cx={(points.length - 1) * step}
          cy={h - (points[points.length - 1] / max) * (h - 2) - 1}
          r="1.5" fill={stroke}
        />
      </svg>
      <span
        className={`inline-flex items-center gap-0.5 text-[10px] font-mono ${
          trendPct === null || trendPct === 0 ? "text-graphite" : up ? "text-moss" : "text-amber"
        }`}
        title="7-day vs prior 7-day units sold"
      >
        <TrendIcon className="h-2.5 w-2.5" />
        {trendLabel}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distributor / Retailer inventory — unchanged behaviour, just kept here
// ---------------------------------------------------------------------------
function DistributorRetailerInventory({ session, role }) {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    Api.inventory(role, session.entity.id).then(setItems);
  }, [role, session.entity.id]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) =>
      (i.product?.name || "").toLowerCase().includes(s) ||
      (i.product?.sku || "").toLowerCase().includes(s) ||
      (i.product?.category || "").toLowerCase().includes(s)
    );
  }, [items, search]);

  const lowCount = items.filter((i) => i.quantity <= i.reorder_level).length;

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid={`${role}-inventory-view`}>
      <PageHeader
        title="Inventory"
        description={role === "distributor" ? "Stock you hold and ship to retailers." : "Stock currently on your shelves."}
        actions={
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search products…" className="pl-9 w-72" data-testid="inventory-search" />
          </div>
        }
      />
      {lowCount > 0 && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4" />
          {lowCount} SKU{lowCount === 1 ? "" : "s"} at or below reorder level.
        </div>
      )}
      <Card>
        <CardContent className="p-0">
          <Table data-testid="inventory-table">
            <TableHeader><TableRow>
              <TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Category</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">Reorder Level</TableHead>
              <TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500 py-12">
                    No inventory matches your search.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((i) => {
                const low = i.quantity <= i.reorder_level;
                const isClickable = role === "distributor" && i.product?.id;
                const productLink = isClickable ? `/inventory/product/${i.product.id}` : null;
                return (
                  <TableRow key={i.id} data-testid={`inventory-row-${i.product?.sku}`}
                            className={isClickable ? "hover:bg-slate-50/60 cursor-pointer transition-colors" : ""}>
                    <TableCell className="font-mono text-xs text-slate-500">{i.product?.sku}</TableCell>
                    <TableCell className="font-medium text-slate-900">
                      {productLink ? (
                        <Link to={productLink} className="inline-flex items-center gap-1 hover:text-indigo-600 group">
                          {i.product?.name}
                          <ArrowUpRight className="h-3 w-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        </Link>
                      ) : (i.product?.name)}
                    </TableCell>
                    <TableCell className="text-slate-600">{i.product?.category}</TableCell>
                    <TableCell className="text-right font-semibold">{i.quantity}</TableCell>
                    <TableCell className="text-right text-slate-500">{i.reorder_level}</TableCell>
                    <TableCell>
                      {low ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">Low stock</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Healthy</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
