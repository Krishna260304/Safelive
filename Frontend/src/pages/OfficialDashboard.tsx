import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  RotateCcw,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useTickets } from '@/hooks/use-data';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/services/auth';
import { Ticket, TicketLogEntry, ticketService } from '@/services/tickets';
import { ManagedOfficialAccount, usersService, WorkerAccount } from '@/services/users';
import { cn } from '@/lib/utils';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

type DashboardRole = 'department' | 'supervisor' | 'field_inspector' | 'worker';

const statusBadge: Record<string, string> = {
  open: 'badge-info',
  pending: 'badge-warning',
  in_progress: 'badge-warning',
  verified: 'badge-warning',
  resolved: 'badge-success',
};

const roleDisplay: Record<DashboardRole, string> = {
  department: 'Department Dashboard',
  supervisor: 'Supervisor Dashboard',
  field_inspector: 'Field Inspector Dashboard',
  worker: 'Worker Dashboard',
};

const roleDescription: Record<DashboardRole, string> = {
  department: 'Resolve/reopen cases and review immutable official logbooks.',
  supervisor: 'Assign registered workers and verify field completion updates.',
  field_inspector: 'Submit daily progress updates before 6:00 PM IST.',
  worker: 'Track assigned tasks and submit on-ground work updates.',
};

const toRole = (value: string | undefined): DashboardRole => {
  const normalized = (value || '').trim().toLowerCase().replace('-', '_');
  if (normalized === 'supervisor') return 'supervisor';
  if (normalized === 'field_inspector') return 'field_inspector';
  if (normalized === 'worker') return 'worker';
  return 'department';
};

