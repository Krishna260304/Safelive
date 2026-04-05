import { useState, useEffect, useRef } from 'react';
import { incidentService, Incident, IncidentStats, normalizeIncidentMedia } from '@/services/incidents';
import { ticketService, Ticket, TicketStats } from '@/services/tickets';
import { API_CONFIG } from '@/config/api';
import {
  analyticsService,
  AnalyticsDashboard,
  HeatmapPoint,
  TrendPoint,
} from '@/services/analytics';
import { publicService, PublicSummary } from '@/services/public';
import { subscribeIncidentSocket } from '@/services/realtime';
import { authStorage } from '@/services/auth-storage';

const hasAuthToken = () => !!authStorage.getToken();

const getCurrentUser = (): { id?: string; userType?: string; officialRole?: string } | null => {
  try {
    const raw = authStorage.getUser();
    if (!raw) return null;
    return JSON.parse(raw) as { id?: string; userType?: string; officialRole?: string } | null;
  } catch {
    return null;
  }
};

const getCurrentUserRole = (): string =>
  String(getCurrentUser()?.officialRole || '').trim().toLowerCase();

const isLocalVisibleIncident = (incident: Incident, currentUserId: string): boolean =>
  Boolean(incident.commonIncident) ||
  (currentUserId !== '' && String(incident.reporterId || '').trim() === currentUserId);

const isIncidentVisibleToCurrentUser = (incident: Incident): boolean => {
  const currentUser = getCurrentUser();
  const currentUserId = String(currentUser?.id || '').trim();
  const userType = String(currentUser?.userType || '').trim().toLowerCase();
  if (userType === 'citizen' || userType === 'local') {
    return isLocalVisibleIncident(incident, currentUserId);
  }

  const role = getCurrentUserRole();
  if (role !== 'field_inspector') {
    return true;
  }
  return ['verified', 'in_progress', 'resolved'].includes(String(incident.status || '').trim().toLowerCase());
};

export const useIncidents = () => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIncidents = async () => {
    if (!hasAuthToken()) {
      setIncidents([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await incidentService.getIncidents();

    if (response.success && response.data) {
      setIncidents(response.data.filter(isIncidentVisibleToCurrentUser));
    } else {
      setIncidents([]);
      setError(response.error || 'Failed to fetch incidents');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchIncidents();
  }, []);

  useEffect(() => {
    if (!hasAuthToken()) {
      return;
    }

    const subscription = subscribeIncidentSocket({
      onMessage: (payload) => {
        try {
          if (!payload || typeof payload !== 'object') return;
          const eventPayload = payload as { type?: string; data?: Incident };
          if (eventPayload?.type !== 'NEW_INCIDENT' || !eventPayload.data) {
            return;
          }
          const normalizedIncident = normalizeIncidentMedia(eventPayload.data as Incident);
          if (!isIncidentVisibleToCurrentUser(normalizedIncident)) {
            return;
          }
          setIncidents((prev) => {
            const exists = prev.find((i) => i.id === normalizedIncident.id);
            if (exists) {
              return prev.map((i) => (i.id === normalizedIncident.id ? normalizedIncident : i));
            }
            return [normalizedIncident, ...prev];
          });
        } catch {
          return;
        }
      },
    });
    if (!subscription) {
      return;
    }
    return () => {
      subscription.close();
    };
  }, []);

  return { incidents, loading, error, refetch: fetchIncidents };
};

export const useIncidentStats = () => {
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    if (!hasAuthToken()) {
      setStats(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await incidentService.getStats();

    if (response.success && response.data) {
      setStats(response.data);
    } else {
      setError(response.error || 'Failed to fetch stats');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return { stats, loading, error, refetch: fetchStats };
};

export const useTickets = (filters?: { status?: string; priority?: string; category?: string }) => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingInFlightRef = useRef(false);

  const fetchTickets = async (silent = false) => {
    if (!hasAuthToken()) {
      setTickets([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (silent && pollingInFlightRef.current) return;
    if (silent) pollingInFlightRef.current = true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await ticketService.getTickets(filters);
      if (response.success && response.data) {
        setTickets(response.data);
      } else {
        setError(response.error || 'Failed to fetch tickets');
      }
    } finally {
      if (silent) {
        pollingInFlightRef.current = false;
      }
    }
    if (!silent) {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [filters?.status, filters?.priority, filters?.category]);

  useEffect(() => {
    if (!hasAuthToken()) {
      return;
    }
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void fetchTickets(true);
    }, 15000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchTickets(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [filters?.status, filters?.priority, filters?.category]);

  const patchTicket = (id: string, patch: Partial<Ticket>) => {
    setTickets((prev) => prev.map((ticket) => (ticket.id === id ? { ...ticket, ...patch } : ticket)));
  };

  return { tickets, loading, error, refetch: fetchTickets, patchTicket };
};

export const useTicketStats = () => {
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    if (!hasAuthToken()) {
      setStats(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await ticketService.getStats();

    if (response.success && response.data) {
      setStats(response.data);
    } else {
      setError(response.error || 'Failed to fetch stats');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return { stats, loading, error, refetch: fetchStats };
};

export const useAnalyticsDashboard = () => {
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    if (!hasAuthToken()) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await analyticsService.getDashboard();
    if (response.success && response.data) {
      setData(response.data);
    } else {
      setError(response.error || 'Failed to fetch analytics');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  return { data, loading, error, refetch: fetchDashboard };
};

export const useHeatmap = () => {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHeatmap = async () => {
    if (!hasAuthToken()) {
      setPoints([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await analyticsService.getHeatmap();
    if (response.success && response.data) {
      setPoints(response.data);
    } else {
      setError(response.error || 'Failed to fetch heatmap');
      setPoints([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchHeatmap();
  }, []);

  return { points, loading, error, refetch: fetchHeatmap };
};

export const useTrends = (days = 14) => {
  const [data, setData] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTrends = async () => {
    if (!hasAuthToken()) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await analyticsService.getTrends(days);
    if (response.success && response.data) {
      setData(response.data);
    } else {
      setError(response.error || 'Failed to fetch trends');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchTrends();
  }, [days]);

  return { data, loading, error, refetch: fetchTrends };
};

export const usePublicSummary = () => {
  const [data, setData] = useState<PublicSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSummary = async () => {
    setLoading(true);
    setError(null);
    const response = await publicService.getSummary();
    if (response.success && response.data) {
      setData(response.data);
    } else {
      setError(response.error || 'Failed to fetch summary');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSummary();
  }, []);

  return { data, loading, error, refetch: fetchSummary };
};
