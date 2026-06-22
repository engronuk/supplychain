/**
 * Compliance Centre — Phase 5
 *
 * Two tabs:
 *   Board    → drivers + vehicles grouped by severity, with deep links to
 *              the registry detail drawers for inline expiry updates.
 *   Activity → transition audit log from db.fleet_compliance_log with
 *              acknowledge dialog.
 *
 * Backed by:
 *   GET  /api/fleet/compliance/board
 *   GET  /api/fleet/compliance/log
 *   POST /api/fleet/compliance/log/:log_id/ack
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ShieldAlert, AlertTriangle, RefreshCw, Check, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { Drawer, SeverityBadge, FilterChips, KeyValue } from "./_atoms";

const SEVERITY_ORDER = ["expired", "critical", "high", "warning", "info", "ok"];

function AckDrawer({ open, entry, onClose, onAcked }) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setNote(""); setError(null); }, [open, entry?.id]);

  const submit = async () => {
    if (note.trim().length < 5) { setError("Note must be at least 5 characters."); return; }
    setSaving(true); setError(null);
    try {
      await api.post(`/fleet/compliance/log/${entry.id}/ack`, { note: note.trim() });
      onAcked?.();
      onClose();
    } catch (e) { setError(e?.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Acknowledge compliance event"
      subtitle={entry && `${entry.entity_type} · ${entry.from_severity} → ${entry.to_severity}`}
      data-testid="ack-drawer"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full border border-slate-200 px-4 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} data-testid="ack-submit" className="rounded-full bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? "Saving…" : "Acknowledge"}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" data-testid="ack-error">{String(error)}</div>}
        {entry && (
          <>
            <KeyValue label="Entity" value={`${entry.entity_type} ${entry.entity_id?.slice(0, 8)}`} />
            <KeyValue label="From" value={<SeverityBadge severity={entry.from_severity} />} />
            <KeyValue label="To" value={<SeverityBadge severity={entry.to_severity} />} />
            <KeyValue label="At" value={entry.created_at?.slice(0, 16).replace("T", " ")} />
          </>
        )}
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Acknowledgement note (≥5 chars, audited)</span>
          <textarea
            data-testid="ack-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            placeholder="e.g. Driver scheduled to renew on 2026-07-01"
          />
        </label>
      </div>
    </Drawer>
  );
}

function SeverityColumn({ severity, drivers, vehicles }) {
  const items = [
    ...drivers.map((d) => ({ ...d, _type: "driver" })),
    ...vehicles.map((v) => ({ ...v, _type: "vehicle" })),
  ];
  return (
    <div
      className="rounded-2xl border border-slate-200 bg-white"
      data-testid={`column-${severity}`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={severity} />
        </div>
        <span className="text-xs tabular-nums text-slate-500">{items.length}</span>
      </div>
      <div className="space-y-2 p-3 max-h-[460px] overflow-y-auto">
        {items.length === 0 && <p className="text-xs text-slate-400 px-2 py-3">None.</p>}
        {items.map((it) => {
          const isDriver = it._type === "driver";
          const checks = it.compliance?.checks || [];
          const worstCheck = checks
            .filter((c) => c.severity === severity)
            .sort((a, b) => (a.days_remaining || 0) - (b.days_remaining || 0))[0];
          return (
            <Link
              key={`${it._type}-${it.id}`}
              to={isDriver ? `/fleet/drivers/${it.id}` : `/fleet/vehicles/${it.id}`}
              data-testid={`compliance-card-${isDriver ? it.employee_number : it.vehicle_code}`}
              className="block rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">
                  {isDriver ? it.full_name : it.vehicle_code}
                </span>
                <span className="text-xs text-slate-400 uppercase">{it._type}</span>
              </div>
              <div className="text-xs text-slate-500">
                {isDriver ? it.employee_number : it.registration_number}
              </div>
              {worstCheck && (
                <div className="mt-1 text-xs text-slate-600">
                  <span className="capitalize">{worstCheck.kind.replace(/_/g, " ")}</span>
                  {" · "}
                  {worstCheck.days_remaining == null ? "no expiry tracked" :
                    worstCheck.days_remaining < 0 ? `expired ${Math.abs(worstCheck.days_remaining)}d ago` :
                    `${worstCheck.days_remaining}d left`}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function ComplianceCentre() {
  const [tab, setTab] = useState("board");
  const [board, setBoard] = useState(null);
  const [log, setLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unackedOnly, setUnackedOnly] = useState(false);
  const [ackEntry, setAckEntry] = useState(null);

  const fetchAll = async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const [b, l] = await Promise.all([
        api.get("/fleet/compliance/board"),
        api.get(`/fleet/compliance/log?limit=100${unackedOnly ? "&only_unacked=true" : ""}`),
      ]);
      setBoard(b.data);
      setLog(l.data || []);
    } finally {
      setLoading(false); setRefreshing(false);
    }
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [unackedOnly]);

  const visibleSeverities = useMemo(
    () => SEVERITY_ORDER.filter((s) => {
      const b = board?.buckets?.[s];
      return b && (b.drivers + b.vehicles) > 0;
    }),
    [board],
  );

  if (loading) return <Skeleton className="h-96 w-full rounded-2xl" />;

  return (
    <div className="space-y-5" data-testid="compliance-centre">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 flex items-center gap-2">
            <ShieldAlert className="h-6 w-6" /> Compliance Centre
          </h1>
          <p className="text-sm text-slate-500">
            Drivers and vehicles grouped by expiry severity · last evaluated daily
          </p>
        </div>
        <button
          onClick={() => fetchAll(true)}
          disabled={refreshing}
          data-testid="compliance-refresh"
          className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          data-testid="tab-board"
          onClick={() => setTab("board")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "board" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500"}`}
        >
          Board
        </button>
        <button
          data-testid="tab-activity"
          onClick={() => setTab("activity")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "activity" ? "border-slate-900 text-slate-900" : "border-transparent text-slate-500"}`}
        >
          Activity log
        </button>
      </div>

      {tab === "board" && (
        <div data-testid="board-content">
          {visibleSeverities.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-emerald-700 flex items-center gap-3" data-testid="board-empty">
              <Check className="h-5 w-5" />
              <span className="font-medium">All clear — no expiries to track in this tenant.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {visibleSeverities.map((sev) => (
                <SeverityColumn
                  key={sev}
                  severity={sev}
                  drivers={(board?.drivers || []).filter((d) => (d.compliance_severity || "ok") === sev)}
                  vehicles={(board?.vehicles || []).filter((v) => (v.compliance_severity || "ok") === sev)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "activity" && (
        <div data-testid="activity-content">
          <div className="mb-3">
            <FilterChips
              chips={[
                { id: "all",  label: "All",          active: !unackedOnly, onClick: () => setUnackedOnly(false), testid: "filter-all-events" },
                { id: "unac", label: "Unacked only", active: unackedOnly,  onClick: () => setUnackedOnly(true),  testid: "filter-unacked" },
              ]}
            />
          </div>
          {log.length === 0 ? (
            <p className="text-sm text-slate-400">No compliance transitions yet.</p>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3">From → To</th>
                    <th className="px-4 py-3">Acked</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {log.map((e) => (
                    <tr key={e.id} className="hover:bg-slate-50" data-testid={`log-row-${e.id?.slice(0,8)}`}>
                      <td className="px-4 py-3 text-slate-600">{e.created_at?.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={e.entity_type === "driver"
                            ? `/fleet/drivers/${e.entity_id}`
                            : `/fleet/vehicles/${e.entity_id}`}
                          className="text-indigo-700 hover:underline"
                        >
                          {e.entity_type} {e.entity_id?.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 flex items-center gap-1">
                        <SeverityBadge severity={e.from_severity} />
                        <ChevronRight className="h-3 w-3 text-slate-400" />
                        <SeverityBadge severity={e.to_severity} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {e.acknowledged_at ? (
                          <span className="text-emerald-700">
                            <Check className="inline h-3.5 w-3.5" /> {e.acknowledged_at.slice(0, 10)}
                          </span>
                        ) : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {!e.acknowledged_at && (
                          <button
                            onClick={() => setAckEntry(e)}
                            data-testid={`ack-btn-${e.id?.slice(0,8)}`}
                            className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs hover:bg-slate-50"
                          >Acknowledge</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <AckDrawer
        open={!!ackEntry}
        entry={ackEntry}
        onClose={() => setAckEntry(null)}
        onAcked={() => fetchAll(true)}
      />
    </div>
  );
}
