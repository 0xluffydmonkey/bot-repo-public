import { MoonStar, RefreshCcw, SunMedium, Activity } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ConnectionIndicator, LivePing } from '@/components/status/connection-indicator';
import { useTheme } from '@/hooks/use-theme';
import { formatDateTime } from '@/lib/utils';
import type { ConnectionStatus } from '@/types/state';

interface AppShellProps {
  children: React.ReactNode;
  connection: ConnectionStatus;
  updatedAt?: string;
  onRefresh: () => void;
}

export function AppShell({ children, connection, updatedAt, onRefresh }: AppShellProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col px-4 py-3 sm:px-6 lg:px-8">
        <motion.header
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="sticky top-3 z-30 mb-4"
        >
          <div className="rounded-lg border border-border bg-card/95 px-4 py-3 backdrop-blur-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground">
                  <Activity className="h-4 w-4 text-background" />
                </div>
                <div>
                  <h1 className="text-sm font-semibold tracking-tight">Trading Control</h1>
                  <p className="text-xs text-muted-foreground">Centro de operacoes e monitoramento</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {connection === 'connected' && <LivePing />}
                <ConnectionIndicator status={connection} />

                <div className="hidden h-4 w-px bg-border sm:block" />

                <span className="text-xs text-muted-foreground">
                  Atualizado: <span className="text-foreground">{formatDateTime(updatedAt)}</span>
                </span>

                <div className="hidden h-4 w-px bg-border sm:block" />

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onRefresh}
                    aria-label="Atualizar"
                    className="h-8 w-8"
                  >
                    <RefreshCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggleTheme}
                    aria-label="Alternar tema"
                    className="h-8 w-8"
                  >
                    {theme === 'dark' ? (
                      <SunMedium className="h-4 w-4" />
                    ) : (
                      <MoonStar className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </motion.header>

        <main className="flex-1">{children}</main>

        <footer className="mt-6 border-t border-border pt-4 pb-3">
          <p className="text-center text-xs text-muted-foreground">
            Trading Bot Control Center
          </p>
        </footer>
      </div>
    </div>
  );
}
