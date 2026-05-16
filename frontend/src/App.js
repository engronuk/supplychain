import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SessionProvider, useSession } from "@/context/SessionContext";
import LandingPage from "@/components/LandingPage";
import Layout from "@/components/Layout";
import DistributorDashboard from "@/views/DistributorDashboard";
import RetailerDashboard from "@/views/RetailerDashboard";
import InventoryView from "@/views/InventoryView";
import ShipmentTracker from "@/views/ShipmentTracker";
import RequestsView from "@/views/RequestsView";
import AnalyticsView from "@/views/AnalyticsView";
import ReportsView from "@/views/ReportsView";
import { Toaster } from "@/components/ui/sonner";

function RoleDashboard() {
  const { session } = useSession();
  return session.role === "distributor" ? <DistributorDashboard /> : <RetailerDashboard />;
}

function Protected({ children }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/" replace />;
  return children;
}

function PublicHome() {
  const { session } = useSession();
  if (session) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

function App() {
  return (
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route element={<Protected><Layout /></Protected>}>
            <Route path="/dashboard" element={<RoleDashboard />} />
            <Route path="/inventory" element={<InventoryView />} />
            <Route path="/shipments" element={<ShipmentTracker />} />
            <Route path="/requests" element={<RequestsView />} />
            <Route path="/analytics" element={<AnalyticsView />} />
            <Route path="/reports" element={<ReportsView />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </SessionProvider>
  );
}

export default App;
