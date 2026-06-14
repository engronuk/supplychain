/**
 * Super Admin · Sync panel
 *
 * One-screen control to bring a deployed environment to the canonical
 * preview state. Auth is the same super_admin JWT used everywhere else
 * in the admin console — no separate token to paste.
 *   1.  Dry-run diff — see exactly what changes.
 *   2.  Apply  — kicks off the background job (~5 min).
 *   3.  Live progress poll (every 5 s) — Wipe → Rebuild → Backfill → Forecasts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SyncApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Eye,
  Play,
  Database,
} from "lucide-react";

const STEPS = [
  { key: "rebuild",   label: "Wipe & Rebuild Hierarchy" },
  { key: "backfill",  label: "Backfill 12-month History" },
  { key: "forecasts", label: "Recompute Forecasts" },
  { key: "done",      label: "Sync Complete" },
];

function currentStep(status) {
  if (!status) return -1;
  if (status.in_flight) {
    const last = status.last_sync || {};
    if (last.rebuild) {
      if (last.backfill) return 2;          // forecasts running
      return 1;                              // backfill running
    }
    return 0;                                // rebuild running
  }
  if (status.last_sync?.finished_at) return 3;
  return -1;
}

export default function SyncPanel() {
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState("");
  const [diffData, setDiffData] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [backfill, setBackfill] = useState(true);
  const [recompute, setRecompute] = useState(true);
  const pollRef = useRef(null);

  const fetchStatus = async () => {
    try {
      const d = await SyncApi.status();
      setStatus(d);
      setStatusErr("");
      return d;
    } catch (e) {
      const detail = e?.response?.data?.detail || e.message;
      setStatusErr(detail);
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await fetchStatus();
    };
    poll();
    pollRef.current = setInterval(poll, 5_000);
    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
    };
  }, []);

  const handleDiff = async () => {
    setDiffLoading(true);
    try {
      const d = await SyncApi.diff();
      setDiffData(d);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Diff failed.");
    } finally {
      setDiffLoading(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await SyncApi.apply({
        backfill_history: backfill,
        recompute_forecasts: recompute,
      });
      if (res.status === "already_running") {
        toast.message("A sync is already running.", {
          description: "We'll keep polling for completion.",
        });
      } else {
        toast.success("Sync started — running in the background.");
      }
      setApplyOpen(false);
      fetchStatus();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Apply failed.");
    } finally {
      setApplying(false);
    }
  };

  const step = useMemo(() => currentStep(status), [status]);
  const inFlight = !!status?.in_flight;
  const counts = status?.current?.organizations_by_type || {};
  const target = status?.target?.organizations_by_type || {};

  return (
    <div className="space-y-6">
      {/* Header / current state */}
      <Card className="bg-white border-stone-200">
        <CardContent className="p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-graphite font-medium flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" />
                Production Canonical Sync
              </div>
              <h2 className="font-display text-3xl tracking-tight mt-1">
                Make this env match preview.
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {inFlight ? (
                <Badge className="bg-amber-100 text-amber-900 border-amber-200">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Sync in progress
                </Badge>
              ) : status?.last_sync?.finished_at ? (
                <Badge className="bg-emerald-100 text-emerald-900 border-emerald-200">
                  <CheckCircle2 className="h-3 w-3 mr-1" /> Last sync ok
                </Badge>
              ) : (
                <Badge className="bg-stone-100 text-stone-700 border-stone-200">
                  No sync recorded
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchStatus}
                data-testid="sync-refresh"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {statusErr && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg p-3 mb-4">
              {statusErr}
            </div>
          )}

          {/* Counts table */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            {["manufacturer", "warehouse", "distributor", "wholesaler", "retailer"].map((kind) => {
              const have = counts[kind] || 0;
              const want = target[kind] || 0;
              const ok = have === want;
              return (
                <div
                  key={kind}
                  className={`rounded-lg border p-3 ${
                    ok ? "border-emerald-200 bg-emerald-50/60" : "border-amber-200 bg-amber-50/60"
                  }`}
                  data-testid={`sync-count-${kind}`}
                >
                  <div className="text-[10px] uppercase tracking-wider text-graphite">{kind}</div>
                  <div className="font-display text-2xl tabular-nums">{have}</div>
                  <div className="text-[11px] text-graphite">
                    target {want}{" "}
                    {ok ? (
                      <CheckCircle2 className="inline h-3 w-3 text-emerald-600" />
                    ) : (
                      <span className="text-amber-700">
                        ({have - want > 0 ? "+" : ""}{have - want})
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 flex-wrap mb-5">
            {STEPS.map((s, i) => {
              const active = i === step;
              const done = i < step || (!inFlight && step === 3 && i <= 3);
              return (
                <div
                  key={s.key}
                  className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1.5 ${
                    done
                      ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                      : active
                      ? "bg-amber-50 border-amber-300 text-amber-900"
                      : "bg-stone-50 border-stone-200 text-stone-500"
                  }`}
                  data-testid={`sync-step-${s.key}`}
                >
                  {done && <CheckCircle2 className="h-3 w-3" />}
                  {active && <Loader2 className="h-3 w-3 animate-spin" />}
                  <span>{s.label}</span>
                  {i < STEPS.length - 1 && <span className="text-stone-300 ml-1">→</span>}
                </div>
              );
            })}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 flex-wrap">
            <Button
              variant="outline"
              onClick={handleDiff}
              disabled={diffLoading || inFlight}
              data-testid="sync-diff-btn"
            >
              {diffLoading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Eye className="h-4 w-4 mr-2" />
              )}
              Preview Diff (dry run)
            </Button>
            <Button
              onClick={() => setApplyOpen(true)}
              disabled={inFlight}
              data-testid="sync-apply-btn"
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              <Play className="h-4 w-4 mr-2" />
              Sync Now (wipe & rebuild)
            </Button>
          </div>

          {/* Last sync record */}
          {status?.last_sync?.finished_at && !inFlight && (
            <div className="mt-6 text-xs text-graphite border-t pt-4">
              Last applied: <span className="font-mono">{status.last_sync.finished_at}</span> ·
              {" "}forecasts: {status.last_sync.forecasts?.total ?? "n/a"} ·
              {" "}backfill: {status.last_sync.backfill?.inserted ?? "skipped"} rows
            </div>
          )}
        </CardContent>
      </Card>

      {/* Diff preview */}
      {diffData && (
        <Card className="bg-white border-stone-200">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Database className="h-4 w-4 text-graphite" />
              <h3 className="font-display text-xl tracking-tight">Dry-run diff</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-[11px] uppercase tracking-wider text-graphite mb-2">
                  Organization delta
                </div>
                <div className="space-y-1.5">
                  {Object.entries(diffData.organization_delta || {}).map(([k, v]) => (
                    <div key={k} className="flex justify-between items-center text-sm">
                      <span className="capitalize">{k}</span>
                      <Badge
                        className={
                          v === 0
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                            : "bg-amber-50 text-amber-800 border-amber-200"
                        }
                      >
                        {v > 0 ? `+${v}` : v}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-graphite mb-2">
                  Collections to wipe ({diffData.collections_to_wipe?.length || 0})
                </div>
                <div className="max-h-44 overflow-y-auto text-xs font-mono text-graphite space-y-0.5">
                  {(diffData.collections_to_wipe || []).map((c) => (
                    <div key={c}>{c}</div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Apply confirmation modal */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent data-testid="sync-confirm-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
              Confirm canonical sync
            </DialogTitle>
            <DialogDescription>
              This will <span className="font-semibold text-rose-700">wipe</span>{" "}
              all transactional collections in <strong>this environment</strong> and
              rebuild the strict 5-tier hierarchy to match preview. Demo users
              are preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 my-2">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-sm font-medium">Backfill 12-month history</div>
                <div className="text-xs text-graphite">~3 min · adds ~500k daily_sales rows</div>
              </div>
              <Switch
                checked={backfill}
                onCheckedChange={setBackfill}
                data-testid="sync-opt-backfill"
              />
            </label>
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <div>
                <div className="text-sm font-medium">Recompute stock forecasts</div>
                <div className="text-xs text-graphite">~30 s · refreshes urgency buckets</div>
              </div>
              <Switch
                checked={recompute}
                onCheckedChange={setRecompute}
                data-testid="sync-opt-recompute"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApplyOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying}
              className="bg-rose-600 hover:bg-rose-700 text-white"
              data-testid="sync-confirm-apply"
            >
              {applying ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Yes, start the sync
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
