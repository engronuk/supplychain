// Shared small components used across WMS pages.
import { ChevronRight } from "lucide-react";

export const naira = (v) =>
  "₦" + new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 }).format(v || 0);
export const num = (v) =>
  new Intl.NumberFormat("en-NG").format(v || 0);

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between gap-6 mb-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </div>
  );
}

export function Card({ children, className = "", padding = "p-6" }) {
  return (
    <div className={`rounded-2xl bg-white border border-slate-200/80 shadow-sm ${padding} ${className}`}>
      {children}
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center" data-testid="empty-state">
      <div className="font-semibold text-slate-700">{title}</div>
      {description && <div className="text-sm text-slate-500 mt-2 max-w-xl mx-auto">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  const c = {
    received:    "bg-emerald-50 text-emerald-700 border-emerald-200",
    pending:     "bg-amber-50 text-amber-700 border-amber-200",
    dispatched:  "bg-blue-50 text-blue-700 border-blue-200",
    in_transit:  "bg-violet-50 text-violet-700 border-violet-200",
    delivered:   "bg-emerald-50 text-emerald-700 border-emerald-200",
    cancelled:   "bg-rose-50 text-rose-700 border-rose-200",
  }[status] || "bg-slate-50 text-slate-700 border-slate-200";
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-md border text-xs font-medium ${c}`}>{status?.replace("_", " ")}</span>;
}

export function Crumbs({ items }) {
  return (
    <nav className="text-sm text-slate-500 flex items-center gap-1 mb-4">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
          {it.href ? <a href={it.href} className="hover:text-slate-700">{it.label}</a> : <span className="text-slate-700 font-medium">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}
