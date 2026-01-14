import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Dashboard } from '@/pages/Dashboard';
import { Workspace } from '@/pages/Workspace';
import { Development } from '@/pages/Development';
import { Toaster } from '@/components/ui/toaster';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects/:id" element={<Workspace />} />
        <Route path="/workspace/:id" element={<Workspace />} />
        <Route path="/projects/:id/develop" element={<Development />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
};
