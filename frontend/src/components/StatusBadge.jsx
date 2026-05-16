import { Badge } from "@/components/ui/badge";
import { Clock, Truck, PackageCheck, CircleSlash, CircleCheck } from "lucide-react";

const SHIPMENT_STATUS = {
  pending: {
    label: "Pending",
    cls: "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100",
    Icon: Clock,
  },
  in_transit: {
    label: "In Transit",
    cls: "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-50",
    Icon: Truck,
  },
  received: {
    label: "Received",
    cls: "bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-50",
    Icon: PackageCheck,
  },
};

const REQUEST_STATUS = {
  pending: { label: "Pending", cls: "bg-slate-100 text-slate-700 border-slate-200", Icon: Clock },
  approved: { label: "Approved", cls: "bg-blue-50 text-blue-800 border-blue-200", Icon: CircleCheck },
  rejected: { label: "Rejected", cls: "bg-rose-50 text-rose-800 border-rose-200", Icon: CircleSlash },
  fulfilled: { label: "Fulfilled", cls: "bg-emerald-50 text-emerald-800 border-emerald-200", Icon: PackageCheck },
};

export function StatusBadge({ status, kind = "shipment" }) {
  const map = kind === "request" ? REQUEST_STATUS : SHIPMENT_STATUS;
  const def = map[status] || { label: status, cls: "bg-slate-100 text-slate-700 border-slate-200", Icon: Clock };
  const Icon = def.Icon;
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 font-medium border ${def.cls}`}
      data-testid={`status-badge-${status}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {def.label}
    </Badge>
  );
}
