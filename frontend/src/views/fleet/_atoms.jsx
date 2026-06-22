/**
 * Shared Fleet UI atoms — Phase B4+
 *
 * Single source of truth for severity badges, status pills, drawer chrome,
 * and the colour conventions referenced in FLEET_UX_ARCHITECTURE.md §2.
 */
import { X } from "lucide-react";
import { useEffect } from "react";

export const SEVERITY_STYLES = {
  expired:  "bg-rose-100 text-rose-700 border-rose-300",
  critical: "bg-rose-50 text-rose-700 border-rose-300",
  high:     "bg-amber-100 text-amber-800 border-amber-300",
  warning:  "bg-amber-50 text-amber-700 border-amber-200",
  info:     "bg-sky-50 text-sky-700 border-sky-200",
  ok:       "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export const DRIVER_STATUS_STYLES = {
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  assigned:  "bg-sky-50 text-sky-700 border-sky-200",
  on_trip:   "bg-violet-50 text-violet-700 border-violet-200",
  offline:   "bg-slate-100 text-slate-600 border-slate-200",
  invited:   "bg-amber-50 text-amber-700 border-amber-200",
};

export const VEHICLE_STATUS_STYLES = {
  available:   "bg-emerald-50 text-emerald-700 border-emerald-200",
  loading:     "bg-amber-50 text-amber-700 border-amber-200",
  in_transit:  "bg-sky-50 text-sky-700 border-sky-200",
  maintenance: "bg-violet-50 text-violet-700 border-violet-200",
  offline:     "bg-slate-100 text-slate-600 border-slate-200",
};

export function SeverityBadge({ severity, "data-testid": testid }) {
  if (!severity) return null;
  const style = SEVERITY_STYLES[severity] || SEVERITY_STYLES.ok;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${style}`}
      data-testid={testid || `severity-${severity}`}
    >
      {severity}
    </span>
  );
}

export function StatusPill({ status, kind = "driver", "data-testid": testid }) {
  if (!status) return null;
  const map = kind === "vehicle" ? VEHICLE_STATUS_STYLES : DRIVER_STATUS_STYLES;
  const style = map[status] || "bg-slate-100 text-slate-700 border-slate-200";
  const label = status.replace(/_/g, " ");
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${style}`}
      data-testid={testid || `status-${status}`}
    >
      {label}
    </span>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, "data-testid": testid }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" data-testid={testid || "drawer"}>
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
        data-testid="drawer-scrim"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[640px] bg-white shadow-2xl flex flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900" data-testid="drawer-title">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            data-testid="drawer-close"
            className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <footer className="border-t border-slate-200 bg-slate-50 px-6 py-4">{footer}</footer>
        )}
      </aside>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-4" data-testid="drawer-tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          data-testid={`tab-${t.value}`}
          className={[
            "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
            value === t.value
              ? "border-slate-900 text-slate-900"
              : "border-transparent text-slate-500 hover:text-slate-700",
          ].join(" ")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function FilterChips({ chips }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => (
        <button
          key={c.id}
          onClick={c.onClick}
          data-testid={c.testid}
          className={[
            "rounded-full border px-3 py-1 text-sm transition-colors",
            c.active
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
          ].join(" ")}
        >
          {c.label}{c.count != null && <span className="ml-1.5 opacity-75 tabular-nums">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ label, value, "data-testid": testid }) {
  return (
    <div className="grid grid-cols-3 gap-3 py-1.5 text-sm" data-testid={testid}>
      <div className="text-slate-500">{label}</div>
      <div className="col-span-2 text-slate-900 break-words">{value ?? <span className="text-slate-400">—</span>}</div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" data-testid="confirm-dialog">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl p-6">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            data-testid="confirm-cancel"
            className="rounded-full border border-slate-200 px-4 py-1.5 text-sm hover:bg-slate-50"
          >Cancel</button>
          <button
            onClick={onConfirm}
            data-testid="confirm-ok"
            className={`rounded-full px-4 py-1.5 text-sm font-medium text-white ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-slate-900 hover:bg-slate-800"}`}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
