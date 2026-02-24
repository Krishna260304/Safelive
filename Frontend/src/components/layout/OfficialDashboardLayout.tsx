import { ReactNode, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Building2,
  ChevronDown,
  ClipboardList,
  Home,
  LogOut,
  MapPin,
  Menu,
  Settings,
  Shield,
  User,
  UserPlus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SettingsModal } from '@/components/SettingsModal';
import { authService } from '@/services/auth';
import { cn } from '@/lib/utils';

interface OfficialDashboardLayoutProps {
  children: ReactNode;
  onSettingsClick?: () => void;
}

type OfficialRole = 'department' | 'supervisor' | 'field_inspector' | 'worker';

const roleLabelMap: Record<OfficialRole, string> = {
  department: 'Department Portal',
  supervisor: 'Supervisor Portal',
  field_inspector: 'Field Inspector Portal',
  worker: 'Worker Portal',
};

const toOfficialRole = (value: string | undefined): OfficialRole => {
  const normalized = (value || '').trim().toLowerCase().replace('-', '_');
  if (normalized === 'supervisor') return 'supervisor';
  if (normalized === 'field_inspector') return 'field_inspector';
  if (normalized === 'worker') return 'worker';
  return 'department';
};

export const OfficialDashboardLayout = ({ children, onSettingsClick }: OfficialDashboardLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const user = authService.getCurrentUser();
  const role = toOfficialRole(user?.officialRole);
  const userName = user?.fullName || user?.name || user?.email || 'Official';
  const userDept = user?.department || roleLabelMap[role];

  const navItems = useMemo(() => {
    const common = [
      { icon: Home, label: 'Dashboard', path: '/official/dashboard' },
      { icon: ClipboardList, label: 'Tickets', path: '/official/tickets' },
    ];
    if (role === 'department') {
      return [
        ...common,
        { icon: UserPlus, label: 'Team', path: '/official/team' },
        { icon: MapPin, label: 'Live Map', path: '/official/map' },
        { icon: Bell, label: 'Alerts', path: '/official/alerts' },
      ];
    }
    if (role === 'supervisor') {
      return [
        ...common,
        { icon: MapPin, label: 'Live Map', path: '/official/map' },
        { icon: Bell, label: 'Alerts', path: '/official/alerts' },
      ];
    }
    return common;
  }, [role]);

  const activeNavLabel = navItems.find((item) => location.pathname.startsWith(item.path))?.label || 'Dashboard';

  const handleLogout = async () => {
    await authService.logout();
    navigate('/official/login');
  };

  const handleSettingsClick = () => {
    if (onSettingsClick) {
      onSettingsClick();
      return;
    }
    setIsSettingsOpen(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <SettingsModal open={isSettingsOpen} onOpenChange={setIsSettingsOpen} isOfficial />

      <header className="fixed left-0 right-0 top-0 z-50 flex h-16 items-center px-4 text-white gradient-hero lg:hidden">
        <button onClick={() => setIsSidebarOpen(true)} className="rounded-lg p-2 hover:bg-white/10">
          <Menu className="h-6 w-6" />
        </button>
        <Link to="/official/dashboard" className="mx-auto flex items-center gap-2 text-white">
          <div className="rounded-lg bg-white/10 p-1.5">
            <Shield className="h-5 w-5" />
          </div>
          <span className="font-heading font-bold">SafeLive Admin</span>
        </Link>
        <button onClick={() => setIsProfileOpen((prev) => !prev)} className="rounded-lg p-2 hover:bg-white/10">
          <User className="h-5 w-5" />
        </button>
      </header>

      {isSidebarOpen && <div className="fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={() => setIsSidebarOpen(false)} />}

      <aside
        className={cn(
          'fixed bottom-0 left-0 top-0 z-50 w-64 -translate-x-full text-white transition-transform duration-300 gradient-hero lg:translate-x-0',
          isSidebarOpen && 'translate-x-0'
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b border-white/10 p-4">
            <Link to="/official/dashboard" className="flex items-center gap-2">
              <div className="rounded-xl bg-white/10 p-2">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <span className="block text-lg font-heading font-bold">SafeLive</span>
                <span className="text-xs text-white/60">{roleLabelMap[role]}</span>
              </div>
            </Link>
            <button onClick={() => setIsSidebarOpen(false)} className="rounded-lg p-2 hover:bg-white/10 lg:hidden">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto p-4">
            {navItems.map((item) => {
              const isActive = location.pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsSidebarOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-4 py-3 transition-colors',
                    isActive ? 'bg-white/20' : 'hover:bg-white/10'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                </Link>
              );
            })}
            <button
              onClick={() => {
                setIsSidebarOpen(false);
                handleSettingsClick();
              }}
              className="flex w-full items-center gap-3 rounded-xl px-4 py-3 transition-colors hover:bg-white/10"
            >
              <Settings className="h-5 w-5" />
              <span className="font-medium">Settings</span>
            </button>
          </nav>

          <div className="border-t border-white/10 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{userName}</div>
                <div className="truncate text-xs text-white/60">{userDept}</div>
              </div>
            </div>
            <Button variant="ghost" className="w-full justify-start text-white hover:bg-white/10" onClick={handleLogout}>
              <LogOut className="mr-2 h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      <main className="min-h-screen pt-16 transition-all duration-300 lg:pl-64 lg:pt-0">
        <header className="hidden h-16 items-center justify-between border-b border-border bg-card px-6 lg:flex">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-heading font-semibold text-foreground">{activeNavLabel}</h1>
            <span className="rounded-full bg-accent/10 px-2 py-1 text-xs font-medium text-accent">{roleLabelMap[role]}</span>
          </div>
          <div className="flex items-center gap-4">
            <button className="rounded-lg p-2 transition-colors hover:bg-muted">
              <Bell className="h-5 w-5 text-muted-foreground" />
            </button>
            <div className="relative">
              <button
                onClick={() => setIsProfileOpen((prev) => !prev)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-muted"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10">
                  <Building2 className="h-4 w-4 text-accent" />
                </div>
                <span className="text-sm font-medium">{userName}</span>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isProfileOpen && 'rotate-180')} />
              </button>

              {isProfileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProfileOpen(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-48 animate-scale-in rounded-xl border border-border bg-card py-2 shadow-card">
                    <button
                      onClick={() => {
                        setIsProfileOpen(false);
                        handleSettingsClick();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm transition-colors hover:bg-muted"
                    >
                      <Settings className="h-4 w-4" />
                      Settings
                    </button>
                    <button
                      onClick={handleLogout}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-destructive transition-colors hover:bg-muted"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className="p-6">{children}</div>
      </main>
    </div>
  );
};
