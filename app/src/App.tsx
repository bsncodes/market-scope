import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DashboardPage } from './pages/DashboardPage';
import { SetupPage } from './pages/SetupPage';
import { StatusPage } from './pages/StatusPage';
import { UploadPage } from './pages/UploadPage';

// Market ids live in the URL so a dashboard survives a reload and can be
// linked to, rather than being trapped in component state after the redirect.
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<UploadPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/markets/:marketId/status" element={<StatusPage />} />
        <Route path="/markets/:marketId" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
