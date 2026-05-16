import { useSession } from "@/context/SessionContext";
import { Api } from "@/lib/api";
import { PageHeader } from "@/components/Common";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Boxes } from "lucide-react";

export default function ReportsView() {
  const { session } = useSession();
  const { role, entity } = session;

  const shipmentsUrl = Api.reportShipmentsCsv(role, entity.id);
  const inventoryUrl = Api.reportInventoryCsv(role, entity.id);

  return (
    <div className="p-8 max-w-7xl mx-auto" data-testid="reports-view">
      <PageHeader title="Reports" description="Export your operational data as CSV for spreadsheets or BI tools." />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card data-testid="report-shipments-card">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" /> Shipments report
              </CardTitle>
              <CardDescription className="mt-1">
                All shipments {role === "distributor" ? "you've sent" : "addressed to you"}, with products, quantities and timestamps.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <a href={shipmentsUrl} download data-testid="download-shipments-csv">
              <Button className="bg-slate-900 hover:bg-slate-800">
                <Download className="h-4 w-4 mr-2" /> Download CSV
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card data-testid="report-inventory-card">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Boxes className="h-4 w-4" /> Inventory report
              </CardTitle>
              <CardDescription className="mt-1">
                Current SKU-level stock with reorder thresholds for {entity.name}.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <a href={inventoryUrl} download data-testid="download-inventory-csv">
              <Button className="bg-slate-900 hover:bg-slate-800">
                <Download className="h-4 w-4 mr-2" /> Download CSV
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
