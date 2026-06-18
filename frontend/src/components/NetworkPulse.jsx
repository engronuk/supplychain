/**
 * NetworkPulse — live ticker of cross-tier inventory movements.
 *
 * Polls `/api/manufacturer/{id}/network-pulse` every 15s (long-polls via
 * the `since_iso` cursor so we never re-fetch the same window) and
 * renders the last 10 receipts with a humanised summary like:
 *   "150 units of Vaseline Blue Seal 250ml received at
 *    Apex Distributors (Apapa) from Unilever Lagos Warehouse"
 *
 * Designed to live on the manufacturer executive dashboard so the
 * "always-on" feel of the platform is visible without leaving the page.
 */
import { useEffect, useRef, useState } from "react";
import api from "@/lib/api";
import { Activity, Truck, Warehouse, Building2, Store, Factory } from "lucide-react";

const ROLE_ICON = {
  warehouse: Warehouse,
  distributor: Building2,
  wholesaler: Truck,
  retailer: Store,
  manufacturer: Factory,
};

const ROLE_DOT = {
  warehouse:   "bg-amber-500",
  distributor: "bg-violet-500",
  wholesaler:  "bg-sky-500",
  retailer:    "bg-emerald-500",
  manufacturer: "bg-slate-700",
};

const formatRelative = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (diff < 60)  return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

export default function NetworkPulse({ manufacturerId, limit = 10 }) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [newIds, setNewIds] = useState(new Set());
  const lastTsRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!manufacturerId) return undefined;
    let cancelled = false;

    const fetchPulse = async (initial = false) => {
      try {
        const qs = new URLSearchParams({ limit: String(limit) });
        if (lastTsRef.current && !initial) qs.set("since_iso", lastTsRef.current);
        const resp = await api.get(
          `/manufacturer/${manufacturerId}/network-pulse?${qs.toString()}`,
        );
        const data = resp?.data;
        if (cancelled) return;
        const incoming = (data?.events) || [];
        if (initial) {
          setEvents(incoming);
          if (incoming.length) lastTsRef.current = incoming[0].occurred_at;
        } else if (incoming.length) {
          // Merge new events at the top, capped at `limit`.
          setEvents(prev => {
            const merged = [...incoming, ...prev];
            // de-dup by id and slice
            const seen = new Set();
            const deduped = merged.filter(e => {
              if (seen.has(e.id)) return false;
              seen.add(e.id);
              return true;
            });
            return deduped.slice(0, limit);
          });
          setNewIds(new Set(incoming.map(e => e.id)));
          lastTsRef.current = incoming[0].occurred_at;
          // clear flash after 1.6s
          setTimeout(() => { if (!cancelled) setNewIds(new Set()); }, 1600);
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e?.message || "Pulse offline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchPulse(true);
    pollRef.current = setInterval(() => fetchPulse(false), 15_000);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [manufacturerId, limit]);

  return (
    <div
      data-testid="network-pulse-widget"
      className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-neutral-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Activity className="w-5 h-5 text-emerald-600" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500" />
          </div>
          <div>
            <div className="text-sm font-semibold text-neutral-900">
              Network Pulse
            </div>
            <div className="text-xs text-neutral-500">
              Live cross-tier movements · refreshes every 15s
            </div>
          </div>
        </div>
        <div className="text-[11px] text-neutral-400 uppercase tracking-wider">
          Last {limit}
        </div>
      </div>

      <div className="divide-y divide-neutral-100 max-h-[420px] overflow-y-auto">
        {loading && events.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-neutral-400">
            Listening for movements…
          </div>
        )}
        {!loading && error && events.length === 0 && (
          <div
            className="px-6 py-8 text-center text-sm text-rose-500"
            data-testid="network-pulse-error"
          >
            {error}
          </div>
        )}
        {!loading && !error && events.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-neutral-400">
            No recent movements yet. The next delivery will land here.
          </div>
        )}
        {events.map((ev) => {
          const toRole = ev?.to?.role || "retailer";
          const ToIcon = ROLE_ICON[toRole] || Store;
          const fromRole = ev?.from?.role;
          const FromIcon = fromRole ? ROLE_ICON[fromRole] : null;
          const isFresh = newIds.has(ev.id);
          return (
            <div
              key={ev.id}
              data-testid={`pulse-event-${ev.id}`}
              className={`px-6 py-3.5 flex items-start gap-4 transition-colors duration-1000 ${
                isFresh ? "bg-emerald-50" : "bg-white hover:bg-neutral-50"
              }`}
            >
              <div className="flex items-center gap-1.5 mt-0.5 flex-shrink-0">
                {FromIcon && (
                  <>
                    <FromIcon className="w-4 h-4 text-neutral-400" />
                    <div className="text-neutral-300">→</div>
                  </>
                )}
                <div className={`w-7 h-7 rounded-lg ${ROLE_DOT[toRole]} bg-opacity-10 flex items-center justify-center`}>
                  <ToIcon className={`w-3.5 h-3.5 ${ROLE_DOT[toRole].replace('bg-', 'text-')}`} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-neutral-800 leading-snug">
                  <span className="font-semibold text-neutral-900">
                    {ev.units.toLocaleString()}
                  </span>
                  <span className="text-neutral-500"> units of </span>
                  <span className="font-medium text-neutral-800">
                    {ev?.product?.name || "items"}
                  </span>
                  <span className="text-neutral-500"> received at </span>
                  <span className="font-semibold text-neutral-900">
                    {ev?.to?.name || "destination"}
                  </span>
                  {ev?.from?.name && (
                    <>
                      <span className="text-neutral-500"> from </span>
                      <span className="font-medium text-neutral-700">
                        {ev.from.name}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-[11px] text-neutral-400 mt-1 flex items-center gap-2">
                  <span>{formatRelative(ev.occurred_at)}</span>
                  {ev.tracking_code && (
                    <>
                      <span className="text-neutral-300">·</span>
                      <span className="font-mono">{ev.tracking_code}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
