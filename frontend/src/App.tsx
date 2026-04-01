import { Toaster } from 'react-hot-toast';
import { DashboardPage } from './pages/dashboard-page';

export default function App() {
  return (
    <>
      <DashboardPage />
      <Toaster
        position="top-right"
        toastOptions={{
          className: '!rounded-2xl !border !border-white/10 !bg-zinc-950 !text-zinc-50 !shadow-2xl',
          duration: 3500,
        }}
      />
    </>
  );
}
