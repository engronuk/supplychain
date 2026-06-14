import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SessionProvider, useSession } from "@/context/SessionContext";
import LandingPage from "@/components/LandingPage";
import LoginPage from "@/views/LoginPage";
import Layout from "@/components/Layout";
import ManufacturerDashboard from "@/views/ManufacturerDashboard";
import DistributorDashboard from "@/views/DistributorDashboard";
import RetailerDashboardV2 from "@/views/RetailerDashboardV2";
import InventoryView from "@/views/InventoryView";
import RetailerProcurement from "@/views/RetailerProcurement";
import ProcurementWorkspace from "@/views/ProcurementWorkspace";
import RetailerProductDetail from "@/views/RetailerProductDetail";
import OrganizationManagement from "@/views/OrganizationManagement";
import DistributorProcurementInbox from "@/views/DistributorProcurementInbox";
import AnalyticsView from "@/views/AnalyticsView";
import ReportsView from "@/views/ReportsView";
import NetworkView from "@/views/NetworkView";
import ManufacturerNetworkView from "@/views/ManufacturerNetworkView";
import DistributorRetailerDetail from "@/views/DistributorRetailerDetail";
import DistributorProductDetail from "@/views/DistributorProductDetail";
import SalesBookView from "@/views/SalesBookView";
import IntelligenceCenter from "@/views/IntelligenceCenter";
import SuperAdminConsole from "@/views/SuperAdminConsole";
import DemoAccountsPage from "@/views/DemoAccountsPage";
import ManufacturerProductDetail from "@/views/ManufacturerProductDetail";
import ProductCommandCenter from "@/views/ProductCommandCenter";
import ManufacturerDistributorDetail from "@/views/ManufacturerDistributorDetail";
import DistributorWholesalerDetail from "@/views/DistributorWholesalerDetail";
import ProductIntelligenceCenter from "@/views/ProductIntelligenceCenter";
import ManufacturerWarehouses, { ManufacturerWarehouseDetail } from "@/views/ManufacturerWarehouses";
// AllocationCenter is now mounted inside the manufacturer Procurement workspace (Order Allocation tab).
import CommandCenter from "@/views/CommandCenter";
import LogisticsCommandCenter from "@/views/LogisticsCommandCenter";
import WholesalerDashboard from "@/views/WholesalerDashboard";
import WholesalerProcurement from "@/views/WholesalerProcurement";
import WholesalerOrders from "@/views/WholesalerOrders";
import WholesalerFulfillment from "@/views/WholesalerFulfillment";
import WholesalerShipments from "@/views/WholesalerShipments";
import WholesalerProcurementHub from "@/views/WholesalerProcurementHub";
import WholesalerDistributorDetail from "@/views/WholesalerDistributorDetail";
import WholesalerAnalytics from "@/views/WholesalerAnalytics";
import WholesalerIntelligenceCenter from "@/views/WholesalerIntelligenceCenter";
import WMSLayout from "@/views/wms/WMSLayout";
import WMSDashboardPage from "@/views/wms/DashboardPage";
import { InventoryListPage, InventoryDetailPage } from "@/views/wms/InventoryPages";
import { ReceivingPage, DispatchPage } from "@/views/wms/ReceivingDispatch";
import {
  WarehousesPage, AlertsPage, TransfersPage, ReturnsPage, CycleCountsPage,
  ReportsPage as WMSReportsPage, LocationsPage, UsersPage as WMSUsersPage,
  ProductsPage as WMSProductsPage, SettingsPage as WMSSettingsPage,
} from "@/views/wms/OtherPages";
import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";

function RoleDashboard() {
  const { session } = useSession();
  if (!session) return null;
  if (session.role === "super_admin") return <SuperAdminConsole />;
  if (session.role === "manufacturer") return <ManufacturerDashboard />;
  if (session.role === "distributor") return <DistributorDashboard />;
  if (session.role === "wholesaler") return <WholesalerDashboard />;
  if (session.role === "warehouse") return <Navigate to="/wms" replace />;
  return <RetailerDashboardV2 />;
}

function ProcurementGate() {
  const { session } = useSession();
  if (!session) return null;
  if (session.role === "distributor") return <DistributorProcurementInbox />;
  if (session.role === "retailer") return <RetailerProcurement />;
  // Phase 3 — wholesaler /procurement = upstream POs only. Distributor
  // Orders, Fulfillment and Shipments are dedicated sidebar routes.
  if (session.role === "wholesaler") return <WholesalerProcurement />;
  // Manufacturers don't procure — for them, "Procurement" is the outbound
  // workspace: Shipment Command Center + Planning & Ops (allocations,
  // authorizations, transfers, forecast).
  if (session.role === "manufacturer") return <ProcurementWorkspace />;
  return <Navigate to="/dashboard" replace />;
}

