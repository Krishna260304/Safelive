import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Shield } from 'lucide-react';

interface AuthLayoutProps {
  children: ReactNode;
}

export const AuthLayout = ({ children }: AuthLayoutProps) => {
  return (
    <div className="min-h-screen bg-background hero-pattern">
      {}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 flex flex-col min-h-screen">
        {}
        <header className="py-6 px-4">
          <div className="container max-w-6xl mx-auto">
            <Link to="/" className="inline-flex items-center gap-2 group">
              <div className="p-2 rounded-xl gradient-hero shadow-soft group-hover:shadow-glow transition-shadow">
                <Shield className="h-6 w-6 text-white" />
              </div>
              <span className="text-xl font-heading font-bold text-foreground">
                SafeLive
              </span>
            </Link>
          </div>
        </header>

        {}
        <main className="flex-1 flex items-center justify-center px-4 py-8">
          {children}
        </main>

        {}
        <footer className="py-6 px-4 text-center">
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} SafeLive. Smart City Incident Resolver.
          </p>
        </footer>
      </div>
    </div>
  );
};
