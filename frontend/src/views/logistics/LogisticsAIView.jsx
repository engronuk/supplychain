// Phase 3 — AI Intelligence: delay prediction engine, demand↔delivery
// correlation and the Konekt Copilot, all grounded in live data.
import { useCallback, useEffect, useState } from "react";
import { BrainCircuit } from "lucide-react";
import { toast } from "sonner";
import { Api } from "../../lib/api";
import { DelayPredictionsPanel } from "./DelayPredictionsPanel";
import { DemandDeliveryPanel } from "./DemandDeliveryPanel";
import { CopilotPanel } from "./CopilotPanel";

export const LogisticsAIView = () => {
  const [pred, setPred] = useState(null);
  const [dd, setDd] = useState(null);
  const [predLoading, setPredLoading] = useState(true);
  const [ddLoading, setDdLoading] = useState(true);

  const loadPred = useCallback((refresh = false) => {
    if (refresh) setPredLoading(true);
    return Api.delayPredictions(refresh)
      .then(setPred)
      .catch((e) => toast.error("Failed to score the fleet", {
        description: e?.response?.data?.detail || e?.message,
      }))
      .finally(() => setPredLoading(false));
  }, []);

  const loadDd = useCallback((refresh = false) => {
    if (refresh) setDdLoading(true);
    return Api.demandDelivery(refresh)
      .then(setDd)
      .catch((e) => toast.error("Failed to load demand↔delivery view", {
        description: e?.response?.data?.detail || e?.message,
      }))
      .finally(() => setDdLoading(false));
  }, []);

  useEffect(() => {
    loadPred();
    loadDd();
  }, [loadPred, loadDd]);

  return (
    <div className="rounded-2xl bg-[#070D1A] border border-slate-800/80 p-4 md:p-5 space-y-4" data-testid="logistics-ai-view">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-slate-100">AI Intelligence</span>
          <span className="text-[11px] text-slate-500 hidden sm:inline">
            delay prediction · demand↔delivery correlation · copilot
          </span>
        </div>
        <span className="text-[10px] font-semibold px-2 py-1 rounded-md border bg-violet-500/10 border-violet-500/30 text-violet-300" data-testid="ai-provider-badge">
          Gemini · Vertex AI
        </span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
        <div className="space-y-4 min-w-0">
          <DelayPredictionsPanel data={pred} loading={predLoading} onRefresh={() => loadPred(true)} />
          <DemandDeliveryPanel data={dd} loading={ddLoading} onRefresh={() => loadDd(true)} />
        </div>
        <CopilotPanel />
      </div>
    </div>
  );
};
