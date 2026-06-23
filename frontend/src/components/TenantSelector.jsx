/**
 * Tenant selector — modal + sidebar pill.
 *
 * Renders a Shadcn dialog with one card per available tenant when
 * `pickerOpen` is true. The sidebar pill (`TenantPill`) is the compact
 * always-visible variant — clicking it re-opens the picker.
 */
import { Building2, Check, ChevronDown } from "lucide-react";
import { useTenant } from "@/context/TenantContext";

export function TenantSelectorModal() {
  const { pickerOpen, closePicker, tenants, active, switchTo, multiTenant } = useTenant();
  if (!pickerOpen || !multiTenant) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      data-testid="tenant-selector-modal"
      onClick={closePicker}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-slate-100">
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.2em] text-slate-500 font-semibold">
            <Building2 className="h-3 w-3" /> Choose Manufacturer Scope
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">
            Which tenant do you want to work in?
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Your account serves {tenants.length} manufacturers. Pick one — you can switch
            anytime from the sidebar.
          </p>
        </div>
        <ul className="p-3 max-h-[60vh] overflow-y-auto">
          {tenants.map((t) => {
            const isActive = t.entity_id === active?.entity_id;
            return (
              <li key={t.entity_id}>
                <button
                  type="button"
                  data-testid={`tenant-option-${t.manufacturer_id || "unknown"}`}
                  onClick={() => switchTo(t.entity_id)}
                  className={`w-full text-left rounded-xl px-4 py-3 mb-2 border transition flex items-start gap-3 ${
                    isActive
                      ? "border-indigo-300 bg-indigo-50 ring-2 ring-indigo-200"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <Building2 className={`mt-0.5 h-5 w-5 shrink-0 ${
                    isActive ? "text-indigo-600" : "text-slate-400"
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">
                      {t.manufacturer_name || "Unknown manufacturer"}
                    </div>
                    <div className="text-xs text-slate-500 truncate mt-0.5">
                      {t.entity_name}{t.entity_city ? ` · ${t.entity_city}` : ""}
                    </div>
                  </div>
                  {isActive && <Check className="h-5 w-5 text-indigo-600 shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end">
          <button
            type="button"
            onClick={closePicker}
            data-testid="tenant-selector-close"
            className="text-xs text-slate-500 hover:text-slate-900"
          >Close</button>
        </div>
      </div>
    </div>
  );
}

export function TenantPill() {
  const { multiTenant, active, openPicker } = useTenant();
  if (!multiTenant || !active) return null;
  return (
    <button
      type="button"
      onClick={openPicker}
      data-testid="tenant-pill"
      title="Switch manufacturer scope"
      className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition w-full"
    >
      <Building2 className="h-3.5 w-3.5" />
      <span className="truncate flex-1 text-left">{active.manufacturer_name || "Tenant"}</span>
      <ChevronDown className="h-3 w-3 opacity-70" />
    </button>
  );
}
