import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isLoginDropdownOpen, setIsLoginDropdownOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="container max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {}
          <Link to="/" className="flex items-center gap-2 group">
            <img src="/safelive-logo.png" alt="SafeLive" className="h-10 w-auto" />
            <span className="text-lg font-heading font-bold text-foreground">
              SafeLive
            </span>
          </Link>

          {}
          <div className="hidden md:flex items-center gap-8">
          </div>

          {}
          <div className="hidden md:flex items-center gap-3">
            {}
            <div className="relative">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setIsLoginDropdownOpen(!isLoginDropdownOpen)}
              >
                Login
                <ChevronDown className={cn(
                  "h-4 w-4 transition-transform",
                  isLoginDropdownOpen && "rotate-180"
                )} />
              </Button>
              
              {isLoginDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40" 
                    onClick={() => setIsLoginDropdownOpen(false)} 
                  />
                  <div className="absolute right-0 mt-2 w-56 bg-card rounded-xl shadow-card border border-border z-50 overflow-hidden animate-scale-in">
                    <div className="py-2">
                      <Link 
                        to="/login"
                        className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
                        onClick={() => setIsLoginDropdownOpen(false)}
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-primary text-xs font-semibold">L</span>
                        </div>
                        <div>
                          <div className="font-medium text-foreground">Local Login</div>
                          <div className="text-xs text-muted-foreground">Report & track incidents</div>
                        </div>
                      </Link>
                      <Link 
                        to="/official/login"
                        className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
                        onClick={() => setIsLoginDropdownOpen(false)}
                      >
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                          <span className="text-accent text-xs font-semibold">O</span>
                        </div>
                        <div>
                          <div className="font-medium text-foreground">Official Login</div>
                          <div className="text-xs text-muted-foreground">Admin & department access</div>
                        </div>
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </div>

            <Link to="/register">
              <Button className="gradient-primary hover:opacity-90 transition-opacity">
                Register Now
              </Button>
            </Link>
          </div>

          {}
          <button
            className="md:hidden p-2 text-foreground"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {}
      {isMenuOpen && (
        <div className="md:hidden bg-card border-b border-border animate-fade-in">
          <div className="container max-w-6xl mx-auto px-4 py-4 space-y-4">
            <Link 
              to="/#features" 
              className="block py-2 text-foreground font-medium"
              onClick={() => setIsMenuOpen(false)}
            >
              Features
            </Link>
            <Link 
              to="/#how-it-works" 
              className="block py-2 text-foreground font-medium"
              onClick={() => setIsMenuOpen(false)}
            >
              How It Works
            </Link>
            <Link 
              to="/#contact" 
              className="block py-2 text-foreground font-medium"
              onClick={() => setIsMenuOpen(false)}
            >
              Contact
            </Link>
            
            <div className="pt-4 space-y-3 border-t border-border">
              <Link to="/login" onClick={() => setIsMenuOpen(false)}>
                <Button variant="outline" className="w-full">
                  Login
                </Button>
              </Link>
              <Link to="/register" onClick={() => setIsMenuOpen(false)}>
                <Button className="w-full gradient-primary hover:opacity-90">
                  Register Now
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};
