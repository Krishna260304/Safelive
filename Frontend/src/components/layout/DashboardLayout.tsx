import { ReactNode, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  type LucideIcon,
  Home, 
  Camera, 
  Settings, 
  LogOut,
  Menu,
  X,
  ChevronDown,
  User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { authService } from '@/services/auth';
import { SettingsModal } from '@/components/SettingsModal';

interface DashboardLayoutProps {
  children: ReactNode;
  onSettingsClick?: () => void;
}

type NavItem = {
  icon: LucideIcon;
  label: string;
  path: string;
  badge?: string;
};

const navItems: NavItem[] = [
  { icon: Home, label: 'Dashboard', path: '/dashboard' },
  { icon: Camera, label: 'Report Incident', path: '/dashboard/report' },
];

export const DashboardLayout = ({ children, onSettingsClick }: DashboardLayoutProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const user = authService.getCurrentUser();
  const userName = user?.name || user?.email || user?.phone || 'User';
  const userEmail = user?.email || user?.phone || '';

  const handleLogout = async () => {
    await authService.logout();
    navigate('/login');
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
      <SettingsModal open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />
      {}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b border-border h-16 flex items-center px-4">
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="p-2 hover:bg-muted rounded-lg"
        >
          <Menu className="h-6 w-6" />
        </button>
        
        <Link to="/" className="flex items-center gap-2 mx-auto">
          <img src="/safelive-logo.png" alt="SafeLive" className="h-8 w-auto" />
          <span className="font-heading font-bold">SafeLive</span>
        </Link>

        <button
          onClick={() => setIsProfileOpen(!isProfileOpen)}
          className="p-2 hover:bg-muted rounded-lg"
        >
          <User className="h-5 w-5" />
        </button>
      </header>

      {}
      {isSidebarOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-50"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {}
      <aside className={cn(
        "fixed top-0 left-0 bottom-0 w-64 bg-sidebar text-sidebar-foreground z-50 transform transition-transform duration-300",
        "lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col h-full">
          {}
          <div className="p-4 flex items-center justify-between border-b border-sidebar-border">
            <Link to="/" className="flex items-center gap-2">
              <img src="/safelive-logo.png" alt="SafeLive" className="h-10 w-auto" />
              <span className="text-lg font-heading font-bold">SafeLive</span>
            </Link>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="lg:hidden p-2 hover:bg-sidebar-accent rounded-lg"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {}
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setIsSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl transition-colors",
                    isActive 
                      ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                      : "hover:bg-sidebar-accent/50"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="font-medium">{item.label}</span>
                  {item.badge && (
                    <span className="ml-auto px-2 py-0.5 bg-destructive text-destructive-foreground text-xs font-medium rounded-full">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
            <button
              onClick={() => {
                setIsSidebarOpen(false);
                handleSettingsClick();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-sidebar-accent/50"
            >
              <Settings className="h-5 w-5" />
              <span className="font-medium">Settings</span>
            </button>
          </nav>

          {}
          <div className="p-4 border-t border-sidebar-border">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-sidebar-accent flex items-center justify-center">
                <User className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{userName}</div>
                <div className="text-xs text-sidebar-foreground/60 truncate">{userEmail}</div>
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {}
      <main className={cn(
        "min-h-screen pt-16 lg:pt-0 lg:pl-64 transition-all duration-300"
      )}>
        {}
        <header className="hidden lg:flex items-center justify-between h-16 px-6 bg-card border-b border-border">
          <h1 className="text-lg font-heading font-semibold text-foreground">
            {navItems.find(item => item.path === location.pathname)?.label || 'Dashboard'}
          </h1>

          <div className="relative">
              <button
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-2 px-3 py-2 hover:bg-muted rounded-lg transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <span className="font-medium text-sm">{userName}</span>
                <ChevronDown className={cn(
                  "h-4 w-4 text-muted-foreground transition-transform",
                  isProfileOpen && "rotate-180"
                )} />
            </button>

            {isProfileOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setIsProfileOpen(false)} 
                />
                <div className="absolute right-0 mt-2 w-48 bg-card rounded-xl shadow-card border border-border z-50 py-2 animate-scale-in">
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      handleSettingsClick();
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm hover:bg-muted transition-colors"
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </button>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-destructive hover:bg-muted transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                    Logout
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
};
