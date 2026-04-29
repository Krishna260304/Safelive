import { useMemo, useState } from 'react';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAnalyticsDashboard, useTrends } from '@/hooks/use-data';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';

const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6'];

const DAYS_BY_RANGE: Record<string, number> = {
  '7d': 7,
  '14d': 14,
  '30d': 30,
};

export default function Analytics() {
  const [timeRange, setTimeRange] = useState('14d');
  const days = DAYS_BY_RANGE[timeRange] || 14;

  const {
    data: dashboard,
    loading: dashboardLoading,
    error: dashboardError,
  } = useAnalyticsDashboard();
  const { data: trends, loading: trendsLoading, error: trendsError } = useTrends(days);

  const statusComparison = useMemo(() => {
    if (!dashboard) return [];
    return [
      { name: 'Open', count: dashboard.tickets.open, color: '#3b82f6' },
      { name: 'In Progress', count: dashboard.tickets.inProgress, color: '#f59e0b' },
      { name: 'Resolved', count: dashboard.tickets.resolved, color: '#10b981' },
    ];
  }, [dashboard]);

  const trendData = useMemo(
    () =>
      trends.map((item) => ({
        ...item,
        label: item.date.slice(5),
      })),
    [trends]
  );

  const categoryData = dashboard?.byCategory || [];
  const workerData = (dashboard?.workerProductivity || []).slice(0, 8);
  const loading = dashboardLoading || trendsLoading;
  const error = dashboardError || trendsError;

  if (loading) {
    return (
      <OfficialDashboardLayout>
        <div className="flex h-[80vh] items-center justify-center">Loading analytics...</div>
      </OfficialDashboardLayout>
    );
  }

  if (!dashboard || error) {
    return (
      <OfficialDashboardLayout>
        <div className="flex h-[80vh] items-center justify-center text-destructive">
          {error || 'Unable to load analytics.'}
        </div>
      </OfficialDashboardLayout>
    );
  }

  return (
    <OfficialDashboardLayout>
      <div className="space-y-6 animate-fade-in pb-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Analytics Overview</h1>
            <p className="text-muted-foreground">Real-time operational insights from production data.</p>
          </div>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 Days</SelectItem>
              <SelectItem value="14d">Last 14 Days</SelectItem>
              <SelectItem value="30d">Last 30 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Incidents</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{dashboard.incidents.total}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Tickets</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{dashboard.tickets.total}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">Incidents Resolved</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">{dashboard.incidents.resolved}</CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Ticket Status Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusComparison}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" name="Tickets">
                      {statusComparison.map((entry) => (
                        <Cell key={`status-${entry.name}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Created vs Resolved Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="created" stroke="#f59e0b" strokeWidth={2} name="Created" />
                    <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} name="Resolved" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Incidents by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="count"
                      nameKey="category"
                    >
                      {categoryData.map((entry, index) => (
                        <Cell key={`category-${entry.category}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Worker Productivity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workerData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="worker" tick={{ fontSize: 11 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="resolved" fill="#22c55e" name="Resolved" />
                    <Bar dataKey="open" fill="#ef4444" name="Open" />
                    <Bar dataKey="inProgress" fill="#f59e0b" name="In Progress" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </OfficialDashboardLayout>
  );
}
