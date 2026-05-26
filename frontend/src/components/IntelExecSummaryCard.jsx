/**
 * Embeddable AI Brief card — drops onto any dashboard.
 * Reads /api/intel/exec-summary and shows the latest headline + bullets + recommendation.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sparkles, AlertOctagon, AlertTriangle, ShieldCheck, Info, Truck, CloudRain,
  TrendingUp, TrendingDown, ArrowRight, RefreshCw, Trophy, Package, Store, Gauge, Clock,
} from "lucide-react";

const ICON_MAP = {
  "trending-up": TrendingUp, "trending-down": TrendingDown,
  "sparkles": Sparkles, "alert-octagon": AlertOctagon, "alert-triangle": AlertTriangle,
  "shield-check": ShieldCheck, "info": Info, "truck": Truck, "cloud-rain": CloudRain,
  "trophy": Trophy, "package": Package, "store": Store, "gauge": Gauge, "clock": Clock,
};

function toneClasses(tone) {
  return ({
    positive: "text-emerald-700 bg-emerald-50",
    warning: "text-amber-700 bg-amber-50",
    critical: "text-rose-700 bg-rose-50",
    info: "text-slate-700 bg-slate-100",
  })[tone] || "text-slate-700 bg-slate-100";
}

export default function IntelExecSummaryCard() {
  const { session } = useSession();
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!session?.role || !session?.entity?.id) return;
    Api.intelExecSummary(session.role, session.entity.id).then(setData).catch(() => setData(null));
  }, [session?.role, session?.entity?.id]);

  if (!session?.role) return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const d = await Api.intelExecRegen(session.role, session.entity.id);
      setData(d);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Card className="bg-gradient-to-br from-slate-900 via-slate-900 to-indigo-950 text-white border-0 shadow-xl shadow-indigo-950/20" data-testid="intel-exec-summary-card">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="inline-flex items-center gap-2">
            <div className="h-8 w-8 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-widest text-indigo-200 font-semibold">AI Executive Brief</div>
              <div className="text-[10px] text-slate-400">
                {data?.model ? data.model.replace(/-\d{8}$/, "") : "Sabi"} · {data?.generated_at?.slice(11,16) || "—"} UTC
              </div>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="text-[11px] text-indigo-200 hover:text-white inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-white/10 transition disabled:opacity-50"
            data-testid="intel-exec-refresh"
          >
            <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {!data ? (
          <div className="text-sm text-slate-400 py-4">Generating executive brief…</div>
        ) : (
          <>
            <div className="text-base sm:text-lg font-semibold leading-snug text-white mb-3" data-testid="intel-exec-headline">
              {data.headline}
            </div>
            <div className="space-y-1.5 mb-4">
              {(data.bullets || []).map((b, i) => {
                const Icon = ICON_MAP[b.icon] || Info;
                return (
                  <div key={i} className="flex items-start gap-2 text-[12.5px]">
                    <div className={`h-5 w-5 rounded-md flex items-center justify-center flex-shrink-0 mt-px ${toneClasses(b.tone)}`}>
                      <Icon className="h-3 w-3" />
                    </div>
                    <div className="text-slate-200 leading-relaxed">{b.text}</div>
                  </div>
                );
              })}
            </div>
            {data.recommendation && (
              <div className="rounded-xl bg-white/5 border border-white/10 p-3 mb-3">
                <div className="text-[10px] uppercase tracking-widest text-indigo-300 font-semibold mb-1">Recommended action</div>
                <div className="text-[13px] text-white">{data.recommendation}</div>
              </div>
            )}
            <Link
              to="/intel"
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-indigo-300 hover:text-white transition"
              data-testid="intel-exec-open"
            >
              Open Intelligence Center <ArrowRight className="h-3 w-3" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
