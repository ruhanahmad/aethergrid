import { Navigate, Route, Routes, useMatch } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { AuthGate } from "./components/auth/AuthGate";
import DashboardPage from "./pages/DashboardPage";
import NodesPage from "./pages/NodesPage";
import JobsPage from "./pages/JobsPage";
import JobDetailPage from "./pages/JobDetailPage";
import WorkersPage from "./pages/WorkersPage";
import WorkerDetailPage from "./pages/WorkerDetailPage";
import DemoPage from "./features/demo/DemoPage";
import { useWorkerHeartbeatKeeper } from "./hooks/useWorkerHeartbeatKeeper";

export default function App() {
  useWorkerHeartbeatKeeper();
  const isDemo = Boolean(useMatch("/demo"));
  return (
    <AuthGate>
      <Shell stackNavigationOnMobile={isDemo}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/workers/:workerId" element={<WorkerDetailPage />} />
          <Route path="/demo" element={<DemoPage />} />
          <Route path="/recovery-lab" element={<Navigate to="/demo" replace />} />
        </Routes>
      </Shell>
    </AuthGate>
  );
}
