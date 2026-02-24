import { useMemo, useState } from 'react';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import { LeafletMap } from '@/components/maps/LeafletMap';
import { useIncidents } from '@/hooks/use-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertTriangle, MapPin, Filter, Siren, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const isCriticalPriority = (priority?: string) => priority === 'high' || priority === 'critical';

const formatPriorityLabel = (priority?: string) => {
  const value = (priority || '').trim().toLowerCase();
  if (!value) return 'Unknown';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

export default function OfficialAlerts() {
  const { incidents, loading } = useIncidents();
  const [filter, setFilter] = useState<'all' | 'critical' | 'recent'>('all');

  const activeAlerts = useMemo(() => {
    let sorted = [...incidents].sort((a, b) => 
      new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime()
    );

    if (filter === 'critical') {
      sorted = sorted.filter((i) => isCriticalPriority(i.priority));
    }
    
    return sorted;
  }, [incidents, filter]);

  const mapMarkers = useMemo(() => {
    return activeAlerts
      .filter(i => i.latitude && i.longitude)
      .map(i => ({
        id: i.id,
        entityId: i.id,
        position: { lat: i.latitude, lng: i.longitude },
        title: i.title,
        description: i.description,
        status: i.status,
        priority: i.priority,
        type: i.category
      }));
  }, [activeAlerts]);

  const criticalCount = incidents.filter((i) => isCriticalPriority(i.priority)).length;

  return (
    <OfficialDashboardLayout>
      <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-bold font-heading flex items-center gap-2 text-foreground">
              <Siren className="text-red-500 animate-pulse" />
              Real-Time Alert Center
            </h1>
            <p className="text-muted-foreground">
              Live monitoring of city incidents and emergency reports.
            </p>
          </div>
          <div className="flex gap-2">
            <Button 
              variant={filter === 'all' ? 'default' : 'outline'} 
              onClick={() => setFilter('all')}
              size="sm"
            >
              All Alerts
            </Button>
            <Button 
              variant={filter === 'critical' ? 'destructive' : 'outline'} 
              onClick={() => setFilter('critical')}
              size="sm"
              className={cn(filter === 'critical' && "animate-pulse")}
            >
              <AlertTriangle className="mr-2 h-4 w-4" />
              Critical ({criticalCount})
            </Button>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-6 flex-1 min-h-0">
          
          <Card className="lg:col-span-1 flex flex-col border-border/60 shadow-md h-full overflow-hidden">
            <CardHeader className="pb-3 border-b border-border/50 shrink-0 bg-muted/20">
              <CardTitle className="text-lg flex justify-between items-center">
                <span>Live Feed</span>
                <Badge variant="outline" className="font-normal">
                  {activeAlerts.length} Active
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-y-auto scrollbar-thin">
              {loading && <div className="p-4 text-center text-muted-foreground">Connecting to live feed...</div>}
              
              {!loading && activeAlerts.length === 0 && (
                <div className="p-8 text-center text-muted-foreground flex flex-col items-center">
                  <CheckCircle2 className="h-12 w-12 text-green-500 mb-2 opacity-20" />
                  <p>All clear. No active alerts.</p>
                </div>
              )}

              <div className="divide-y divide-border/50">
                {activeAlerts.map((alert) => (
                  <div 
                    key={alert.id} 
                    className={cn(
                      "p-4 hover:bg-muted/50 transition-colors cursor-pointer border-l-4",
                      isCriticalPriority(alert.priority)
                        ? "border-l-red-500 bg-red-50/10" 
                        : "border-l-transparent"
                    )}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <div className="min-w-0">
                        <span className="font-semibold text-sm line-clamp-1 block">{alert.title}</span>
                        <span className="text-[10px] text-muted-foreground">ID: {alert.id}</span>
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                        {new Date(alert.createdAt || '').toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </span>
                    </div>
                    
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                      {alert.description}
                    </p>

                    <div className="flex items-center justify-between">
                      <div className="flex gap-2">
                        <Badge variant={
                          alert.priority === 'high' || alert.priority === 'critical' ? 'destructive' : 
                          alert.priority === 'medium' ? 'secondary' : 'outline'
                        } className="text-[10px] px-1.5 h-5">
                          {formatPriorityLabel(alert.priority)}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] px-1.5 h-5 capitalize">
                          {alert.category}
                        </Badge>
                      </div>
                      {alert.location && (
                        <div className="flex items-center text-[10px] text-muted-foreground">
                          <MapPin className="h-3 w-3 mr-1" />
                          <span className="max-w-[100px] truncate">{alert.location}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="lg:col-span-2 h-full min-h-[400px] rounded-xl overflow-hidden border border-border shadow-md relative">
             <LeafletMap 
               markers={mapMarkers}
               center={{ lat: 20.5937, lng: 78.9629 }} 
               zoom={13}
               height="100%"
               showHeatmap={false}
             />
             <div className="absolute top-4 right-4 z-[400] bg-background/90 backdrop-blur px-4 py-2 rounded-lg border shadow-sm text-xs font-medium">
               <div className="flex gap-4">
                 <div className="flex items-center gap-1">
                   <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                   <span>Critical</span>
                 </div>
                 <div className="flex items-center gap-1">
                   <div className="w-2 h-2 rounded-full bg-blue-500" />
                   <span>Standard</span>
                 </div>
               </div>
             </div>
          </div>

        </div>
      </div>
    </OfficialDashboardLayout>
  );
}
