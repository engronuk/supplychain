import { PageHeader } from "./wholesaler/ui";
import { Card, CardContent } from "@/components/ui/card";
import { BrainCircuit, Sparkles } from "lucide-react";

/**
 * Wholesaler Intelligence Center — Phase 3D placeholder.
 *
 * Final implementation will host executive briefings, opportunity /
 * risk detection, and rule-based recommended actions. Wired now so the
 * sidebar route resolves cleanly while Phase 3A–3C are being shipped.
 */
export default function WholesalerIntelligenceCenter() {
  return (
    <div className="p-6 md:p-8 space-y-6" data-testid="wholesaler-intel-center">
      <PageHeader
        title="Intelligence Center"
        subtitle="Executive briefings, opportunities, risks and recommended actions — coming online in Phase 3D."
      />
      <Card>
        <CardContent className="p-12 text-center text-slate-500">
          <Sparkles className="h-10 w-10 mx-auto text-indigo-500 mb-3" />
          <div className="text-lg font-semibold text-slate-800">
            Coming online in Phase 3D
          </div>
          <p className="mt-2 text-sm max-w-md mx-auto">
            Phase 3A focuses on Distributor Analytics. The Intelligence
            Center — daily executive briefings, opportunity detection,
            risk detection and recommended actions — ships in Phase 3D.
            All outputs will be rule-based math, no AI.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
