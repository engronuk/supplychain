import { useEffect, useMemo, useState } from "react";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Search, Warehouse, Store } from "lucide-react";

export default function NetworkView() {
  const { session } = useSession();
  const role = session.role;
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (role === "manufacturer") {
      Api.distributors(session.entity.id).then(setItems);
    } else if (role === "distributor") {
      Api.retailers(session.entity.id).then(setItems);
    } else {
      setItems([]);
    }
  }, [role, session.entity.id]);

  const isMfg = role === "manufacturer";
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return items;
    return items.filter((x) =>
      (x.name || "").toLowerCase().includes(s) ||
      (x.region || "").toLowerCase().includes(s) ||
      (x.city || "").toLowerCase().includes(s)
    );
  }, [items, search]);

  const title = isMfg ? "Distributors" : "Retailers";
  const desc = isMfg
    ? "All distributors carrying your products."
    : "All retailers connected to this distributor.";

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="network-view">
      <PageHeader
        title={title}
        description={desc}
        actions={
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              className="pl-9 w-72"
              data-testid="network-search"
            />
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
        {isMfg ? <Warehouse className="h-4 w-4" /> : <Store className="h-4 w-4" />}
        <span>
          <span className="font-semibold text-slate-900">{filtered.length}</span> {title.toLowerCase()}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table data-testid="network-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>City</TableHead>
                {!isMfg && <TableHead>Address</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={isMfg ? 3 : 4} className="text-center text-slate-500 py-12">
                    No matches.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((x) => (
                <TableRow key={x.id} data-testid={`network-row-${x.id}`}>
                  <TableCell className="font-medium text-slate-900">{x.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                      {x.region || "—"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">{x.city || "—"}</TableCell>
                  {!isMfg && (
                    <TableCell className="text-slate-500 text-sm max-w-md truncate">{x.address || "—"}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
