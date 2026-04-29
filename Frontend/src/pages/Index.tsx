import { Link } from 'react-router-dom';
import { 
  ArrowRight, 
  Camera, 
  MapPin, 
  Bell, 
  BarChart3, 
  MessageSquare,
  ClipboardCheck,
  Users,
  Building2,
  TreePine
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Navbar } from '@/components/layout/Navbar';
import { Footer } from '@/components/layout/Footer';
import { usePublicSummary } from '@/hooks/use-data';

const Index = () => {
  const { data: summary } = usePublicSummary();
  const features = [
    {
      icon: Camera,
      title: 'AI-Powered Detection',
      description: 'Automatically detect potholes, waterlogging, garbage, and safety issues using advanced computer vision.',
    },
    {
      icon: MapPin,
      title: 'GPS Location Mapping',
      description: 'Precise location tagging with automatic geo-coordinates for quick incident identification.',
    },
    {
      icon: Bell,
      title: 'Real-time Alerts',
      description: 'Instant notifications to relevant authorities and stakeholders when issues are detected.',
    },
    {
      icon: ClipboardCheck,
      title: 'Auto Ticket Generation',
      description: 'Automatic work order creation with priority classification and assignment.',
    },
    {
      icon: MessageSquare,
      title: 'Direct Communication',
      description: 'Chat directly with assigned authorities and track resolution progress.',
    },
    {
      icon: BarChart3,
      title: 'Analytics Dashboard',
      description: 'Comprehensive insights with heatmaps, productivity metrics, and resolution stats.',
    },
  ];

  const steps = [
    {
      number: '01',
      title: 'Report Issue',
      description: 'Upload photos of incidents with location details through our easy-to-use interface.',
    },
    {
      number: '02',
      title: 'Auto Processing',
      description: 'AI analyzes the issue, classifies severity, and generates a ticket automatically.',
    },
    {
      number: '03',
      title: 'Assignment',
      description: 'The system assigns the ticket to the appropriate department or personnel.',
    },
    {
      number: '04',
      title: 'Track & Resolve',
      description: 'Monitor progress in real-time and receive updates until resolution.',
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      {}
      <section className="relative pt-24 pb-20 overflow-hidden">
        {}
        <div className="absolute inset-0 hero-pattern" />
        <div className="absolute top-20 right-0 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent/5 rounded-full blur-3xl" />
        
        <div className="container max-w-6xl mx-auto px-4 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8 animate-slide-up">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-heading font-bold text-foreground leading-tight">
                Smart Incident Resolution for Modern Cities
              </h1>
              
              <p className="text-lg text-muted-foreground max-w-xl">
                Report, track, and resolve civic issues seamlessly. From potholes to safety concerns, 
                SafeLive connects citizens with authorities for faster resolutions.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <Link to="/register">
                  <Button size="lg" className="gradient-primary hover:opacity-90 transition-opacity w-full sm:w-auto">
                    Get Started
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <Link to="/login">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Local Login
                  </Button>
                </Link>
                <Link to="/official/login">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto">
                    Official Login
                  </Button>
                </Link>
              </div>
            </div>

            {}
            <div className="relative lg:pl-8 animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <div className="relative">
                {}
                <div className="bg-card rounded-2xl shadow-elevated p-6 border border-border">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm font-medium text-muted-foreground">Recent Incidents</span>
                    <span className="px-2 py-1 bg-success/10 text-success text-xs font-medium rounded-full">Live</span>
                  </div>
                  
                  {}
                  <div className="space-y-3">
                    {(summary?.recent || []).slice(0, 3).map((incident, i) => {
                      const status = incident.status || 'open';
                      const color = status === 'resolved' ? 'success' : status === 'in_progress' ? 'warning' : 'info';
                      return (
                        <div key={incident.id || i} className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                          <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full bg-${color}`} />
                            <div>
                              <div className="text-sm font-medium text-foreground">{incident.category || 'Issue'}</div>
                              <div className="text-xs text-muted-foreground">{incident.location}</div>
                            </div>
                          </div>
                          <span className={`text-xs font-medium badge-${color} px-2 py-1 rounded-full border`}>
                            {status.replace('_', ' ')}
                          </span>
                        </div>
                      );
                    })}
                    {(!summary?.recent || summary.recent.length === 0) && (
                      <div className="text-sm text-muted-foreground">No incidents yet</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {}
      <section className="py-20">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">
              Serving Multiple Environments
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              SafeLive operates across various environments, from educational campuses to entire cities.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              { icon: Building2, title: 'Campus', description: 'Universities, institutions, tech parks with dedicated monitoring.' },
              { icon: Users, title: 'Society', description: 'Gated communities, residential areas, and apartments.' },
              { icon: TreePine, title: 'City', description: 'Municipal zones, roads, public spaces, and markets.' },
            ].map((scope, i) => (
              <div key={i} className="group p-6 bg-card rounded-2xl border border-border card-hover">
                <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center mb-4 group-hover:shadow-glow transition-shadow">
                  <scope.icon className="h-6 w-6 text-primary-foreground" />
                </div>
                <h3 className="text-xl font-heading font-semibold text-foreground mb-2">{scope.title}</h3>
                <p className="text-muted-foreground text-sm">{scope.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {}
      <section id="features" className="py-20 bg-muted/30">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">
              Features
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Everything you need to report, track, and resolve civic issues efficiently.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => (
              <div 
                key={i} 
                className="group p-6 bg-card rounded-2xl border border-border card-hover"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                  <feature.icon className="h-6 w-6 text-primary group-hover:text-primary-foreground" />
                </div>
                <h3 className="text-lg font-heading font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground text-sm">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {}
      <section id="how-it-works" className="py-20">
        <div className="container max-w-6xl mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-heading font-bold text-foreground mb-4">
              How It Works
            </h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Simple, efficient, and transparent process from report to resolution.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map((step, i) => (
              <div key={i} className="relative">
                <div className="p-6 bg-card rounded-2xl border border-border h-full">
                  <div className="text-4xl font-heading font-bold text-primary/20 mb-4">
                    {step.number}
                  </div>
                  <h3 className="text-lg font-heading font-semibold text-foreground mb-2">
                    {step.title}
                  </h3>
                  <p className="text-muted-foreground text-sm">{step.description}</p>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 w-6 h-0.5 bg-border" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {}
      <section id="contact" className="py-20 gradient-hero">
        <div className="container max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-heading font-bold text-white mb-4">
            Ready to Make Your City Smarter?
          </h2>
          <p className="text-white/80 mb-8 max-w-2xl mx-auto">
            Join thousands of citizens and authorities working together for a better community.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register?type=local">
              <Button size="lg" className="bg-white text-primary hover:bg-white/90 w-48">
                Register as Citizen
              </Button>
            </Link>
            <Link to="/register?type=official&role=worker">
              <Button size="lg" variant="outline" className="border-2 border-white text-primary hover:bg-white/10 w-48">
                Register as Worker
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
