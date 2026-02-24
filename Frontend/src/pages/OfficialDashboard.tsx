import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  RotateCcw,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';
import { OfficialDashboardLayout } from '@/components/layout/OfficialDashboardLayout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useTickets } from '@/hooks/use-data';
import { useToast } from '@/hooks/use-toast';
import { authService } from '@/services/auth';
import { Ticket, TicketLogEntry, ticketService } from '@/services/tickets';
import { usersService, WorkerAccount } from '@/services/users';
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
  return Object.entries(details)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(' | ');
};

const ticketWorkerNames = (ticket: Ticket): string[] => {
  if (Array.isArray(ticket.assignees) && ticket.assignees.length > 0) {
    return ticket.assignees
      .map((row) => (row?.name || '').trim())
      .filter((value) => value.length > 0);
  }
  if (ticket.assigneeName) return [ticket.assigneeName];
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

  const [statusSubmittingId, setStatusSubmittingId] = useState<string | null>(null);
  const [assigningTicketId, setAssigningTicketId] = useState<string | null>(null);
  const [progressSubmittingId, setProgressSubmittingId] = useState<string | null>(null);
  const [progressDrafts, setProgressDrafts] = useState<Record<string, string>>({});
  const [reopenReassignmentDoneByTicket, setReopenReassignmentDoneByTicket] = useState<Record<string, boolean>>({});
  const [pendingWorkerAssignmentByTicket, setPendingWorkerAssignmentByTicket] = useState<Record<string, string[]>>({});

  const [logbookDialogOpen, setLogbookDialogOpen] = useState(false);
  const [logbookLoading, setLogbookLoading] = useState(false);
  const [logbookTicket, setLogbookTicket] = useState<Ticket | null>(null);
  const [logbookEntries, setLogbookEntries] = useState<TicketLogEntry[]>([]);
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
    setPendingWorkerAssignmentByTicket((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const ticketId of Object.keys(prev)) {
        const ticket = tickets.find((row) => row.id === ticketId);
        if (!ticket) continue;
        if (ticketWorkerIds(ticket).length > 0) {
          delete next[ticketId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return tickets;
    return tickets.filter((ticket) =>
      [
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

  const handleStatusChange = async (ticketId: string, status: 'resolved' | 'open' | 'verified') => {
    const previousTicket = tickets.find((ticket) => ticket.id === ticketId);
    const previousStatus = previousTicket?.status;
    const previousReopenFlag = reopenReassignmentDoneByTicket[ticketId];
    const previousPendingWorkerAssignment = pendingWorkerAssignmentByTicket[ticketId];

    patchTicket(ticketId, { status, updatedAt: new Date().toISOString() });
    if (status === 'open') {
      setReopenReassignmentDoneByTicket((prev) => ({ ...prev, [ticketId]: false }));
      setPendingWorkerAssignmentByTicket((prev) => {
        const { [ticketId]: _, ...rest } = prev;
        return rest;
      });
    }

    setStatusSubmittingId(ticketId);
    try {
      const response = await ticketService.updateStatus(ticketId, { status });
      if (!response.success) {
        if (previousStatus) {
          patchTicket(ticketId, { status: previousStatus });
        }
        setReopenReassignmentDoneByTicket((prev) => {
          if (previousReopenFlag === undefined) {
            const { [ticketId]: _, ...rest } = prev;
            return rest;
          }
          return { ...prev, [ticketId]: previousReopenFlag };
        });
        if (status === 'open') {
          setPendingWorkerAssignmentByTicket((prev) => {
            if (!previousPendingWorkerAssignment) return prev;
            return { ...prev, [ticketId]: previousPendingWorkerAssignment };
          });
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
        description: 'Select one or more registered workers from the dropdown.',
        variant: 'destructive',
      });
      return;
    }

    const previousTicket = tickets.find((row) => row.id === ticket.id);
    const previousReopenFlag = reopenReassignmentDoneByTicket[ticket.id];
    const optimisticAssignedAt = new Date().toISOString();
    const optimisticAssignees = workerIds.map((workerId) => {
      const matchedWorker = workers.find((worker) => worker.id === workerId);
      return {
        workerId,
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
    setPendingWorkerAssignmentByTicket((prev) => ({ ...prev, [ticket.id]: workerIds }));
    setReopenReassignmentDoneByTicket((prev) => ({ ...prev, [ticket.id]: true }));

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
        setReopenReassignmentDoneByTicket((prev) => {
          if (previousReopenFlag === undefined) {
            const { [ticket.id]: _, ...rest } = prev;
            return rest;
          }
          return { ...prev, [ticket.id]: previousReopenFlag };
        });
        setPendingWorkerAssignmentByTicket((prev) => {
          const { [ticket.id]: _, ...rest } = prev;
          return rest;
        });
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
      setReopenReassignmentDoneByTicket((prev) => ({ ...prev, [ticket.id]: true }));
      void refetchTickets(true);
    } finally {
      setAssigningTicketId(null);
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
                  ? 'The field inspector ticket window will not be available until the worker is assigned and the issue is verified.'
                  : 'No tickets available for this role.'}
              </div>
            )}

            {filteredTickets.map((ticket) => {
              const progressDraft = progressDrafts[ticket.id] || '';
              const progressPercent = Number(ticket.progressPercent || 0);
              const pendingWorkerIds = pendingWorkerAssignmentByTicket[ticket.id] || [];
              const hasPendingWorkerAssignment = pendingWorkerIds.length > 0;
              const assignedWorkerNames = hasPendingWorkerAssignment
                ? pendingWorkerIds.map((workerId) => workers.find((worker) => worker.id === workerId)?.name || workerId)
                : ticketWorkerNames(ticket);
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
              const reopenedAtRaw = ticket.reopenedBy?.timestamp || ticket.reopenWarning?.issuedAt;
              const reopenedAtMs = reopenedAtRaw ? new Date(reopenedAtRaw).getTime() : Number.NaN;
              const latestAssignedAtMs = Array.isArray(ticket.assignees)
                ? Math.max(
                    ...ticket.assignees
                      .map((entry) => new Date(entry?.assignedAt || '').getTime())
                      .filter((value) => Number.isFinite(value))
                  )
                : Number.NaN;
              const hasPostReopenAssignment =
                reopenReassignmentDoneByTicket[ticket.id] === true ||
                (Number.isFinite(reopenedAtMs) &&
                  Number.isFinite(latestAssignedAtMs) &&
                  latestAssignedAtMs >= reopenedAtMs);
              const hasExplicitReopenPending = reopenReassignmentDoneByTicket[ticket.id] === false;
              const needsReassignmentAfterReopen =
                role === 'department' &&
                (hasExplicitReopenPending || (isReopenedCase && !hasPostReopenAssignment));
              const canDepartmentManageReopened =
                role === 'department' &&
                isReopenedCase &&
                ticket.status !== 'resolved';
              const isAssignmentLockedTicket = ticket.status === 'resolved';
              const canReopen = role === 'department' && ticket.status === 'resolved';
              const canDepartmentVerify =
                role === 'department' &&
                hasAssignedWorker &&
                !needsReassignmentAfterReopen &&
                ticket.status !== 'resolved' &&
                ticket.status !== 'verified';
              const canResolve =
                role === 'department' &&
                hasAssignedWorker &&
                ticket.status === 'verified';
              const canSupervisorResolve = false;
              const canAssignWorkers =
                ((role === 'supervisor' && !hasAssignedWorker) ||
                  (role === 'department' && (!hasAssignedWorker || needsReassignmentAfterReopen))) &&
                ticket.status !== 'resolved';
              const fieldInspectorWindowAvailable =
                role !== 'field_inspector' || (hasAssignedWorker && ticket.status === 'verified');
              const showProgressEditor =
                isTicketsPage && (role === 'worker' || (role === 'field_inspector' && fieldInspectorWindowAvailable));
              const showDepartmentActions = isTicketsPage && role === 'department';
              const showLogbookAction =
                isTicketsPage &&
                (role === 'department' ||
                  role === 'supervisor' ||
                  role === 'worker' ||
                  role === 'field_inspector');
              const showAssignmentSection =
                isTicketsPage && (role === 'department' || role === 'supervisor' || canDepartmentManageReopened);

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

                  {(showDepartmentActions || showLogbookAction) && (
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
                      {showDepartmentActions && (
                        <>
                          {(canDepartmentVerify || canResolve) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" disabled={statusSubmittingId === ticket.id}>
                                  Actions
                                  <ChevronDown className="h-4 w-4 ml-1 opacity-60" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                {canDepartmentVerify && (
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
                              disabled={statusSubmittingId === ticket.id && ticket.status !== 'resolved'}
                            >
                              <RotateCcw className="h-4 w-4 mr-1" />
                              Reopen
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {showAssignmentSection &&
                    (isAssignmentLockedTicket && !canAssignWorkers ? (
                      <div className="text-xs text-muted-foreground">
                        Worker assignment is unavailable after resolution.
                      </div>
                    ) : canAssignWorkers ? (
                      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Assign Workers</label>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                className="h-10 w-full justify-between text-left font-normal"
                                disabled={
                                  !canAssignWorkers ||
                                  loadingWorkers ||
                                  assigningTicketId === ticket.id
                                }
                              >
                                <span className="truncate">
                                  {selectedWorkerCount > 0
                                    ? `${selectedWorkerCount} worker(s) selected`
                                    : 'Select workers'}
                                </span>
                                <ChevronDown className="h-4 w-4 opacity-60" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[320px] max-h-72 overflow-y-auto">
                              <DropdownMenuLabel>Registered Workers</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {workers.length === 0 ? (
                                <div className="px-2 py-2 text-sm text-muted-foreground">No workers available</div>
                              ) : (
                                workers.map((worker) => {
                                  const workerLabel = `${worker.name}${worker.workerSpecialization ? ` - ${worker.workerSpecialization}` : ''}`;
                                  const checked = selectedWorkerIds.includes(worker.id);
                                  return (
                                    <DropdownMenuCheckboxItem
                                      key={worker.id}
                                      checked={checked}
                                      onSelect={(event) => event.preventDefault()}
                                      onCheckedChange={(nextChecked) => {
                                        setSelectedWorkerByTicket((prev) => {
                                          const current = Object.prototype.hasOwnProperty.call(prev, ticket.id)
                                            ? prev[ticket.id] || []
                                            : preselectedWorkerIds;
                                          const normalized = current.map((value) => value.trim()).filter(Boolean);
                                          let next = normalized;
                                          if (nextChecked) {
                                            if (!normalized.includes(worker.id)) {
                                              next = [...normalized, worker.id];
                                            }
                                          } else {
                                            next = normalized.filter((value) => value !== worker.id);
                                          }
                                          return { ...prev, [ticket.id]: next };
                                        });
                                      }}
                                    >
                                      {workerLabel}
                                    </DropdownMenuCheckboxItem>
                                  );
                                })
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:justify-end">
                          <Button
                            variant="outline"
                            onClick={() => void handleAssignWorker(ticket)}
                            disabled={
                              !canAssignWorkers ||
                              loadingWorkers ||
                              assigningTicketId === ticket.id
                            }
                          >
                            <Users className="h-4 w-4 mr-1" />
                            {hasAssignedWorker ? 'Update Workers' : 'Assign Workers'}
                          </Button>
                          {canSupervisorResolve && (
                            <Button
                              onClick={() => void handleStatusChange(ticket.id, 'resolved')}
                              disabled={statusSubmittingId === ticket.id}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              Resolve
                            </Button>
                          )}
                        </div>
                        {role === 'supervisor' && isReopenedCase && ticket.status !== 'resolved' && (
                          <div className="md:col-span-2 text-xs text-muted-foreground">
                            Reopened tickets can only be closed by department.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Workers already assigned.
                      </div>
                    ))}

                  {role === 'field_inspector' && !fieldInspectorWindowAvailable && (
                    <div className="text-xs text-muted-foreground">
                      The field inspector ticket window will not be available until the worker is assigned and the issue is verified.
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
                          placeholder={
                            role === 'field_inspector'
                              ? 'Enter today field inspection update...'
                              : 'Enter work completion update...'
                          }
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ticket LogBook</DialogTitle>
            <DialogDescription>
              Official activity LogBook for {logbookTicket?.title || 'ticket'}.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1">
            {logbookLoading && <div className="text-sm text-muted-foreground">Loading logbook...</div>}
            {!logbookLoading && logbookEntries.length === 0 && (
              <div className="text-sm text-muted-foreground">No log entries found.</div>
            )}
            {logbookEntries.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{entry.action}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Actor: {entry.actorName || 'Unknown'} ({entry.actorOfficialRole || 'N/A'})
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{logbookDetailText(entry.details)}</div>
              </div>
            ))}
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