function InventoryProductGate() {
  const { session } = useSession();
  if (!session) return null;
  if (session.role === "retailer") return <RetailerProductDetail />;
  return <DistributorProductDetail />;
}

function BootGate({ children }) {
  const { bootstrapping } = useSession();
  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center" data-testid="boot-gate">
        <div className="flex items-center gap-3 text-graphite">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-display text-lg">Connecting to TradeKonekt…</span>
        </div>
      </div>
    );
  }
  return children;
}

function Protected({ children }) {
  const { session, bootstrapping } = useSession();
  if (bootstrapping) return null;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

function PublicHome() {
  const { session, bootstrapping } = useSession();
  if (bootstrapping) return null;
  if (session) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

function App() {
  return (
    <SessionProvider>
      <BootGate>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<PublicHome />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/demo" element={<DemoAccountsPage />} />
            <Route path="/wms" element={<Protected><WMSLayout /></Protected>}>
              <Route index element={<WMSDashboardPage />} />
              <Route path="inventory" element={<InventoryListPage />} />
              <Route path="inventory/:productId" element={<InventoryDetailPage />} />
              <Route path="receiving" element={<ReceivingPage />} />
              <Route path="dispatch" element={<DispatchPage />} />
              <Route path="transfers" element={<TransfersPage />} />
              <Route path="returns" element={<ReturnsPage />} />
              <Route path="cycle-counts" element={<CycleCountsPage />} />
              <Route path="reports" element={<WMSReportsPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="warehouses" element={<WarehousesPage />} />
              <Route path="locations" element={<LocationsPage />} />
              <Route path="users" element={<WMSUsersPage />} />
              <Route path="products" element={<WMSProductsPage />} />
              <Route path="settings" element={<WMSSettingsPage />} />
            </Route>
            <Route element={<Protected><Layout /></Protected>}>
              <Route path="/dashboard" element={<RoleDashboard />} />
              <Route path="/product-intelligence" element={<ProductIntelligenceCenter />} />
              <Route path="/inventory" element={<InventoryView />} />
              {/* Shipments module has been merged into Procurement. */}
              <Route path="/shipments" element={<Navigate to="/procurement" replace />} />
              <Route path="/requests" element={<Navigate to="/procurement" replace />} />
              <Route path="/procurement" element={<ProcurementGate />} />
              <Route path="/organizations" element={<OrganizationManagement />} />
              <Route path="/network" element={<NetworkView />} />
              <Route path="/distributor/:distributorId/wholesaler/:wholesalerId" element={<DistributorWholesalerDetail />} />
              <Route path="/manufacturer/warehouses" element={<ManufacturerWarehouses />} />
              <Route path="/manufacturer/warehouses/:id" element={<ManufacturerWarehouseDetail />} />
              <Route path="/manufacturer/allocation" element={<Navigate to="/procurement?tab=allocation" replace />} />
              <Route path="/manufacturer/command-center" element={<CommandCenter />} />
              <Route path="/manufacturer/logistics-center" element={<LogisticsCommandCenter />} />
              <Route path="/network/retailer/:retailerId" element={<DistributorRetailerDetail />} />
              <Route path="/inventory/product/:productId" element={<InventoryProductGate />} />
              <Route path="/products/:productId" element={<ProductCommandCenter />} />
              <Route path="/products/:productId/legacy" element={<ManufacturerProductDetail />} />
              <Route path="/distributors/:distributorId" element={<ManufacturerDistributorDetail />} />
              <Route path="/distributors/:distributorId/retailers/:retailerId" element={<DistributorRetailerDetail />} />
              <Route path="/network-map" element={<ManufacturerNetworkView />} />
              <Route path="/analytics" element={<AnalyticsView />} />
              <Route path="/sales" element={<SalesBookView />} />
              <Route path="/intel" element={<IntelligenceCenter />} />
              <Route path="/reports" element={<ReportsView />} />
              {/* Wholesaler Phase 3 — standalone Distributor Orders,
                  Fulfillment and Shipments routes (sidebar surfaces them
                  individually). Procurement is upstream POs only. */}
              <Route path="/wholesaler/orders" element={<WholesalerOrders />} />
              <Route path="/wholesaler/fulfillment" element={<WholesalerFulfillment />} />
              <Route path="/wholesaler/shipments" element={<WholesalerShipments />} />
              <Route path="/wholesaler/distributors/:distributorId" element={<WholesalerDistributorDetail />} />
              <Route path="/wholesaler/intelligence" element={<WholesalerIntelligenceCenter />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </BootGate>
      <Toaster richColors position="top-right" />
    </SessionProvider>
  );
}

export default App;
