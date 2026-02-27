import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronDown, ClipboardList, Clock, Download, Filter, MapPin, Pencil, Plus, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { SettingsModal } from '@/components/SettingsModal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useIncidents } from '@/hooks/use-data';
import { authService } from '@/services/auth';
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

const incidentCategories = [
  { value: 'pothole', label: 'Pothole / Road Damage' },
  { value: 'waterlogging', label: 'Waterlogging' },
  { value: 'garbage', label: 'Garbage / Sanitation' },
  { value: 'streetlight', label: 'Streetlight Issue' },
  { value: 'water_leakage', label: 'Water Leakage' },
  { value: 'electricity', label: 'Electricity Issue' },
  { value: 'fire', label: 'Fire Incident' },
  { value: 'drainage', label: 'Drainage / Sewer' },
  { value: 'safety', label: 'Safety / Security' },
  { value: 'other', label: 'Other' },
] as const;

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
  const isHiddenDetailKey = (key: string) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return normalized === 'workerid' || normalized === 'workerids';
  };
  const visibleEntries = Object.entries(details).filter(([key]) => !isHiddenDetailKey(key));
  if (visibleEntries.length === 0) return 'No extra details';

  return visibleEntries
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ');
};

const sanitizeLogbookSummary = (value?: string): string => {
  let text = (value || '').trim();
  if (!text) return '';
  text = text.replace(/\s+/g, ' ');

  const detailsActorMatch = text.match(/^details:\s*(.+?)\s*actor:\s*(.+?)\.?$/i);
  if (detailsActorMatch) {
    const detailsPart = detailsActorMatch[1].trim().replace(/[. ]+$/g, '');
    const actorPart = detailsActorMatch[2].trim().replace(/[. ]+$/g, '');
    if (detailsPart && actorPart) {
      return `${detailsPart} by ${actorPart}.`;
    }
  }

  text = text.replace(/^details:\s*/i, '').trim();
  text = text.replace(/\s*actor:\s*([^.;]+)/gi, (_match, actorPart: string) => ` by ${actorPart.trim()}`).trim();
  text = text.replace(/\bis an actor\b/gi, '').trim();
  if (/\bactor\b/i.test(text)) {
    return '';
  }
  if (text && !/[.!?]$/.test(text)) {
    text = `${text}.`;
  }
  return text;
};

