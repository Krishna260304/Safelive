import { useMemo, useState } from 'react';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import { LeafletMap } from '@/components/maps/LeafletMap';
import { useHeatmap, useIncidents, useTickets } from '@/hooks/use-data';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const OfficialMap = () => {
  const { incidents, loading: incidentsLoading } = useIncidents();
  const { tickets, loading: ticketsLoading } = useTickets();
  const { points: heatmapPoints } = useHeatmap();

  const [showIncidents, setShowIncidents] = useState(true);
  const [showTickets, setShowTickets] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);

  const markers = useMemo(() => {
    const items: {
      id: string;
      entityId?: string;
      position: { lat: number; lng: number };
      title: string;
      description?: string;
      status?: string;
      priority?: string;
      type?: string;
    }[] = [];

    if (showIncidents) {
      incidents.forEach((incident) => {
        if (typeof incident.latitude === 'number' && typeof incident.longitude === 'number') {
          items.push({
            id: `incident-${incident.id}`,
            entityId: incident.id,
            position: { lat: incident.latitude, lng: incident.longitude },
            title: incident.title || 'Incident',
            description: incident.description,
            status: incident.status,
            priority: incident.priority,
            type: 'incident',
          });
        }
      });
    }

    if (showTickets) {
      tickets.forEach((ticket) => {
        if (typeof ticket.latitude === 'number' && typeof ticket.longitude === 'number') {
          items.push({
            id: `ticket-${ticket.id}`,
            entityId: ticket.incidentId || ticket.id,
            position: { lat: ticket.latitude, lng: ticket.longitude },
            title: ticket.title || 'Ticket',
            description: ticket.description,
            status: ticket.status,
            priority: ticket.priority,
            type: 'ticket',
          });
        }
      });
    }

    return items;
  }, [incidents, tickets, showIncidents, showTickets]);

  return (
    <OfficialDashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Live Map</h1>
            <p className="text-muted-foreground">
              Real-time incident and ticket visibility across zones
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showIncidents ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowIncidents((value) => !value)}
            >
              Incidents
            </Button>
            <Button
              variant={showTickets ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowTickets((value) => !value)}
            >
              Tickets
            </Button>
            <Button
              variant={showHeatmap ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowHeatmap((value) => !value)}
            >
              Heatmap
            </Button>
          </div>
        </div>

        <LeafletMap
          markers={markers}
          heatmapPoints={heatmapPoints}
          showHeatmap={showHeatmap}
          zoom={12}
          height="560px"
        />

        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-card rounded-xl border border-border p-4">
            <h2 className="font-heading font-semibold text-foreground mb-3">Recent Incidents</h2>
            {incidentsLoading && <div className="text-sm text-muted-foreground">Loading incidents...</div>}
            {!incidentsLoading && incidents.length === 0 && (
              <div className="text-sm text-muted-foreground">No incidents found</div>
            )}
            <div className="space-y-3">
              {incidents.slice(0, 8).map((incident) => (
                <div key={incident.id} className="p-3 border border-border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-foreground">{incident.title}</div>
                    <div
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full border',
                        incident.status === 'resolved'
                          ? 'badge-success'
                          : incident.status === 'in_progress'
                          ? 'badge-warning'
                          : 'badge-info'
                      )}
                    >
                      {incident.status}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{incident.location}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-card rounded-xl border border-border p-4">
            <h2 className="font-heading font-semibold text-foreground mb-3">Active Tickets</h2>
            {ticketsLoading && <div className="text-sm text-muted-foreground">Loading tickets...</div>}
            {!ticketsLoading && tickets.length === 0 && (
              <div className="text-sm text-muted-foreground">No tickets found</div>
            )}
            <div className="space-y-3">
              {tickets.slice(0, 8).map((ticket) => (
                <div key={ticket.id} className="p-3 border border-border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-foreground">{ticket.title}</div>
                    <div
                      className={cn(
                        'text-xs px-2 py-0.5 rounded-full border',
                        ticket.status === 'resolved'
                          ? 'badge-success'
                          : ticket.status === 'in_progress'
                          ? 'badge-warning'
                          : 'badge-info'
                      )}
                    >
                      {ticket.status}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">{ticket.location}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </OfficialDashboardLayout>
  );
};

export default OfficialMap;
