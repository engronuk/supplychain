import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const FMT_CCY = new Intl.NumberFormat("en-NG", {
  style: "currency", currency: "NGN", maximumFractionDigits: 0,
});
const FMT_NUM = new Intl.NumberFormat("en-US");

export function fmtCurrency(n) {
  if (n == null || isNaN(n)) return "—";
  return FMT_CCY.format(n);
}
export function fmtNumber(n) {
  if (n == null || isNaN(n)) return "—";
  return FMT_NUM.format(n);
}
export function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  return `${Number(n).toFixed(1)}%`;
}

export function KpiCard({ icon: Icon, label, value, hint, tone = "default", testid }) {
  const toneMap = {
    default: "bg-white border-slate-200",
    positive: "bg-emerald-50 border-emerald-200",
    warning: "bg-amber-50 border-amber-200",
    alert: "bg-rose-50 border-rose-200",
  };
  return (
    <Card
      className={cn("border", toneMap[tone] || toneMap.default)}
      data-testid={testid}
    >
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-wider text-slate-500 font-medium">
            {label}
          </span>
          {Icon && <Icon className="h-4 w-4 text-slate-400" />}
        </div>
        <div className="text-2xl font-semibold text-slate-900 leading-tight">
          {value}
        </div>
        {hint && (
          <div className="text-xs text-slate-500">{hint}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function HealthBadge({ status }) {
  const map = {
    healthy: { label: "Healthy", cls: "bg-emerald-100 text-emerald-700" },
    low:     { label: "Low",     cls: "bg-amber-100 text-amber-700" },
    out:     { label: "Out",     cls: "bg-rose-100 text-rose-700" },
    excess:  { label: "Excess",  cls: "bg-indigo-100 text-indigo-700" },
  };
  const cfg = map[status] || { label: status, cls: "bg-slate-100 text-slate-700" };
  return <Badge className={cn("font-medium", cfg.cls)}>{cfg.label}</Badge>;
}

export function StatusBadge({ status }) {
  const map = {
    draft:      "bg-slate-100 text-slate-700",
    submitted:  "bg-blue-100 text-blue-700",
    approved:   "bg-violet-100 text-violet-700",
    allocated:  "bg-amber-100 text-amber-700",
    shipped:    "bg-sky-100 text-sky-700",
    delivered:  "bg-emerald-100 text-emerald-700",
    rejected:   "bg-rose-100 text-rose-700",
    cancelled:  "bg-slate-200 text-slate-700",
  };
  return (
    <Badge className={cn("font-medium", map[status] || "bg-slate-100 text-slate-700")}>
      {status}
    </Badge>
  );
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-end justify-between gap-4 pb-6 border-b border-slate-200">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {body && <div className="mt-1 text-xs text-slate-500">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ToneCard({ tone = "neutral", title, body }) {
  const map = {
    positive: "border-emerald-200 bg-emerald-50 text-emerald-900",
    neutral:  "border-slate-200 bg-slate-50 text-slate-900",
    warning:  "border-amber-200 bg-amber-50 text-amber-900",
    alert:    "border-rose-200 bg-rose-50 text-rose-900",
  };
  return (
    <div className={cn("rounded-lg border p-3", map[tone] || map.neutral)}>
      <div className="text-sm font-medium">{title}</div>
      {body && <div className="text-xs mt-1 opacity-80">{body}</div>}
    </div>
  );
}