const formatDateTime = (value?: string) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatLogbookDate = (value?: string) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatLogbookTime = (value?: string) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const formatActionLabel = (value?: string) => {
  const action = (value || '').trim();
  if (!action) return 'Ticket Activity';
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const toLogLabel = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();

const formatStatus = (value?: string) => {
  if ((value || '').trim().toLowerCase() === 'verified') {
    return 'IN PROGRESS';
  }
  const text = (value || '').replace(/_/g, ' ').trim();
  if (!text) return 'UNKNOWN';
  return text.toUpperCase();
};

const logbookDetailText = (details: Record<string, unknown> | undefined): string => {
  if (!details || Object.keys(details).length === 0) return 'No extra details';
  const isHiddenDetailKey = (key: string) => {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return normalized === 'workerid' || normalized === 'workerids';
  };

  const stringify = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value.map((item) => stringify(item)).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const visibleEntries = Object.entries(details).filter(([key]) => !isHiddenDetailKey(key));
  if (visibleEntries.length === 0) return 'No extra details';

  return visibleEntries
    .map(([key, value]) => `${toLogLabel(key)}: ${stringify(value)}`)
    .join(' | ');
};

const asCleanText = (value: unknown): string => String(value || '').trim();

const formatLogbookDetails = (entry: TicketLogEntry): string => {
  const action = (entry.action || '').trim().toLowerCase();
  const details = entry.details || {};

  if (action === 'reopened_ticket_supervisor_assigned_by_department') {
    const supervisorName = asCleanText(details.supervisorName);
    const supervisorId = asCleanText(details.supervisorId);
    if (supervisorName && supervisorId) {
      return `Department assigned supervisor ${supervisorName} (ID: ${supervisorId})`;
    }
    if (supervisorName) {
      return `Department assigned supervisor ${supervisorName}`;
    }
    if (supervisorId) {
      return `Department assigned supervisor ID ${supervisorId}`;
    }
    return 'Department assigned a supervisor for this reopened ticket';
  }

  const actionText = formatActionLabel(entry.action);
  const detailText = logbookDetailText(details);
  return detailText === 'No extra details' ? actionText : `${actionText} | ${detailText}`;
};

const workerLabel = (name?: string, workerCode?: string) => {
  const cleanName = (name || '').trim();
  const cleanCode = (workerCode || '').trim();
  if (cleanName && cleanCode) return `${cleanName} (#${cleanCode})`;
  if (cleanName) return cleanName;
  if (cleanCode) return `#${cleanCode}`;
  return '';
};

const resolveLogbookLocation = (entry: TicketLogEntry, ticket?: Ticket | null): string => {
  const details = entry.details || {};
  const locationKeys = ['location', 'ticketLocation', 'site', 'zone', 'ward'];
  for (const key of locationKeys) {
    const value = details[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return (ticket?.location || '').trim() || 'N/A';
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toSafeFileToken = (value: string) => {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || 'ticket';
};

const ticketWorkerNames = (ticket: Ticket): string[] => {
  if (Array.isArray(ticket.assignees) && ticket.assignees.length > 0) {
    return ticket.assignees
      .map((row) => workerLabel(row?.name, row?.workerCode))
      .filter((value) => value.length > 0);
  }
  if (ticket.assigneeName || ticket.workerCode) {
    const label = workerLabel(ticket.assigneeName, ticket.workerCode);
    if (label) return [label];
  }
  if (ticket.assignedTo) return [ticket.assignedTo];
  return [];
};

const ticketWorkerIds = (ticket: Ticket): string[] => {
  if (Array.isArray(ticket.assignees) && ticket.assignees.length > 0) {
    const ids = ticket.assignees
      .map((row) => (row?.workerId || '').trim())
      .filter((value) => value.length > 0);
    if (ids.length > 0) return ids;
  }
  if (Array.isArray(ticket.workerIds) && ticket.workerIds.length > 0) {
    return ticket.workerIds.map((value) => String(value || '').trim()).filter((value) => value.length > 0);
  }
  if (ticket.workerId) return [ticket.workerId];
  return [];
};

const displayTicketId = (ticket: Ticket): string => {
  const formatted = (ticket.ticketId || '').trim();
  if (formatted) return formatted;
  return ticket.id;
};

const OfficialDashboard = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const user = authService.getCurrentUser();
  const role = toRole(user?.officialRole);
  const isTicketsPage = pathname.startsWith('/official/tickets');
  const isReadOnlyDashboard = pathname.startsWith('/official/dashboard');

  const {
    tickets,
    loading: ticketsLoading,
    error: ticketsError,
    refetch: refetchTickets,
    patchTicket,
  } = useTickets();
  const [query, setQuery] = useState('');

  const [workers, setWorkers] = useState<WorkerAccount[]>([]);
  const [loadingWorkers, setLoadingWorkers] = useState(false);
  const [selectedWorkerByTicket, setSelectedWorkerByTicket] = useState<Record<string, string[]>>({});
  const [supervisors, setSupervisors] = useState<ManagedOfficialAccount[]>([]);
  const [loadingSupervisors, setLoadingSupervisors] = useState(false);
  const [selectedSupervisorByTicket, setSelectedSupervisorByTicket] = useState<Record<string, string>>({});

  const [statusSubmittingId, setStatusSubmittingId] = useState<string | null>(null);
  const [assigningTicketId, setAssigningTicketId] = useState<string | null>(null);
  const [assigningSupervisorTicketId, setAssigningSupervisorTicketId] = useState<string | null>(null);
  const [progressSubmittingId, setProgressSubmittingId] = useState<string | null>(null);
  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});

  const [logbookDialogOpen, setLogbookDialogOpen] = useState(false);
  const [logbookLoading, setLogbookLoading] = useState(false);
  const [logbookTicket, setLogbookTicket] = useState<Ticket | null>(null);
  const [logbookEntries, setLogbookEntries] = useState<TicketLogEntry[]>([]);
  const [logbookDownloadMenuOpen, setLogbookDownloadMenuOpen] = useState(false);
  const [ticketDetailsDialogOpen, setTicketDetailsDialogOpen] = useState(false);
  const [ticketDetailsLoading, setTicketDetailsLoading] = useState(false);
  const [ticketDetails, setTicketDetails] = useState<Ticket | null>(null);

  useEffect(() => {
    if (!isTicketsPage || (role !== 'supervisor' && role !== 'department')) {
      setWorkers([]);
      return;
    }
    const loadWorkers = async () => {
      setLoadingWorkers(true);
      const response = await usersService.listWorkers();
      if (response.success && response.data) {
        setWorkers(response.data);
      } else {
        setWorkers([]);
        toast({
          title: 'Worker List Unavailable',
          description: response.error || 'Unable to load registered worker accounts.',
          variant: 'destructive',
        });
      }
      setLoadingWorkers(false);
    };
    void loadWorkers();
  }, [role, isTicketsPage, toast]);

  useEffect(() => {
    if (!isTicketsPage || role !== 'department') {
      setSupervisors([]);
      return;
    }
    const loadSupervisors = async () => {
      setLoadingSupervisors(true);
      const response = await usersService.listManagedOfficials();
      if (response.success && response.data) {
        const next = response.data.filter((entry) => (entry.officialRole || '').trim().toLowerCase() === 'supervisor');
        setSupervisors(next);
      } else {
        setSupervisors([]);
        toast({
          title: 'Supervisor List Unavailable',
          description: response.error || 'Unable to load supervisor accounts.',
          variant: 'destructive',
        });
      }
      setLoadingSupervisors(false);
    };
    void loadSupervisors();
  }, [role, isTicketsPage, toast]);

  const filteredTickets = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((ticket) =>
      [
        displayTicketId(ticket),
        ticket.ticketId,
        ticket.id,
        ticket.title,
        ticket.description,
        ticket.category,
        ticket.location,
        ticket.status,
        ticket.assignedTo,
        ticket.assigneeName,
        ticket.assigneePhone,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [tickets, query]);

  const stats = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter((ticket) => ticket.status === 'open' || ticket.status === 'pending').length;
    const inProgress = tickets.filter((ticket) => ticket.status === 'in_progress' || ticket.status === 'verified').length;
    const resolved = tickets.filter((ticket) => ticket.status === 'resolved').length;
    return { total, open, inProgress, resolved };
  }, [tickets]);

  const logbookRows = useMemo(() => {
    return logbookEntries.map((entry) => {
      const details = formatLogbookDetails(entry);
      const actorName = (entry.actorName || 'System').trim();
      const roleName = (entry.actorOfficialRole || '').trim();
      const actor = roleName ? `${actorName} (${roleName})` : actorName;
      return {
        id: entry.id,
        location: resolveLogbookLocation(entry, logbookTicket),
        details,
        actor,
        date: formatLogbookDate(entry.createdAt),
        time: formatLogbookTime(entry.createdAt),
      };
    });
  }, [logbookEntries, logbookTicket]);

  const downloadBlob = useCallback((filename: string, mime: string, content: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  const handleDownloadLogbookExcel = useCallback(() => {
    if (!logbookRows.length) {
      toast({
        title: 'No Log Entries',
        description: 'Logbook is empty. Nothing to export.',
        variant: 'destructive',
      });
      return;
    }

    const ticketLabel = logbookTicket ? displayTicketId(logbookTicket) : 'ticket';
    const safeTicketLabel = toSafeFileToken(ticketLabel);
    
    // Prepare data for Excel
    const worksheetData: (string | null)[][] = [
      ['Location', 'Details', 'Actor', 'Date', 'Time'],
      ...logbookRows.map((row) => [row.location, row.details, row.actor, row.date, row.time]),
    ];

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Set column widths
    worksheet['!cols'] = [
      { wch: 20 },
      { wch: 40 },
      { wch: 25 },
      { wch: 15 },
      { wch: 10 },
    ];

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Logbook');

    // Write file
    XLSX.writeFile(workbook, `ticket-logbook-${safeTicketLabel}.xlsx`);
  }, [logbookRows, logbookTicket, toast]);

  const handleDownloadLogbookPdf = useCallback(() => {
    if (!logbookRows.length) {
      toast({
        title: 'No Log Entries',
        description: 'Logbook is empty. Nothing to export.',
        variant: 'destructive',
      });
      return;
    }

    const ticketLabel = logbookTicket ? displayTicketId(logbookTicket) : 'ticket';
    const safeTicketLabel = toSafeFileToken(ticketLabel);
    const printableRows = logbookRows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.location)}</td><td>${escapeHtml(
            row.details
          )}<br/><span style="font-size:11px;color:#4b5563">${escapeHtml(
            row.actor
          )}</span></td><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.time)}</td></tr>`
      )
      .join('');

    const printableHtml = [
      '<!doctype html><html><head><meta charset="utf-8" />',
      `<title>Logbook ${escapeHtml(ticketLabel)}</title>`,
      '<style>',
      'body{font-family:Segoe UI,Arial,sans-serif;padding:16px;color:#111827;}',
      'h1{font-size:16px;margin:0 0 8px;}',
      'p{margin:0 0 12px;color:#4b5563;font-size:12px;}',
      'table{width:100%;border-collapse:collapse;font-size:12px;}',
      'thead th{background:#f3f4f6;color:#111827;border:1px solid #d1d5db;padding:8px;text-align:left;}',
      'tbody td{border:1px solid #e5e7eb;padding:8px;vertical-align:top;}',
      'tbody tr:nth-child(odd){background:#fafafa;}',
      '</style></head><body>',
      `<h1>Ticket Logbook - ${escapeHtml(ticketLabel)}</h1>`,
      `<p>Generated on ${escapeHtml(formatDateTime(new Date().toISOString()))}</p>`,
      `<table><thead><tr><th>Location</th><th>Details</th><th>Date</th><th>Time</th></tr></thead><tbody>${printableRows}</tbody></table>`,
      '</body></html>',
    ].join('');

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.setAttribute('title', `logbook-print-${safeTicketLabel}`);
    document.body.appendChild(iframe);
    iframe.srcdoc = printableHtml;
    iframe.onload = () => {
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        iframe.remove();
        return;
      }
      printWindow.focus();
      printWindow.print();
      setTimeout(() => iframe.remove(), 1500);
    };
  }, [logbookRows, logbookTicket, toast]);

  const handleStatusChange = async (ticketId: string, status: 'resolved' | 'open' | 'verified') => {
    const previousTicket = tickets.find((ticket) => ticket.id === ticketId);
    const previousStatus = previousTicket?.status;

    patchTicket(ticketId, { status, updatedAt: new Date().toISOString() });

    setStatusSubmittingId(ticketId);
    try {
      const response = await ticketService.updateStatus(ticketId, { status });
      if (!response.success) {
        if (previousStatus) {
          patchTicket(ticketId, { status: previousStatus });
        }
        toast({
          title: 'Action Failed',
          description: response.error || 'Could not update status.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Status Updated',
        description: status === 'open' ? 'Case reopened.' : status === 'verified' ? 'Case verified.' : 'Case resolved.',
      });
      void refetchTickets(true);
    } finally {
      setStatusSubmittingId(null);
    }
  };

  const handleAssignWorker = async (ticket: Ticket) => {
    const hasLocalSelection = Object.prototype.hasOwnProperty.call(selectedWorkerByTicket, ticket.id);
    const selectedWorkerIds = hasLocalSelection ? selectedWorkerByTicket[ticket.id] || [] : ticketWorkerIds(ticket);
    const workerIds = selectedWorkerIds.map((value) => value.trim()).filter(Boolean);
    if (workerIds.length === 0) {
      toast({
        title: 'Worker Required',
        description: 'Select a registered worker from the dropdown.',
        variant: 'destructive',
      });
      return;
    }

    const previousTicket = tickets.find((row) => row.id === ticket.id);
    const optimisticAssignedAt = new Date().toISOString();
    const optimisticAssignees = workerIds.map((workerId) => {
      const matchedWorker = workers.find((worker) => worker.id === workerId);
      return {
        workerId,
        workerCode: matchedWorker?.workerCode,
        name: matchedWorker?.name || workerId,
        phone: matchedWorker?.phone,
        email: matchedWorker?.email,
        workerSpecialization: matchedWorker?.workerSpecialization,
        assignedAt: optimisticAssignedAt,
      };
    });
    patchTicket(ticket.id, {
      workerIds,
      workerId: workerIds[0],
      assignees: optimisticAssignees,
      assignedTo: optimisticAssignees.map((row) => row.name).join(', '),
      assigneeName: optimisticAssignees[0]?.name,
      assigneePhone: optimisticAssignees[0]?.phone,
      assigneeEmail: optimisticAssignees[0]?.email,
      updatedAt: optimisticAssignedAt,
    });

    setAssigningTicketId(ticket.id);
    try {
      const response = await ticketService.assignTicket(ticket.id, { workerIds });
      if (!response.success) {
        if (previousTicket) {
          patchTicket(ticket.id, {
            workerIds: previousTicket.workerIds,
            workerId: previousTicket.workerId,
            assignees: previousTicket.assignees,
            assignedTo: previousTicket.assignedTo,
            assigneeName: previousTicket.assigneeName,
            assigneePhone: previousTicket.assigneePhone,
            assigneeEmail: previousTicket.assigneeEmail,
            updatedAt: previousTicket.updatedAt,
          });
        }
        toast({
          title: 'Assignment Failed',
          description: response.error || 'Could not assign worker.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Workers Assigned',
        description: 'Supervisor assignment saved.',
      });
      void refetchTickets(true);
    } finally {
      setAssigningTicketId(null);
    }
  };

  const handleAssignReopenedSupervisor = async (ticket: Ticket) => {
    const supervisorId = (selectedSupervisorByTicket[ticket.id] || '').trim();
    if (!supervisorId) {
      toast({
        title: 'Supervisor Required',
        description: 'Select a supervisor to continue this reopened ticket.',
        variant: 'destructive',
      });
      return;
    }

    const selectedSupervisor = supervisors.find((entry) => entry.id === supervisorId);
    patchTicket(ticket.id, {
      reopenedSupervisorId: supervisorId,
      reopenedSupervisorName: selectedSupervisor?.name || supervisorId,
      reopenedSupervisorEmail: selectedSupervisor?.email,
      reopenedSupervisorAssignedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    setAssigningSupervisorTicketId(ticket.id);
    try {
      const response = await ticketService.assignSupervisor(ticket.id, { supervisorId });
      if (!response.success) {
        patchTicket(ticket.id, {
          reopenedSupervisorId: ticket.reopenedSupervisorId,
          reopenedSupervisorName: ticket.reopenedSupervisorName,
          reopenedSupervisorEmail: ticket.reopenedSupervisorEmail,
          reopenedSupervisorAssignedAt: ticket.reopenedSupervisorAssignedAt,
          updatedAt: ticket.updatedAt,
        });
        toast({
          title: 'Supervisor Assignment Failed',
          description: response.error || 'Could not assign supervisor for this reopened ticket.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Supervisor Assigned',
        description: 'Reopened ticket has been assigned to supervisor.',
      });
      setSelectedSupervisorByTicket((prev) => {
        const { [ticket.id]: _, ...rest } = prev;
        return rest;
      });
      void refetchTickets(true);
    } finally {
      setAssigningSupervisorTicketId(null);
    }
  };

  const handleProgressUpdate = async (ticketId: string) => {
    const updateText = (progressDrafts[ticketId] || '').trim();
    if (updateText.length < 5) {
      toast({
        title: 'Update Required',
        description: 'Enter at least 5 characters for progress update.',
        variant: 'destructive',
      });
      return;
    }

    setProgressSubmittingId(ticketId);
    try {
      const response = await ticketService.updateProgress(ticketId, { updateText });
      if (!response.success) {
        toast({
          title: 'Update Failed',
          description: response.error || 'Could not submit progress update.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Progress Updated',
        description: 'Daily progress update saved successfully.',
      });
      setProgressDrafts((prev) => ({ ...prev, [ticketId]: '' }));
      await refetchTickets();
    } finally {
      setProgressSubmittingId(null);
    }
  };

  const openLogbook = async (ticket: Ticket) => {
    setLogbookDialogOpen(true);
    setLogbookLoading(true);
    setLogbookTicket(ticket);
    setLogbookEntries([]);
    const response = await ticketService.getLogbook(ticket.id);
    if (response.success && response.data) {
      setLogbookEntries(response.data);
    } else {
      toast({
        title: 'Logbook Unavailable',
        description: response.error || 'Could not load LogBook.',
        variant: 'destructive',
      });
    }
    setLogbookLoading(false);
  };

  const openTicketDetails = useCallback(async (ticket: Ticket) => {
    setTicketDetailsDialogOpen(true);
    setTicketDetailsLoading(true);
    setTicketDetails(ticket);
    const response = await ticketService.getTicketById(ticket.id);
    if (response.success && response.data) {
      setTicketDetails(response.data);
    } else {
      toast({
        title: 'Ticket Details Unavailable',
        description: response.error || 'Could not load ticket details.',
        variant: 'destructive',
      });
    }
    setTicketDetailsLoading(false);
  }, [toast]);

  const handleTicketIdClick = useCallback(async (ticket: Ticket) => {
    if (!isTicketsPage) {
      const nextQuery = new URLSearchParams();
      nextQuery.set('ticket', ticket.id);
      navigate(`/official/tickets?${nextQuery.toString()}`);
      return;
    }
    await openTicketDetails(ticket);
  }, [isTicketsPage, navigate, openTicketDetails]);

  useEffect(() => {
    if (!isTicketsPage) return;
    const requestedTicket = (searchParams.get('ticket') || '').trim();
    if (!requestedTicket) return;

    const matched = tickets.find(
      (ticket) => ticket.id === requestedTicket || (ticket.ticketId || '').trim() === requestedTicket
    );
    if (!matched) return;

    void openTicketDetails(matched);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('ticket');
    setSearchParams(nextParams, { replace: true });
  }, [isTicketsPage, openTicketDetails, searchParams, setSearchParams, tickets]);

  return (
    <>
      <OfficialDashboardLayout>
        <div className="space-y-6 animate-fade-in">
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-heading font-bold text-foreground">{roleDisplay[role]}</h1>
            <p className="text-muted-foreground">{roleDescription[role]}</p>
          </div>

          {ticketsError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {ticketsError}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-2xl font-semibold">{stats.total}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Open</div>
              <div className="text-2xl font-semibold text-info">{stats.open}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">In Progress</div>
              <div className="text-2xl font-semibold text-warning">{stats.inProgress}</div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Resolved</div>
              <div className="text-2xl font-semibold text-success">{stats.resolved}</div>
            </div>
          </div>

          <div className="relative">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tickets by title, category, status, location"
              className="pl-9"
            />
          </div>

          <div className="space-y-3">
            {ticketsLoading && <div className="text-sm text-muted-foreground">Loading tickets...</div>}
            {!ticketsLoading && filteredTickets.length === 0 && (
              <div className="text-sm text-muted-foreground">
                {role === 'field_inspector'
                  ? 'The field inspector ticket window will be available once the ticket is verified.'
                  : 'No tickets available for this role.'}
              </div>
            )}

            {filteredTickets.map((ticket) => {
              const progressDraft = progressDrafts[ticket.id] || '';
              const progressPercent = Number(ticket.progressPercent || 0);
              const assignedWorkerNames = ticketWorkerNames(ticket);
              const hasAssignedWorker = assignedWorkerNames.length > 0;
              const preselectedWorkerIds = hasAssignedWorker ? ticketWorkerIds(ticket) : [];
              const hasLocalSelection = Object.prototype.hasOwnProperty.call(selectedWorkerByTicket, ticket.id);
              const selectedWorkerIds = hasLocalSelection
                ? selectedWorkerByTicket[ticket.id] || []
                : preselectedWorkerIds;
              const selectedWorkerCount = hasLocalSelection ? selectedWorkerIds.length : assignedWorkerNames.length;
              const isReopenedCase = Boolean(
                ticket.reopenedBy?.timestamp ||
                  ticket.reopenedBy?.id ||
                  ticket.reopenedBy?.name ||
                  ticket.reopenWarning
              );
              const reopenedSupervisorId = (ticket.reopenedSupervisorId || '').trim();
              const reopenedSupervisorName = (ticket.reopenedSupervisorName || '').trim();
              const hasReopenedSupervisor = reopenedSupervisorId.length > 0;
              const currentUserId = (user?.id || '').trim();
              const supervisorAssignedToCurrentUser = !isReopenedCase || !reopenedSupervisorId || reopenedSupervisorId === currentUserId;
              const isReopenedAwaitingSupervisorAssignment = role === 'department' && isReopenedCase && !hasReopenedSupervisor;
              const isResolved = ticket.status === 'resolved';
              const isVerified = ticket.status === 'verified';
              const canVerifyStep = !isResolved && !isVerified;
              const canAssignWorkersStep = !isResolved && isVerified && !hasAssignedWorker;
              const canResolveStep = !isResolved && isVerified && hasAssignedWorker;
              const canReopen = role === 'department' && ticket.status === 'resolved';
              const canRoleRunWorkflow =
                (role === 'department' || role === 'supervisor') &&
                supervisorAssignedToCurrentUser &&
                !isReopenedAwaitingSupervisorAssignment;
              const canVerify = canRoleRunWorkflow && canVerifyStep;
              const canAssignWorkers = canRoleRunWorkflow && canAssignWorkersStep;
              const canResolve = canRoleRunWorkflow && canResolveStep;
              const fieldInspectorWindowAvailable =
                role !== 'field_inspector' || ticket.status === 'verified';
              const showProgressEditor =
                isTicketsPage && role === 'field_inspector' && fieldInspectorWindowAvailable;
              const showOfficialActions = isTicketsPage && (role === 'department' || role === 'supervisor');
              const showLogbookAction =
                isTicketsPage &&
                (role === 'department' ||
                  role === 'supervisor' ||
                  role === 'worker' ||
                  role === 'field_inspector');
              const showAssignmentSection = isTicketsPage && canAssignWorkers;
              const workerAssignmentHint = workers.length === 0 ? 'No workers available for assignment right now.' : '';

              return (
                <div key={ticket.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
                  {!!ticket.reopenWarning && role !== 'department' && (
                    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                      <div className="font-medium">
                        {(ticket.reopenWarning.departmentName || ticket.reopenWarning.supervisorName || 'Department')}{' '}
                        reopened this case
                      </div>
                      <div>{ticket.reopenWarning.message}</div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{ticket.title}</span>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-xs font-medium',
                            statusBadge[ticket.status] || 'badge-info'
                          )}
                        >
                          {formatStatus(ticket.status)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {ticket.category} | {(ticket.priority || 'medium').toUpperCase()} priority
                      </div>
                      <div className="text-xs text-muted-foreground">{ticket.location || 'N/A'}</div>
                      <div className="text-xs text-muted-foreground">
                        Assigned Workers:{' '}
                        {assignedWorkerNames.length > 0 ? assignedWorkerNames.join(', ') : 'Unassigned'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Progress: {progressPercent}% | Updated: {formatDateTime(ticket.progressUpdatedAt)}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Ticket ID:{' '}
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline"
                        onClick={() => void handleTicketIdClick(ticket)}
                      >
                        {displayTicketId(ticket)}
                      </button>
                    </div>
                  </div>

                  {(showOfficialActions || showLogbookAction) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {showLogbookAction && (
                        <Button
                          variant="outline"
                          onClick={() => openLogbook(ticket)}
                          disabled={statusSubmittingId === ticket.id}
                        >
                          <ClipboardList className="h-4 w-4 mr-1" />
                          LogBook
                        </Button>
                      )}
                      {showOfficialActions && (
                        <>
                          {(canVerify || canResolve) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" disabled={statusSubmittingId === ticket.id}>
                                  Actions
                                  <ChevronDown className="h-4 w-4 ml-1 opacity-60" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                {canVerify && (
                                  <DropdownMenuItem onClick={() => void handleStatusChange(ticket.id, 'verified')}>
                                    <UserCheck className="h-4 w-4 mr-2" />
                                    Verify
                                  </DropdownMenuItem>
                                )}
                                {canResolve && (
                                  <DropdownMenuItem onClick={() => void handleStatusChange(ticket.id, 'resolved')}>
                                    <CheckCircle2 className="h-4 w-4 mr-2" />
                                    Resolve
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          {canReopen && (
                            <Button
                              variant="outline"
                              onClick={() => void handleStatusChange(ticket.id, 'open')}
                              disabled={statusSubmittingId === ticket.id}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Reopen
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {role === 'department' && isReopenedAwaitingSupervisorAssignment && (
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Assign Supervisor (Reopened Case)</label>
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={selectedSupervisorByTicket[ticket.id] || ''}
                          onChange={(event) =>
                            setSelectedSupervisorByTicket((prev) => ({ ...prev, [ticket.id]: event.target.value }))
                          }
                          disabled={loadingSupervisors || assigningSupervisorTicketId === ticket.id}
                        >
                          <option value="">Select supervisor</option>
                          {supervisors.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 md:justify-end">
                        <Button
                          variant="outline"
                          onClick={() => void handleAssignReopenedSupervisor(ticket)}
                          disabled={loadingSupervisors || assigningSupervisorTicketId === ticket.id}
                        >
                          <UserCheck className="h-4 w-4 mr-1" />
                          Assign Supervisor
                        </Button>
                      </div>
                      {(ticket.reopenWarning?.supervisorName || ticket.reopenedFromResolverName) && (
                        <div className="md:col-span-2 text-xs text-warning">
                          Previous resolving supervisor:{' '}
                          {ticket.reopenWarning?.supervisorName || ticket.reopenedFromResolverName}
                        </div>
                      )}
                    </div>
                  )}

                  {showAssignmentSection && (
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Assign Workers</label>
                        <select
                          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={selectedWorkerIds[0] || ''}
                          onChange={(event) => {
                            const workerId = (event.target.value || '').trim();
                            setSelectedWorkerByTicket((prev) => ({
                              ...prev,
                              [ticket.id]: workerId ? [workerId] : [],
                            }));
                          }}
                          disabled={!canRoleRunWorkflow || loadingWorkers || assigningTicketId === ticket.id}
                        >
                          <option value="">{loadingWorkers ? 'Loading workers...' : 'Select worker'}</option>
                          {workers.map((worker) => (
                            <option key={worker.id} value={worker.id}>
                              {worker.name}
                              {worker.workerCode ? ` (#${worker.workerCode})` : ''}
                              {worker.workerSpecialization ? ` - ${worker.workerSpecialization}` : ''}
                            </option>
                          ))}
                        </select>
                        {selectedWorkerCount > 0 && (
                          <div className="text-[11px] text-muted-foreground">{selectedWorkerCount} worker selected</div>
                        )}
                        {workerAssignmentHint && (
                          <div className="text-[11px] text-muted-foreground">{workerAssignmentHint}</div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 md:justify-end md:pt-6">
                        <Button
                          className="h-10"
                          variant="outline"
                          onClick={() => void handleAssignWorker(ticket)}
                          disabled={!canAssignWorkers || loadingWorkers || assigningTicketId === ticket.id}
                        >
                          <Users className="h-4 w-4 mr-1" />
                          Assign Workers
                        </Button>
                      </div>
                    </div>
                  )}

                  {role === 'supervisor' && isReopenedCase && !supervisorAssignedToCurrentUser && (
                    <div className="text-xs text-muted-foreground">
                      Department must assign this reopened case to a supervisor before workflow can continue.
                    </div>
                  )}

                  {role === 'field_inspector' && !fieldInspectorWindowAvailable && (
                    <div className="text-xs text-muted-foreground">
                      The field inspector ticket window will be available once the ticket is verified.
                    </div>
                  )}

                  {showProgressEditor && (
                    <div className="space-y-2">
                      {role === 'field_inspector' && (
                        <div className="text-xs text-muted-foreground">
                          Daily update deadline: 6:00 PM IST | Last inspector update:{' '}
                          {formatDateTime(ticket.lastInspectorUpdateAt)}
                        </div>
                      )}
                      <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                        <Input
                          value={progressDraft}
                          onChange={(event) =>
                            setProgressDrafts((prev) => ({ ...prev, [ticket.id]: event.target.value }))
                          }
                          placeholder="Enter today field inspection update..."
                        />
                        <Button
                          onClick={() => void handleProgressUpdate(ticket.id)}
                          disabled={progressSubmittingId === ticket.id}
                        >
                          <AlertCircle className="h-4 w-4 mr-1" />
                          Submit Update
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </OfficialDashboardLayout>

      <Dialog open={logbookDialogOpen} onOpenChange={setLogbookDialogOpen}>
        <DialogContent className="sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Ticket LogBook</DialogTitle>
            <DialogDescription>
              Official activity LogBook for {logbookTicket?.title || 'ticket'}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-2 relative">
            <div className="text-xs text-muted-foreground">
              Total updates: {logbookRows.length}
            </div>
            <div className="relative">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={logbookLoading || logbookRows.length === 0}
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

          <div className="rounded-md border border-[#2f6f98]/25 overflow-hidden bg-[#2f6f98]/8">
            <div className="bg-[#2f6f98] px-3 py-2 text-center text-xs font-semibold tracking-wide text-white uppercase">
              Status
            </div>
            <div className="max-h-[420px] overflow-auto bg-[#2f6f98]/8">
              <table className="w-full border-collapse text-sm bg-[#2f6f98]/8">
                <thead className="sticky top-0 z-10 bg-[#2f6f98]/18">
                  <tr className="text-[#1f4f6e]">
                    <th className="border border-[#2f6f98]/25 px-3 py-2 text-left text-xs font-semibold">Location</th>
                    <th className="border border-[#2f6f98]/25 px-3 py-2 text-left text-xs font-semibold">Details</th>
                    <th className="border border-[#2f6f98]/25 px-3 py-2 text-left text-xs font-semibold">Date</th>
                    <th className="border border-[#2f6f98]/25 px-3 py-2 text-left text-xs font-semibold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {logbookLoading && (
                    <tr>
                      <td colSpan={4} className="border border-[#2f6f98]/25 px-3 py-6 text-center text-sm text-[#2f6f98]/80">
                        Loading logbook...
                      </td>
                    </tr>
                  )}
                  {!logbookLoading && logbookRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="border border-[#2f6f98]/25 px-3 py-6 text-center text-sm text-[#2f6f98]/80">
                        No log entries found.
                      </td>
                    </tr>
                  )}
                  {!logbookLoading && logbookRows.map((row, index) => (
                    <tr key={row.id} className={index % 2 === 0 ? 'bg-[#2f6f98]/10' : 'bg-[#2f6f98]/5'}>
                      <td className="border border-[#2f6f98]/25 px-3 py-2 align-top">{row.location}</td>
                      <td className="border border-[#2f6f98]/25 px-3 py-2 align-top">
                        <div className="text-foreground">{row.details}</div>
                        <div className="mt-1 text-[11px] text-[#2f6f98]/80">{row.actor}</div>
                      </td>
                      <td className="border border-[#2f6f98]/25 px-3 py-2 align-top">{row.date}</td>
                      <td className="border border-[#2f6f98]/25 px-3 py-2 align-top">{row.time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={ticketDetailsDialogOpen} onOpenChange={setTicketDetailsDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Ticket Details</DialogTitle>
            <DialogDescription>
              Full details for ticket {ticketDetails ? displayTicketId(ticketDetails) : 'N/A'}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto space-y-3 pr-1">
            {ticketDetailsLoading && <div className="text-sm text-muted-foreground">Loading ticket details...</div>}
            {!ticketDetailsLoading && !ticketDetails && (
              <div className="text-sm text-muted-foreground">Ticket details unavailable.</div>
            )}
            {!ticketDetailsLoading && ticketDetails && (
              <>
                <div className="rounded-md border border-border p-3 space-y-1">
                  <div className="text-sm font-medium text-foreground">{ticketDetails.title}</div>
                  <div className="text-xs text-muted-foreground">
                    ID: {displayTicketId(ticketDetails)} | Status: {formatStatus(ticketDetails.status)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Category: {ticketDetails.category} | Priority: {(ticketDetails.priority || 'medium').toUpperCase()}
                  </div>
                  <div className="text-xs text-muted-foreground">Location: {ticketDetails.location || 'N/A'}</div>
                  <div className="text-xs text-muted-foreground">
                    Assigned: {ticketWorkerNames(ticketDetails).join(', ') || 'Unassigned'} | Progress:{' '}
                    {Number(ticketDetails.progressPercent || 0)}%
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Created: {formatDateTime(ticketDetails.createdAt)} | Updated: {formatDateTime(ticketDetails.updatedAt)}
                  </div>
                </div>

                <div className="rounded-md border border-border p-3">
                  <div className="text-sm font-medium text-foreground mb-1">Description</div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {ticketDetails.description || 'No description provided.'}
                  </div>
                </div>

                <div className="rounded-md border border-border p-3">
                  <div className="text-sm font-medium text-foreground mb-2">Images</div>
                  {ticketDetails.imageUrls && ticketDetails.imageUrls.length > 0 ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ticketDetails.imageUrls.map((url, index) => (
                        <a key={`${url}-${index}`} href={url} target="_blank" rel="noreferrer">
                          <img
                            src={url}
                            alt={`Ticket image ${index + 1}`}
                            className="h-44 w-full rounded-md border border-border object-cover"
                            loading="lazy"
                          />
                        </a>
                      ))}
                    </div>
                  ) : ticketDetails.imageUrl ? (
                    <a href={ticketDetails.imageUrl} target="_blank" rel="noreferrer">
                      <img
                        src={ticketDetails.imageUrl}
                        alt="Ticket image"
                        className="h-56 w-full rounded-md border border-border object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <div className="text-sm text-muted-foreground">No images available for this ticket.</div>
                  )}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default OfficialDashboard;
