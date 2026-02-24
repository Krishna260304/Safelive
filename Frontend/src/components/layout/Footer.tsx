import { Link } from 'react-router-dom';
import { Shield, Facebook, Twitter, Instagram, Linkedin, Mail, Phone, MapPin } from 'lucide-react';

export const Footer = () => {
  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="container max-w-6xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {}
          <div className="md:col-span-1">
            <Link to="/" className="inline-flex items-center gap-2 mb-4">
              <div className="p-2 rounded-xl bg-white/10">
                <Shield className="h-6 w-6" />
              </div>
              <span className="text-xl font-heading font-bold">SafeLive</span>
            </Link>
            <p className="text-primary-foreground/70 text-sm leading-relaxed">
              AI-powered smart city incident management for campuses, societies, and cities.
            </p>
            
            {}
            <div className="flex items-center gap-4 mt-6">
              <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                <Facebook className="h-5 w-5" />
              </a>
              <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                <Twitter className="h-5 w-5" />
              </a>
              <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                <Instagram className="h-5 w-5" />
              </a>
              <a href="#" className="text-primary-foreground/60 hover:text-primary-foreground transition-colors">
                <Linkedin className="h-5 w-5" />
              </a>
            </div>
          </div>

          {}
          <div>
            <h3 className="font-semibold mb-4">Quick Links</h3>
            <ul className="space-y-2">
              <li>
                <Link to="/#features" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link to="/#how-it-works" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  How It Works
                </Link>
              </li>
              <li>
                <Link to="/login" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  Login
                </Link>
              </li>
              <li>
                <Link to="/register" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  Register
                </Link>
              </li>
            </ul>
          </div>

          {}
          <div>
            <h3 className="font-semibold mb-4">Support</h3>
            <ul className="space-y-2">
              <li>
                <a href="#" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  Help Center
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  FAQs
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  Privacy Policy
                </a>
              </li>
              <li>
                <a href="#" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  Terms of Service
                </a>
              </li>
            </ul>
          </div>

          {}
          <div>
            <h3 className="font-semibold mb-4">Contact Us</h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <MapPin className="h-4 w-4 mt-1 text-primary-foreground/60" />
                <span className="text-primary-foreground/70 text-sm">
                  ITER, Bhubaneswar, Odisha
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-primary-foreground/60" />
                <a href="mailto:safelive.alerts@gmail.com" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  safelive.alerts@gmail.com
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-primary-foreground/60" />
                <a href="tel:+911234567890" className="text-primary-foreground/70 hover:text-primary-foreground text-sm transition-colors">
                  +91 123 456 7890
                </a>
              </li>
            </ul>
          </div>
        </div>

        {}
        <div className="mt-12 pt-8 border-t border-primary-foreground/10 text-center">
          <p className="text-primary-foreground/60 text-sm">
            © {new Date().getFullYear()} SafeLive. All rights reserved. Made for Smart Cities.
          </p>
        </div>
      </div>
    </footer>
  );
};
