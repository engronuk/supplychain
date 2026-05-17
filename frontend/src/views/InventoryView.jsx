import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, AlertTriangle, ArrowUpRight } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export default function InventoryView() {
  const { session } = useSession();
  const role = session.role; // distributor | retailer
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
        description={
          role === "distributor"
            ? "Stock you hold and ship to retailers."
            : "Stock currently on your shelves."
        }
        actions={
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="pl-9 w-72"
              data-testid="inventory-search"
            />
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
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Reorder Level</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
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
                      ) : (
                        i.product?.name
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600">{i.product?.category}</TableCell>
                    <TableCell className="text-right font-semibold">{i.quantity}</TableCell>
                    <TableCell className="text-right text-slate-500">{i.reorder_level}</TableCell>
                    <TableCell>
                      {low ? (
                        <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">
                          Low stock
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                          Healthy
                        </Badge>
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
