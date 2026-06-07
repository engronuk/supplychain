/**
 * Reusable PO status badge with a consistent color system across the
 * whole Procurement workspace (Cart, Purchase Orders, Order History,
 * Distributor Inbox).
 */
export default function POStatusBadge({ status }) {
  const map = {
    draft:      { label: "Draft",      bg: "bg-slate-100",   fg: "text-slate-700",   ring: "ring-slate-200" },
    submitted:  { label: "Submitted",  bg: "bg-violet-100",  fg: "text-violet-800",  ring: "ring-violet-200" },
    approved:   { label: "Approved",   bg: "bg-blue-100",    fg: "text-blue-800",    ring: "ring-blue-200" },
    processing: { label: "Processing", bg: "bg-amber-100",   fg: "text-amber-800",   ring: "ring-amber-200" },
    shipped:    { label: "Shipped",    bg: "bg-indigo-100",  fg: "text-indigo-800",  ring: "ring-indigo-200" },
    delivered:  { label: "Delivered",  bg: "bg-emerald-100", fg: "text-emerald-800", ring: "ring-emerald-200" },
    cancelled:  { label: "Cancelled",  bg: "bg-slate-200",   fg: "text-slate-600",   ring: "ring-slate-300" },
    rejected:   { label: "Rejected",   bg: "bg-rose-100",    fg: "text-rose-800",    ring: "ring-rose-200" },
  };
  const m = map[status] || map.draft;
  return (
    <span
      className={`inline-flex items-center h-6 rounded-full px-2.5 text-[11px] font-semibold ring-1 ${m.bg} ${m.fg} ${m.ring}`}
      data-testid={`po-status-${status}`}
    >
      {m.label}
    </span>
  );
}