const formatLogbookDate = (value?: string): string => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatLogbookTime = (value?: string): string => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const formatDateTime = (value?: string): string => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const toSafeFileToken = (value: string): string => {
  return (value || '')
    .split('')
    .map((char) => (/[a-zA-Z0-9\-_]/.test(char) ? char : '_'))
    .join('')
    .substring(0, 32)
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');


const Dashboard = () => {
  const { incidents, loading, error, refetch } = useIncidents();
  const currentUser = authService.getCurrentUser();
  const isLocalUser = currentUser?.userType === 'citizen';
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingIncident, setEditingIncident] = useState<Incident | null>(null);
  const [editForm, setEditForm] = useState({
    title: '',
    description: '',
    category: '',
    location: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  const [logbookDialogOpen, setLogbookDialogOpen] = useState(false);
  const [logbookLoading, setLogbookLoading] = useState(false);
  const [logbookIncident, setLogbookIncident] = useState<Incident | null>(null);
  const [logbookEntries, setLogbookEntries] = useState<IncidentLogEntry[]>([]);
  const [logbookError, setLogbookError] = useState<string | null>(null);
  const [logbookDownloadMenuOpen, setLogbookDownloadMenuOpen] = useState(false);

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
    const high = incidents.filter((i) => i.priority === 'high').length;
    return { total, open, inProgress, resolved, high };
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

  const { toast } = useToast();

  const canEditIncident = useCallback((incident: Incident) => {
    if (!isLocalUser) return false;
    const hasOfficialAction =
      Boolean(incident.officialActionTaken) || Boolean((incident.assignedTo || '').trim());
    if (hasOfficialAction) {
      return false;
    }
    const status = (incident.status || '').toLowerCase();
    if (status === 'verified' || status === 'in_progress' || status === 'resolved') {
      return false;
    }
    if (!currentUser?.id) return true;
    return !incident.reporterId || incident.reporterId === currentUser.id;
  }, [currentUser?.id, isLocalUser]);

  const handleOpenEditIncident = useCallback((incident: Incident) => {
    if (!canEditIncident(incident)) {
      return;
    }
    setEditingIncident(incident);
    setEditForm({
      title: incident.title || '',
      description: incident.description || '',
      category: incident.category || '',
      location: incident.location || '',
    });
    setEditDialogOpen(true);
  }, [canEditIncident]);

  const handleSaveEditIncident = useCallback(async () => {
    if (!editingIncident) return;

    const title = editForm.title.trim();
    const category = editForm.category.trim();
    const location = editForm.location.trim();
    const description = editForm.description.trim();

    if (title.length < 10) {
      toast({
        title: 'Title Too Short',
        description: 'Title must be at least 10 characters.',
        variant: 'destructive',
      });
      return;
    }
    if (!category) {
      toast({
        title: 'Category Required',
        description: 'Please select a category.',
        variant: 'destructive',
      });
      return;
    }
    if (location.length < 5) {
      toast({
        title: 'Location Required',
        description: 'Please enter a valid location.',
        variant: 'destructive',
      });
      return;
    }

    setEditSaving(true);
    const response = await incidentService.updateIncident(editingIncident.id, {
      title,
      description,
      category,
      location,
    });

    if (response.success) {
      toast({
        title: 'Incident Updated',
        description: 'Your incident details were updated successfully.',
      });
      setEditDialogOpen(false);
      setEditingIncident(null);
      setSelectedId(editingIncident.id);
      await refetch();
    } else {
      toast({
        title: 'Update Failed',
        description: response.error || 'Could not update incident.',
        variant: 'destructive',
      });
    }
    setEditSaving(false);
  }, [editForm, editingIncident, refetch, toast]);

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

  const logbookRows = useMemo(() => {
    return logbookEntries.map((entry) => ({
      id: entry.id,
      action: formatActionLabel(entry.action),
      actor: entry.actorName || 'System',
      actorRole: entry.actorOfficialRole || '',
      date: formatLogbookDate(entry.createdAt),
      time: formatLogbookTime(entry.createdAt),
      details: sanitizeLogbookSummary(entry.summary) || logbookDetailText(entry.details),
    }));
  }, [logbookEntries]);

  const handleDownloadLogbookPdf = useCallback(() => {
    if (!logbookRows.length) {
      toast({
        title: 'No Log Entries',
        description: 'Logbook is empty. Nothing to export.',
        variant: 'destructive',
      });
      return;
    }

    const incidentLabel = logbookIncident ? displayIncidentId(logbookIncident) : 'incident';
    const safeIncidentLabel = toSafeFileToken(incidentLabel);
    const printableRows = logbookRows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.action)}</td><td>${escapeHtml(
            row.details
          )}<br/><span style="font-size:11px;color:#4b5563">${escapeHtml(
            row.actor
          )}${row.actorRole ? ` (${escapeHtml(row.actorRole)})` : ''}</span></td><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.time)}</td></tr>`
      )
      .join('');

    const printableHtml = [
      '<!doctype html><html><head><meta charset="utf-8" />',
      `<title>Logbook ${escapeHtml(incidentLabel)}</title>`,
      '<style>',
      'body{font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#111827;}',
      'h1{font-size:16px;margin:0 0 8px;}',
      'p{margin:0 0 12px;color:#4b5563;font-size:12px;}',
      'table{width:100%;border-collapse:collapse;font-size:12px;}',
      'thead th{background:#f3f4f6;color:#111827;border:1px solid #d1d5db;padding:8px;text-align:left;}',
      'tbody td{border:1px solid #e5e7eb;padding:8px;vertical-align:top;}',
      'tbody tr:nth-child(odd){background:#fafafa;}',
      '</style></head><body>',
      `<h1>Incident Logbook - ${escapeHtml(incidentLabel)}</h1>`,
      `<p>Generated on ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>`,
      `<table><thead><tr><th>Action</th><th>Details</th><th>Date</th><th>Time</th></tr></thead><tbody>${printableRows}</tbody></table>`,
      '</body></html>',
    ].join('');

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.setAttribute('title', `logbook-print-${safeIncidentLabel}`);
    document.body.appendChild(iframe);
    iframe.srcdoc = printableHtml;
    iframe.onload = () => {
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        iframe.remove();
        return;
      }
      printWindow.print();
      setTimeout(() => iframe.remove(), 1000);
    };
  }, [logbookRows, logbookIncident, toast]);

  const handleDownloadLogbookExcel = useCallback(() => {
    if (!logbookRows.length) {
      toast({
        title: 'No Log Entries',
        description: 'Logbook is empty. Nothing to export.',
        variant: 'destructive',
      });
      return;
    }

    const incidentLabel = logbookIncident ? displayIncidentId(logbookIncident) : 'incident';
    const safeIncidentLabel = toSafeFileToken(incidentLabel);

    // Prepare data for Excel
    const worksheetData: (string)[][] = [
      ['Action', 'Details', 'Date', 'Time'],
      ...logbookRows.map((row) => [
        row.action,
        `${row.details}\n${row.actor}${row.actorRole ? ` (${row.actorRole})` : ''}`,
        row.date,
        row.time,
      ]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    worksheet['!cols'] = [{ wch: 28 }, { wch: 58 }, { wch: 14 }, { wch: 10 }];

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Logbook');

    // Write file
    XLSX.writeFile(workbook, `incident-logbook-${safeIncidentLabel}.xlsx`);
  }, [logbookRows, logbookIncident, toast]);

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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
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
                        <div className="flex items-center gap-2">
                          {canEditIncident(incident) && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-2 gap-1"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleOpenEditIncident(incident);
                              }}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                          )}
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
                  {canEditIncident(selected) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => {
                        handleOpenEditIncident(selected);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit Incident
                    </Button>
                  )}
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
      <Dialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open);
          if (!open) {
            setEditingIncident(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit Incident</DialogTitle>
            <DialogDescription>
              Update your submitted incident details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-incident-title">Title</Label>
              <Input
                id="edit-incident-title"
                value={editForm.title}
                onChange={(event) => setEditForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Incident title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-incident-description">Description</Label>
              <Textarea
                id="edit-incident-description"
                value={editForm.description}
                onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="Describe the issue"
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={editForm.category}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, category: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {incidentCategories.map((category) => (
                    <SelectItem key={category.value} value={category.value}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-incident-location">Location</Label>
              <Textarea
                id="edit-incident-location"
                value={editForm.location}
                onChange={(event) => setEditForm((prev) => ({ ...prev, location: event.target.value }))}
                placeholder="Incident location"
                rows={2}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditDialogOpen(false);
                  setEditingIncident(null);
                }}
                disabled={editSaving}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleSaveEditIncident()} disabled={editSaving}>
                {editSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={logbookDialogOpen} onOpenChange={setLogbookDialogOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Incident LogBook</DialogTitle>
            <DialogDescription>
              Activity logbook for {logbookIncident?.title || 'incident'} ({logbookIncident ? displayIncidentId(logbookIncident) : 'N/A'}).
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 relative">
            <div className="text-xs text-muted-foreground">
              Total entries: {logbookRows.length}
            </div>
            <div className="relative">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={logbookLoading || logbookEntries.length === 0}
                onClick={() => setLogbookDownloadMenuOpen(!logbookDownloadMenuOpen)}
              >
                <Download className="h-4 w-4 mr-1" />
                Download
                <ChevronDown className="h-4 w-4 ml-1 opacity-60" />
              </Button>
              {logbookDownloadMenuOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-40"
                    onClick={() => setLogbookDownloadMenuOpen(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 w-40 bg-background border border-border rounded-md shadow-lg z-50">
                    <button
                      className="w-full text-left px-4 py-2 hover:bg-accent hover:text-accent-foreground transition-colors text-sm"
                      onClick={() => {
                        setLogbookDownloadMenuOpen(false);
                        handleDownloadLogbookPdf();
                      }}
                    >
                      Download PDF
                    </button>
                    <button
                      className="w-full text-left px-4 py-2 hover:bg-accent hover:text-accent-foreground transition-colors text-sm border-t border-border"
                      onClick={() => {
                        setLogbookDownloadMenuOpen(false);
                        handleDownloadLogbookExcel();
                      }}
                    >
                      Download Excel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th className="border border-border px-3 py-2 text-left text-xs font-semibold">Action</th>
                    <th className="border border-border px-3 py-2 text-left text-xs font-semibold">Details</th>
                    <th className="border border-border px-3 py-2 text-left text-xs font-semibold">Date</th>
                    <th className="border border-border px-3 py-2 text-left text-xs font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {logbookLoading && (
                    <tr>
                      <td colSpan={4} className="border border-border px-3 py-6 text-center text-sm text-muted-foreground">
                        Loading logbook...
                      </td>
                    </tr>
                  )}
                  {!logbookLoading && logbookError && (
                    <tr>
                      <td colSpan={4} className="border border-border px-3 py-6 text-center text-sm text-destructive">
                        {logbookError}
                      </td>
                    </tr>
                  )}
                  {!logbookLoading && !logbookError && logbookRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="border border-border px-3 py-6 text-center text-sm text-muted-foreground">
                        No logbook entries available yet.
                      </td>
                    </tr>
                  )}
                  {!logbookLoading &&
                    !logbookError &&
                    logbookRows.map((row, index) => (
                      <tr key={row.id} className={index % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="border border-border px-3 py-2 align-top">{row.action}</td>
                        <td className="border border-border px-3 py-2 align-top">
                          <div className="text-foreground">{row.details}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {row.actor}
                            {row.actorRole ? ` (${row.actorRole})` : ''}
                          </div>
                        </td>
                        <td className="border border-border px-3 py-2 align-top">{row.date}</td>
                        <td className="border border-border px-3 py-2 align-top">{row.time}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Dashboard;
