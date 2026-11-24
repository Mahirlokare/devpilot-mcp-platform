import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import WorkspacePage from "./pages/WorkspacePage";
import ProjectsPage from "./pages/ProjectsPage";
import GithubPage from "./pages/GithubPage";
import McpPage from "./pages/McpPage";
import ToolsPage from "./pages/ToolsPage";
import DatabasePage from "./pages/DatabasePage";
import AnalysisPage from "./pages/AnalysisPage";
import TestingPage from "./pages/TestingPage";
import DeploymentsPage from "./pages/DeploymentsPage";
import HistoryPage from "./pages/HistoryPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import SettingsPage from "./pages/SettingsPage";
import UsagePage from "./pages/UsagePage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route index element={<DashboardPage />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/workspace/:conversationId" element={<WorkspacePage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/github" element={<GithubPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/database" element={<DatabasePage />} />
        <Route path="/analysis" element={<AnalysisPage />} />
        <Route path="/testing" element={<TestingPage />} />
        <Route path="/deployments" element={<DeploymentsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/history/:runId" element={<HistoryPage />} />
        <Route path="/approvals" element={<ApprovalsPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
