import { Route, Routes, useMatch } from "react-router-dom";
import { Shell } from "./components/layout/Shell";
import { AuthGate } from "./components/auth/AuthGate";
import DashboardPage from "./pages/DashboardPage";
import NodesPage from "./pages/NodesPage";
import JobsPage from "./pages/JobsPage";
import JobDetailPage from "./pages/JobDetailPage";
import WorkersPage from "./pages/WorkersPage";
import WorkerDetailPage from "./pages/WorkerDetailPage";
import RecoveryLabPage from "./pages/RecoveryLabPage";
import { useWorkerHeartbeatKeeper } from "./hooks/useWorkerHeartbeatKeeper";

export default function App() {
  useWorkerHeartbeatKeeper();
  const isRecoveryLab = Boolean(useMatch("/recovery-lab"));
  return (
    <AuthGate>
      <Shell stackNavigationOnMobile={isRecoveryLab}>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:jobId" element={<JobDetailPage />} />
          <Route path="/workers" element={<WorkersPage />} />
          <Route path="/workers/:workerId" element={<WorkerDetailPage />} />
          <Route path="/recovery-lab" element={<RecoveryLabPage />} />
        </Routes>
      </Shell>
    </AuthGate>
  );
}
