import { Navigate, Route, Routes } from 'react-router-dom';

import { LoginGate } from './components/LoginGate';
import { Toaster } from './components/Toaster';
import ImageStudioPage from './pages/create/CreateStudioPage';

export default function App() {
  return (
    <>
      <Toaster />
      <LoginGate />
      <Routes>
        <Route path="/" element={<ImageStudioPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
