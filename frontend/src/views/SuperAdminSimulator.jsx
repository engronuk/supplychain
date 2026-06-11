/**
 * Super Admin · Activity Simulator Control Panel
 *
 * Lets the super-admin toggle the background simulator, change cadence,
 * force a single tick, seed/cascade-tag demo participants, inspect recent
 * run logs and hard-purge every SYSTEM_SIMULATOR-tagged record.
 *
 * Every backend write returns the full status payload — we refresh on each
 * action so the panel always reflects the canonical server state.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  FlaskConical,
  Gauge,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCcw,
  Sparkles,
  Tags,
  Trash2,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { SimApi } from "@/lib/api";

const LEVELS = [
  { key: "low",    label: "Low",    cadence: "every 10 min", tone: "bg-stone-100 text-ink" },
  { key: "medium", label: "Medium", cadence: "every 3 min",  tone: "bg-amber/10 text-amber" },
  { key: "high",   label: "High",   cadence: "every 1 min",  tone: "bg-rose-50 text-rose-700" },
];

const TYPE_LABELS = {
  manufacturer: "Manufacturers",
  warehouse: "Warehouses",
  distributor: "Distributors",
  wholesaler: "Wholesalers",
  retailer: "Retailers",
};

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      hour12: false,
      year: undefined,
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function relTime(iso) {
  if (!iso) return "never";
  const diff = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function SuperAdminSimulator() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(""); // action in flight
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      SimApi.status()
        .then((d) => {
          if (!cancelled) setStatus(d);
        })
        .catch((e) => {
          if (!cancelled) {
            toast.error(e?.response?.data?.detail || "Failed to load simulator");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    load();
    const t = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [reloadKey]);

  const settings = status?.settings || {};
  const intervals = status?.intervals_sec || {};
  const participants = status?.participants || { total: 0, by_type: {}, list: [] };
  const counts = status?.generated_counts || {};
  const runs = status?.recent_runs || [];

  const totalGenerated = useMemo(
    () => Object.values(counts).reduce((a, b) => a + (b || 0), 0),
    [counts],
  );

  const onToggle = async (next) => {
    setBusy("toggle");
    // Optimistic: reflect the new enabled state immediately so the Status
    // KPI doesn't sit on 'Starting…' until the 15s poll catches up.
    setStatus((s) =>
      s ? { ...s, settings: { ...s.settings, enabled: next }, running: next } : s,
    );
    try {
      await SimApi.toggle(next);
      toast.success(next ? "Simulator resumed" : "Simulator paused");
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Toggle failed");
      refresh(); // server is source of truth; reconcile on error
    } finally {
      setBusy("");
    }
  };

  const onLevel = async (lvl) => {
    setBusy(`level-${lvl}`);
    // Optimistic: snap the active cadence chip immediately.
    setStatus((s) =>
      s ? { ...s, settings: { ...s.settings, activity_level: lvl } } : s,
    );
    try {
      await SimApi.level(lvl);
      toast.success(`Cadence → ${lvl}`);
      refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Level change failed");
      refresh();
    } finally {
      setBusy("");
    }
  };

  const onTick = async () => {
    setBusy("tick");
    try {
      const res = await SimApi.tick();
      toast.success("Tick fired", {
        description: `Total events so far: ${res?.total_events ?? "—"}`,
      });
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Tick failed");
    } finally {
      setBusy("");
    }
  };

  const onSeed = async () => {
    setBusy("seed");
    try {
      const res = await SimApi.seedDemo();
      toast.success("Demo participants tagged", {
        description: `${res.primary_modified} primary + ${res.retailers_cascaded} cascaded retailers · ${res.total_participants} total`,
      });
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Seed failed");
    } finally {
      setBusy("");
    }
  };

  const onClearParticipants = async () => {
    setBusy("clear");
    try {
      const res = await SimApi.clearParticipants();
      toast.success(`Untagged ${res.untagged} participants`);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Clear failed");
    } finally {
      setBusy("");
    }
  };

  const onPurge = async () => {
    setBusy("purge");
    try {
      const res = await SimApi.purge();
      toast.success("Generated data purged", {
        description: `${res.total_deleted} docs deleted across ${Object.keys(res.deleted || {}).length} collections`,
      });
      setPurgeOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Purge failed");
    } finally {
      setBusy("");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-graphite gap-2" data-testid="sim-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading simulator…
      </div>
    );
  }

  const running = Boolean(status?.running);
  const enabled = Boolean(settings.enabled);
  const currentLevel = settings.activity_level || "low";

  return (
    <div className="space-y-8" data-testid="super-admin-simulator">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-2">
            <FlaskConical className="h-3.5 w-3.5" /> Activity Simulator
          </div>
          <h2 className="font-display text-3xl tracking-tight mt-2">
            The background heartbeat.
          </h2>
          <p className="text-graphite text-sm mt-2 max-w-xl">
            Generates realistic low-volume activity against tagged demo entities so
            dashboards, forecasts and the control tower stay alive when nobody is
            signed in. Every generated record is marked{" "}
            <code className="text-[11px] bg-stone-100 px-1 py-0.5 rounded">
              generated_by={status?.marker}
            </code>{" "}
            so a single purge wipes them all.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            className="border-stone-300"
            data-testid="sim-refresh-btn"
          >
            <RefreshCcw className="h-3.5 w-3.5 mr-1.5" /> Refresh
          </Button>
        </div>
      </header>

      {/* Status row */}
      <section className="grid md:grid-cols-4 gap-4">
        <KpiCard
          icon={running && enabled ? PlayCircle : PauseCircle}
          label="Status"
          value={
            <Badge
              variant="outline"
              className={
                running && enabled
                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                  : "border-stone-300 text-graphite"
              }
              data-testid="sim-status-badge"
            >
              {running && enabled ? "Running" : enabled ? "Starting…" : "Paused"}
            </Badge>
          }
          hint={`loop ${running ? "alive" : "stopped"}`}
        />
        <KpiCard
          icon={Gauge}
          label="Cadence"
          value={
            <span className="font-display text-2xl text-ink capitalize">
              {currentLevel}
            </span>
          }
          hint={`every ${Math.round((intervals[currentLevel] || 600) / 60)} min`}
        />
        <KpiCard
          icon={Clock}
          label="Last tick"
          value={
            <span className="font-display text-2xl text-ink">
              {relTime(settings.last_tick_at)}
            </span>
          }
          hint={fmtTime(settings.last_tick_at)}
        />
        <KpiCard
          icon={TrendingUp}
          label="Events generated"
          value={
            <span className="font-display text-2xl text-ink" data-testid="sim-total-events">
              {settings.total_events ?? 0}
            </span>
          }
          hint={`${settings.total_ticks ?? 0} ticks total`}
        />
      </section>

      {/* Controls */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h3 className="font-display text-lg tracking-tight mb-5 flex items-center gap-2">
          <Activity className="h-4 w-4 text-amber" /> Controls
        </h3>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Enable toggle */}
          <div className="rounded-lg border border-stone-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-ink">Simulation enabled</div>
                <div className="text-xs text-graphite mt-1">
                  When off, the loop sleeps but does not exit.
                </div>
              </div>
              <Switch
                checked={enabled}
                disabled={busy === "toggle"}
                onCheckedChange={onToggle}
                data-testid="sim-enabled-switch"
              />
            </div>
          </div>

          {/* One-shot tick */}
          <div className="rounded-lg border border-stone-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-ink">Force a tick now</div>
                <div className="text-xs text-graphite mt-1">
                  Runs one full generation cycle synchronously and refreshes the panel.
                </div>
              </div>
              <Button
                onClick={onTick}
                disabled={busy === "tick" || participants.total === 0}
                className="bg-ink text-paper hover:bg-ink/90"
                data-testid="sim-tick-btn"
              >
                {busy === "tick" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Zap className="h-3.5 w-3.5 mr-1.5" /> Run tick
                  </>
                )}
              </Button>
            </div>
            {participants.total === 0 && (
              <div className="mt-3 flex items-start gap-2 text-xs text-amber bg-amber/10 rounded px-2 py-1.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  No participants are tagged yet. Use{" "}
                  <span className="font-medium">Seed demo participants</span> below to
                  bootstrap.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Activity level */}
        <div className="mt-6">
          <div className="text-sm font-medium text-ink mb-3">Activity level</div>
          <div className="grid sm:grid-cols-3 gap-3">
            {LEVELS.map((lv) => {
              const active = currentLevel === lv.key;
              return (
                <button
                  key={lv.key}
                  type="button"
                  onClick={() => onLevel(lv.key)}
                  disabled={busy === `level-${lv.key}` || active}
                  className={`rounded-lg border p-4 text-left transition-all ${
                    active
                      ? "border-ink bg-ink text-paper"
                      : "border-stone-300 bg-white hover:border-ink/40"
                  }`}
                  data-testid={`sim-level-${lv.key}`}
                >
                  <div className="text-xs uppercase tracking-wider opacity-80">
                    {lv.label}
                  </div>
                  <div className="font-display text-2xl mt-1">{lv.cadence}</div>
                  {active && (
                    <div className="text-xs opacity-90 mt-2 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Participants + Generated counts */}
      <section className="grid lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg tracking-tight flex items-center gap-2">
              <Users className="h-4 w-4 text-amber" /> Participants
              <Badge variant="outline" className="ml-2 border-stone-300 text-graphite">
                {participants.total}
              </Badge>
            </h3>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onSeed}
                disabled={busy === "seed"}
                className="border-stone-300"
                data-testid="sim-seed-btn"
              >
                {busy === "seed" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    <Sparkles className="h-3 w-3 mr-1.5" /> Seed demo
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onClearParticipants}
                disabled={busy === "clear" || participants.total === 0}
                className="border-stone-300 text-rose-700 hover:bg-rose-50"
                data-testid="sim-clear-participants-btn"
              >
                <Tags className="h-3 w-3 mr-1.5" /> Untag all
              </Button>
            </div>
          </div>

          {/* By-type breakdown */}
          <div className="grid grid-cols-5 gap-2 mb-4">
            {Object.keys(TYPE_LABELS).map((t) => (
              <div
                key={t}
                className="rounded-md bg-stone-50 border border-stone-200 px-2 py-2 text-center"
              >
                <div className="font-display text-xl text-ink">
                  {participants.by_type?.[t] || 0}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-graphite">
                  {TYPE_LABELS[t]}
                </div>
              </div>
            ))}
          </div>

          {/* Roster — virtualization not needed, capped at 500 server-side */}
          <div className="max-h-72 overflow-y-auto border border-stone-200 rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 sticky top-0">
                <tr className="text-left text-graphite text-[11px] uppercase tracking-wider">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Organization</th>
                  <th className="px-3 py-2">Location</th>
                </tr>
              </thead>
              <tbody data-testid="sim-participants-list">
                {participants.list?.length ? (
                  participants.list.map((p) => (
                    <tr key={p.id} className="border-t border-stone-100">
                      <td className="px-3 py-2">
                        <Badge variant="outline" className="border-stone-300 text-graphite capitalize">
                          {p.organization_type}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-ink">
                        {p.organization_name || p.id}
                      </td>
                      <td className="px-3 py-2 text-graphite">
                        {p.city || p.state || p.region || "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-3 py-6 text-center text-graphite">
                      No entities tagged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-stone-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-lg tracking-tight flex items-center gap-2">
              <Database className="h-4 w-4 text-amber" /> Generated data
              <Badge variant="outline" className="ml-2 border-stone-300 text-graphite" data-testid="sim-total-generated">
                {totalGenerated}
              </Badge>
            </h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPurgeOpen(true)}
              disabled={busy === "purge" || totalGenerated === 0}
              className="border-rose-300 text-rose-700 hover:bg-rose-50"
              data-testid="sim-purge-btn"
            >
              <Trash2 className="h-3 w-3 mr-1.5" /> Purge all
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(counts).map(([col, n]) => (
              <div
                key={col}
                className="flex items-center justify-between rounded-md bg-stone-50 border border-stone-200 px-3 py-2"
                data-testid={`sim-count-${col}`}
              >
                <span className="text-xs text-graphite truncate">{col}</span>
                <span className="font-display text-lg text-ink">{n || 0}</span>
              </div>
            ))}
          </div>

          {settings.last_error && (
            <div className="mt-4 flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
              <span>
                <span className="font-medium">Last error:</span>{" "}
                {settings.last_error}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Recent runs */}
      <section className="rounded-xl border border-stone-200 bg-white p-6">
        <h3 className="font-display text-lg tracking-tight mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4 text-amber" /> Recent runs
        </h3>
        {runs.length === 0 ? (
          <div className="text-center text-graphite text-sm py-8">
            No runs logged yet. The first tick will appear here within{" "}
            {Math.round((intervals[currentLevel] || 600) / 60)} minutes — or click{" "}
            <span className="font-medium text-ink">Run tick</span> to force one now.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="sim-runs-table">
              <thead>
                <tr className="text-left text-graphite text-[11px] uppercase tracking-wider border-b border-stone-200">
                  <th className="py-2 pr-3">Started</th>
                  <th className="py-2 pr-3">Level</th>
                  <th className="py-2 pr-3">Events</th>
                  <th className="py-2 pr-3">Breakdown</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r, i) => {
                  const events = r.events || {};
                  const total =
                    typeof events === "object"
                      ? Object.values(events).reduce(
                          (a, b) => a + (Number(b) || 0),
                          0,
                        )
                      : 0;
                  const ok = !(r.errors && r.errors.length);
                  return (
                    <tr key={i} className="border-b border-stone-100 last:border-0">
                      <td className="py-2 pr-3 text-ink">{fmtTime(r.started_at)}</td>
                      <td className="py-2 pr-3 text-graphite capitalize">
                        {r.activity_level || "—"}
                      </td>
                      <td className="py-2 pr-3 font-display text-ink">
                        {r.events_generated ?? total}
                      </td>
                      <td className="py-2 pr-3 text-graphite text-xs">
                        {Object.entries(events)
                          .filter(([, v]) => Number(v) > 0)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ") || "—"}
                      </td>
                      <td className="py-2">
                        {ok ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-300 text-emerald-700 bg-emerald-50"
                          >
                            ok
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-rose-300 text-rose-700 bg-rose-50"
                          >
                            err
                          </Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Purge confirmation */}
      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent data-testid="sim-purge-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Purge simulator data?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every document tagged{" "}
              <code className="text-[11px] bg-stone-100 px-1 py-0.5 rounded">
                generated_by=SYSTEM_SIMULATOR
              </code>{" "}
              across retail sales, orders, shipments, allocations, transfers,
              replenishments and notifications. Participant tags and the
              simulator&apos;s own settings are preserved. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "purge"}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onPurge}
              disabled={busy === "purge"}
              className="bg-rose-600 text-white hover:bg-rose-700"
              data-testid="sim-purge-confirm"
            >
              {busy === "purge" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                "Yes, purge"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-graphite">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-2">{value}</div>
      {hint && (
        <div className="text-xs text-graphite mt-1 truncate">{hint}</div>
      )}
    </div>
  );
}
