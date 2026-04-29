import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { RouteGuard } from "./components/auth/RouteGuard";
import Index from "./pages/Index";
import Login from "./pages/Login";
import OfficialLogin from "./pages/OfficialLogin";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import ReportIncident from "./pages/ReportIncident";
import OfficialDashboard from "./pages/OfficialDashboard";
import OfficialTeam from "./pages/OfficialTeam";
import OfficialMap from "./pages/OfficialMap";
import OfficialAlerts from "./pages/OfficialAlerts";
import NotFound from "./pages/NotFound";
import Analytics from "./pages/Analytics";
import Reports from "./pages/Reports";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/login" element={<Login />} />
          <Route path="/official/login" element={<OfficialLogin />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />

          <Route element={<RouteGuard role="citizen" />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/report" element={<ReportIncident />} />
            <Route path="/dashboard/messages" element={<Dashboard />} />
            <Route path="/dashboard/notifications" element={<Dashboard />} />
            <Route path="/dashboard/settings" element={<Dashboard />} />
          </Route>

          <Route element={<RouteGuard role="official" />}>
            <Route path="/official/dashboard" element={<OfficialDashboard />} />
            <Route path="/official/tickets" element={<OfficialDashboard />} />
            <Route path="/official/team" element={<OfficialTeam />} />
            <Route path="/official/map" element={<OfficialMap />} />
            
            <Route path="/official/analytics" element={<Analytics />} />
            
            <Route path="/official/reports" element={<Reports />} />
            
            <Route path="/official/alerts" element={<OfficialAlerts />} />
            <Route path="/official/settings" element={<OfficialDashboard />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
