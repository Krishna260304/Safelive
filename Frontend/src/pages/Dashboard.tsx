import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ClipboardList, Clock, Filter, MapPin, Plus, RefreshCw } from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SettingsModal } from '@/components/SettingsModal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useIncidents } from '@/hooks/use-data';
import { Incident, IncidentLogEntry, incidentService } from '@/services/incidents';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LineChart,
  Line,
  ResponsiveContainer,
} from 'recharts';

const statusStyles: Record<string, string> = {
  open: 'badge-info',
  pending: 'badge-warning',
  in_progress: 'badge-warning',
  resolved: 'badge-success',
  verified: 'badge-success',
  rejected: 'badge-destructive',
};

const displayIncidentId = (incident: { incidentId?: string; id: string }) => (incident.incidentId || incident.id);

const formatActionLabel = (value?: string) => {
  const text = (value || '').trim();
  if (!text) return 'Unknown action';
  return text
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const logbookDetailText = (details?: Record<string, unknown>) => {
  if (!details || Object.keys(details).length === 0) return 'No extra details';
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ');
};

const Dashboard = () => {
  const { incidents, loading, error, refetch } = useIncidents();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [logbookDialogOpen, setLogbookDialogOpen] = useState(false);
  const [logbookLoading, setLogbookLoading] = useState(false);
  const [logbookIncident, setLogbookIncident] = useState<Incident | null>(null);
  const [logbookEntries, setLogbookEntries] = useState<IncidentLogEntry[]>([]);
  const [logbookError, setLogbookError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return incidents;
    return incidents.filter((i) =>
      [i.title, i.description, i.category, i.location, i.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [incidents, query]);

  const selected = filtered.find((i) => i.id === selectedId) || filtered[0] || null;

  const stats = useMemo(() => {
    const total = incidents.length;
    const open = incidents.filter((i) => i.status === 'open' || i.status === 'pending').length;
    const inProgress = incidents.filter((i) => i.status === 'in_progress').length;
    const resolved = incidents.filter((i) => i.status === 'resolved').length;
    const critical = incidents.filter((i) => i.priority === 'critical').length;
    const high = incidents.filter((i) => i.priority === 'high').length;
    return { total, open, inProgress, resolved, critical, high };
  }, [incidents]);

  // Data for status pie chart
  const statusData = useMemo(() => {
    return [
      { name: 'Open', value: stats.open, fill: '#0ea5e9' },
      { name: 'In Progress', value: stats.inProgress, fill: '#f59e0b' },
      { name: 'Resolved', value: stats.resolved, fill: '#10b981' },
    ].filter(item => item.value > 0);
  }, [stats]);

  // Data for category breakdown
  const categoryData = useMemo(() => {
    const categories: Record<string, number> = {};
    incidents.forEach((i) => {
      categories[i.category] = (categories[i.category] || 0) + 1;
    });
    return Object.entries(categories)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [incidents]);

  // Data for timeline
  const timelineData = useMemo(() => {
    const dates: Record<string, number> = {};
    incidents.forEach((i) => {
      const date = new Date(i.createdAt).toLocaleDateString();
      dates[date] = (dates[date] || 0) + 1;
    });
    return Object.entries(dates)
      .sort(([a], [b]) => new Date(a).getTime() - new Date(b).getTime())
      .map(([date, count]) => ({ date, count }));
  }, [incidents]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  const handleOpenLogbook = async (incident: Incident) => {
    setLogbookIncident(incident);
    setLogbookDialogOpen(true);
    setLogbookLoading(true);
    setLogbookEntries([]);
    setLogbookError(null);

    const response = await incidentService.getLogbook(incident.id);
    if (response.success && response.data) {
      setLogbookEntries(response.data);
    } else {
      setLogbookError(response.error || 'Could not load logbook.');
    }
    setLogbookLoading(false);
  };

  return (
    <>
      <SettingsModal open={showSettings} onOpenChange={setShowSettings} />
      <DashboardLayout onSettingsClick={() => setShowSettings(true)}>
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-heading font-bold text-foreground">Smart City Dashboard</h1>
              <p className="text-muted-foreground">Track and manage reported issues in real time</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </Button>
              <Link to="/dashboard/report">
                <Button className="gradient-primary hover:opacity-90">
                  <Plus className="h-4 w-4 mr-2" />
                  Report New Incident
                </Button>
              </Link>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Total</div>
              <div className="text-2xl font-bold text-foreground">{stats.total}</div>
            </div>
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Open</div>
              <div className="text-2xl font-bold text-blue-500">{stats.open}</div>
            </div>
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">In Progress</div>
              <div className="text-2xl font-bold text-amber-500">{stats.inProgress}</div>
            </div>
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Resolved</div>
              <div className="text-2xl font-bold text-green-500">{stats.resolved}</div>
            </div>
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">Critical</div>
              <div className="text-2xl font-bold text-red-500">{stats.critical}</div>
            </div>
            <div className="p-4 bg-card rounded-lg border border-border">
              <div className="text-xs text-muted-foreground mb-1">High Priority</div>
              <div className="text-2xl font-bold text-orange-500">{stats.high}</div>
            </div>
          </div>

          {/* Charts Section */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Status Distribution */}
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="font-semibold text-foreground mb-4">Status Distribution</h3>
              {statusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">No data</div>
              )}
            </div>

            {/* Category Breakdown */}
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="font-semibold text-foreground mb-4">Categories</h3>
              {categoryData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={categoryData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#0ea5e9" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">No data</div>
              )}
            </div>

            {/* Timeline */}
            <div className="bg-card rounded-lg border border-border p-4">
              <h3 className="font-semibold text-foreground mb-4">Incident Trend</h3>
              {timelineData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={timelineData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#0ea5e9" strokeWidth={2} dot={{ fill: '#0ea5e9' }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">No data</div>
              )}
            </div>
          </div>

          {/* Incidents List and Details */}
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Filter className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by title, category, status, location"
                    className="pl-9"
                  />
                </div>
              </div>

              {loading && (
                <div className="p-4 bg-card rounded-lg border border-border text-muted-foreground text-center">
                  Loading incidents...
                </div>
              )}
              {error && (
                <div className="p-4 bg-card rounded-lg border border-border text-destructive text-center">{error}</div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="p-8 bg-card rounded-lg border border-border text-center">
                  <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No incidents found</p>
                </div>
              )}

              <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
                {filtered.map((incident) => (
                  <div
                    key={incident.id}
                    onClick={() => setSelectedId(incident.id)}
                    className={cn(
                      "p-4 bg-card rounded-lg border border-border cursor-pointer transition-all hover:border-primary hover:shadow-md",
                      selected?.id === incident.id && "border-primary bg-primary/5"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="px-2 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">{incident.category}</span>
                          <span className={cn("px-2 py-0.5 text-xs font-medium rounded-full border", statusStyles[incident.status] || 'badge-info')}>
                            {incident.status}
                          </span>
                          {incident.priority && (
                            <span className={cn("px-2 py-0.5 text-xs font-medium rounded", {
                              'bg-red-100 text-red-700': incident.priority === 'critical',
                              'bg-orange-100 text-orange-700': incident.priority === 'high',
                              'bg-yellow-100 text-yellow-700': incident.priority === 'medium',
                              'bg-gray-100 text-gray-700': incident.priority === 'low',
                            })}>
                              {incident.priority}
                            </span>
                          )}
                        </div>
                        <h3 className="font-medium text-foreground truncate">{incident.title}</h3>
                        <div className="text-xs text-muted-foreground mt-1">Incident ID: {displayIncidentId(incident)}</div>
                        <div className="text-sm text-muted-foreground mt-1 line-clamp-2">{incident.description}</div>
                        <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {incident.location}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(incident.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-2 gap-1"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleOpenLogbook(incident);
                          }}
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          LogBook
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Detail Panel */}
            <div className="bg-card rounded-lg border border-border p-4 h-fit">
              <h2 className="font-heading font-semibold text-foreground mb-4">Incident Detail</h2>
              {!selected && <p className="text-sm text-muted-foreground">Select an incident to view details</p>}
              {selected && (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Incident ID</div>
                    <div className="text-sm text-foreground mt-1 font-mono">{displayIncidentId(selected)}</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => {
                      void handleOpenLogbook(selected);
                    }}
                  >
                    <ClipboardList className="h-4 w-4" />
                    Open LogBook
                  </Button>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Title</div>
                    <div className="font-medium text-foreground mt-1">{selected.title}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Description</div>
                    <div className="text-sm text-foreground mt-1">{selected.description || '-'}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Status</div>
                      <div className="text-sm text-foreground mt-1 font-medium capitalize">{selected.status}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Priority</div>
                      <div className="text-sm text-foreground mt-1 font-medium capitalize">{selected.priority || '-'}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Category</div>
                      <div className="text-sm text-foreground mt-1 font-medium capitalize">{selected.category}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">Severity</div>
                      <div className="text-sm text-foreground mt-1 font-medium capitalize">
                        {selected.severity || selected.priority || '-'}
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-border pt-4">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Location</div>
                    <div className="text-sm text-foreground mt-1 font-medium">{selected.location}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                       {selected.latitude ?? '-'}, {selected.longitude ?? '-'}
                    </div>
                  </div>
                  {selected.imageUrl && (
                    <img
                      src={selected.imageUrl}
                      alt={selected.title}
                      className="w-full h-40 object-cover rounded-lg border border-border"
                    />
                  )}
                  <div className="border-t border-border pt-4">
                    <div className="text-xs text-muted-foreground">
                      Created: {new Date(selected.createdAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Updated: {selected.updatedAt ? new Date(selected.updatedAt).toLocaleString() : '-'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DashboardLayout>
      <Dialog open={logbookDialogOpen} onOpenChange={setLogbookDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Incident LogBook</DialogTitle>
            <DialogDescription>
              Activity logbook for {logbookIncident?.title || 'incident'} ({logbookIncident ? displayIncidentId(logbookIncident) : 'N/A'}).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {logbookLoading && <div className="text-sm text-muted-foreground">Loading logbook...</div>}
            {!logbookLoading && logbookError && (
              <div className="text-sm text-destructive">{logbookError}</div>
            )}
            {!logbookLoading && !logbookError && logbookEntries.length === 0 && (
              <div className="text-sm text-muted-foreground">No logbook entries available yet.</div>
            )}
            {!logbookLoading && !logbookError && logbookEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-3">
                <div className="text-sm font-medium text-foreground">{formatActionLabel(entry.action)}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  By {entry.actorName || 'System'} {entry.actorOfficialRole ? `(${entry.actorOfficialRole})` : ''} on {new Date(entry.createdAt).toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{logbookDetailText(entry.details)}</div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Dashboard;
