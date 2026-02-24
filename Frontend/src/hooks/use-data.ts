import { useState, useEffect } from 'react';
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

const hasAuthToken = () => !!localStorage.getItem('auth_token');

const createIncidentsSocket = () => {
  if (!API_CONFIG.WS_BASE_URL) {
    return null;
  }
  return new WebSocket(`${API_CONFIG.WS_BASE_URL}/ws/incidents`);
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
      setIncidents(response.data);
    } else {
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

    const socket = createIncidentsSocket();
    if (!socket) {
      return;
    }

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'NEW_INCIDENT' && payload.data) {
          const normalizedIncident = normalizeIncidentMedia(payload.data as Incident);
          setIncidents((prev) => {
            const exists = prev.find((i) => i.id === normalizedIncident.id);
            if (exists) {
              return prev.map((i) => (i.id === normalizedIncident.id ? normalizedIncident : i));
            }
            return [normalizedIncident, ...prev];
          });
        }
      } catch {
        return;
      }
    };
    return () => {
      socket.close();
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

  const fetchTickets = async (silent = false) => {
    if (!hasAuthToken()) {
      setTickets([]);
      setLoading(false);
      setError(null);
      return;
    }
    if (!silent) {
      setLoading(true);
    }
    setError(null);
    const response = await ticketService.getTickets(filters);

    if (response.success && response.data) {
      setTickets(response.data);
    } else {
      setError(response.error || 'Failed to fetch tickets');
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
      void fetchTickets(true);
    }, 15000);
    return () => {
      window.clearInterval(intervalId);
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
