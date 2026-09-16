import { useEffect, useMemo, useState } from 'react';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download, Filter, RefreshCw } from 'lucide-react';
import { incidentService, Incident } from '@/services/incidents';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  resolved: 'bg-green-100 text-green-800 border-green-200',
  open: 'bg-red-100 text-red-800 border-red-200',
  in_progress: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  verified: 'bg-blue-100 text-blue-800 border-blue-200',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-orange-600',
  medium: 'text-yellow-600',
  low: 'text-slate-500',
};

const STATUS_FILTER_OPTIONS: Incident['status'][] = [
  'open',
  'in_progress',
  'resolved',
  'verified',
  'rejected',
];

const PRIORITY_FILTER_OPTIONS: NonNullable<Incident['priority']>[] = ['critical', 'high', 'medium', 'low'];

const displayIncidentId = (incident: Incident) => incident.incidentId || incident.id;

const parseApiDate = (value?: string): Date | null => {
  const raw = (value || '').trim();
  if (!raw) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const normalized = hasTimezone ? raw : `${raw}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatIstDateTime = (value?: string): string => {
  const parsed = parseApiDate(value);
  if (!parsed) return 'N/A';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
};

export default function Reports() {
  const [reports, setReports] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | Incident['status']>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | NonNullable<Incident['priority']>>('all');

  const fetchReports = async () => {
    setLoading(true);
    setError(null);
    const response = await incidentService.getIncidents();
    if (response.success && response.data) {
      setReports(response.data);
    } else {
      setError(response.error || 'Unable to load citizen reports');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const filteredReports = useMemo(() => {
    return reports.filter((incident) => {
      const matchesStatus = statusFilter === 'all' || incident.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || incident.priority === priorityFilter;
      return matchesStatus && matchesPriority;
    });
  }, [reports, statusFilter, priorityFilter]);

  const summary = useMemo(() => {
    return filteredReports.reduce(
      (acc, incident) => {
        acc.total += 1;
        acc.byStatus[incident.status] = (acc.byStatus[incident.status] || 0) + 1;
        return acc;
      },
      { total: 0, byStatus: {} as Record<string, number> }
    );
  }, [filteredReports]);

  const activeFilterCount = Number(statusFilter !== 'all') + Number(priorityFilter !== 'all');

  const downloadCSV = () => {
    if (!filteredReports.length) return;
    const headers = [
      'Incident ID',
      'Title',
      'Category',
      'Status',
      'Priority',
      'Reported By',
      'Reporter Email',
      'Reporter Phone',
      'Location',
      'Created At',
    ];

    const csvContent = [
      headers.join(','),
      ...filteredReports.map((incident) => (
        [
          displayIncidentId(incident),
          incident.title,
          incident.category,
          incident.status,
          incident.priority,
          incident.reportedBy,
          incident.reporterEmail,
          incident.reporterPhone,
          incident.location,
          incident.createdAt,
        ]
          .map((value) => `"${(value ?? '').toString().replace(/"/g, '""')}"`)
          .join(',')
      )),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "incident_report.csv");
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const clearFilters = () => {
    setStatusFilter('all');
    setPriorityFilter('all');
  };

  return (
    <OfficialDashboardLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Reports & Logs</h1>
            <p className="text-muted-foreground">Live feed of incidents reported by citizens.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={fetchReports} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} /> Refresh
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Filter className="mr-2 h-4 w-4" />
                  Filter{activeFilterCount ? ` (${activeFilterCount})` : ''}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                {STATUS_FILTER_OPTIONS.map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status}
                    checked={statusFilter === status}
                    onCheckedChange={() => {
                      setStatusFilter((current) => (current === status ? 'all' : status));
                    }}
                  >
                    {status.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Priority</DropdownMenuLabel>
                {PRIORITY_FILTER_OPTIONS.map((priority) => (
                  <DropdownMenuCheckboxItem
                    key={priority}
                    checked={priorityFilter === priority}
                    onCheckedChange={() => {
                      setPriorityFilter((current) => (current === priority ? 'all' : priority));
                    }}
                  >
                    {priority.toUpperCase()}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={clearFilters}>Clear Filters</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={downloadCSV} disabled={!filteredReports.length}>
              <Download className="mr-2 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </div>

        <Card className="border-dashed">
          <CardContent className="py-6">
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-muted-foreground">Total Reports</p>
                <p className="text-3xl font-bold">{summary.total}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Open</p>
                <p className="text-2xl font-semibold">{summary.byStatus['open'] || 0}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">In Progress</p>
                <p className="text-2xl font-semibold">{summary.byStatus['in_progress'] || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Incident Log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Incident</TableHead>
                    <TableHead>Citizen</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Reported On</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Loading citizen reports...
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading && error && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-destructive">
                        {error}
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading && !error && !filteredReports.length && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        {reports.length
                          ? 'No reports match the selected filters.'
                          : 'No citizen reports have been submitted yet.'}
                      </TableCell>
                    </TableRow>
                  )}

                  {!loading && !error && filteredReports.map((incident) => (
                    <TableRow key={incident.id}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span>{incident.title}</span>
                          <span className="text-xs text-muted-foreground">#{displayIncidentId(incident)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{incident.reportedBy || 'Unknown'}</span>
                          <span className="text-xs text-muted-foreground">{incident.reporterEmail || incident.reporterPhone || 'N/A'}</span>
                        </div>
                      </TableCell>
                      <TableCell>{incident.category}</TableCell>
                      <TableCell>
                        <span className={cn('text-sm font-medium', PRIORITY_COLORS[incident.priority || ''] || 'text-slate-500')}>
                          {incident.priority ? incident.priority.toUpperCase() : 'N/A'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn(
                          'px-2 py-1 rounded-full text-xs border capitalize',
                          STATUS_STYLES[incident.status] || 'bg-slate-100 text-slate-700 border-slate-200'
                        )}>
                          {incident.status.replace('_', ' ')}
                        </span>
                      </TableCell>
                      <TableCell>{incident.location || 'N/A'}</TableCell>
                      <TableCell>
                        {formatIstDateTime(incident.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </OfficialDashboardLayout>
  );
}
