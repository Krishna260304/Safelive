import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Download, Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { API_CONFIG } from '@/config/api';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  TicketChatMessage,
  TicketChatSession,
  TicketChatTargetRole,
  TicketChatUserOption,
  ticketChatService,
} from '@/services/ticket-chat';

interface ChatTicketRef {
  id: string;
  ticketId?: string;
  title?: string;
}

interface TicketChatDialogProps {
  open: boolean;
  onOpenChange: (nextOpen: boolean) => void;
  ticket: ChatTicketRef | null;
}

const parseApiDate = (value?: string): Date | null => {
  const raw = (value || '').trim();
  if (!raw) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  const normalized = hasTimezone ? raw : `${raw}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatDateTime = (value?: string): string => {
  const parsed = parseApiDate(value);
  if (!parsed) return 'N/A';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
};

const formatTime = (value?: string): string => {
  const parsed = parseApiDate(value);
  if (!parsed) return 'N/A';
  return parsed.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  });
};

const displayTicketId = (ticket: ChatTicketRef): string => {
  const formatted = (ticket.ticketId || '').trim();
  return formatted || ticket.id;
};

const userOptionLabel = (option: TicketChatUserOption): string => {
  const department = (option.department || '').trim();
  return department ? `${option.name} (${department})` : option.name;
};

export const TicketChatDialog = ({ open, onOpenChange, ticket }: TicketChatDialogProps) => {
  const { toast } = useToast();
  const ticketRefId = (ticket?.id || '').trim();

  const [optionsLoading, setOptionsLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [endingChat, setEndingChat] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const [selectedLocalUserId, setSelectedLocalUserId] = useState('');

  const [messageDraft, setMessageDraft] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [useAiAssist, setUseAiAssist] = useState(true);

  const [options, setOptions] = useState<
    | null
    | {
        ticketId: string;
        targetRoles: Array<{ value: TicketChatTargetRole; label: string }>;
        departments: TicketChatUserOption[];
        supervisors: TicketChatUserOption[];
        preferredTargetRole?: TicketChatTargetRole | null;
        preferredTargetUser?: TicketChatUserOption | null;
        existingSessions: TicketChatSession[];
        defaultTargetRole?: TicketChatTargetRole | null;
        currentUserRole: string;
        currentUserId: string;
        retentionHours: number;
        initiateEnabled: boolean;
        chatVisible: boolean;
      }
  >(null);

  const [session, setSession] = useState<TicketChatSession | null>(null);
  const [messages, setMessages] = useState<TicketChatMessage[]>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedExistingSession = useMemo(() => {
    if (!options || options.existingSessions.length === 0) return null;
    if (!selectedLocalUserId) return options.existingSessions[0];
    return options.existingSessions.find((entry) => entry.localUserId === selectedLocalUserId) || options.existingSessions[0];
  }, [options, selectedLocalUserId]);

  const canSendMessages = Boolean(session) && !session?.endedAt;

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 30);
  }, []);

  const resetConversationState = useCallback(() => {
    setSession(null);
    setMessages([]);
    setMessageDraft('');
    setQueuedFiles([]);
    setSelectedLocalUserId('');
    setRealtimeConnected(false);
  }, []);

  const loadMessages = useCallback(
    async (nextSession: TicketChatSession, silent = false) => {
      if (!ticketRefId) return;
      if (!silent) {
        setMessagesLoading(true);
      }
      const response = await ticketChatService.getMessages(ticketRefId, nextSession.id);
      if (response.success && response.data) {
        setSession(response.data.session);
        setMessages(response.data.messages || []);
        scrollToBottom();
      } else if (!silent) {
        toast({
          title: 'Unable to Load Chat',
          description: response.error || 'Could not fetch chat messages.',
          variant: 'destructive',
        });
      }
      if (!silent) {
        setMessagesLoading(false);
      }
    },
    [scrollToBottom, ticketRefId, toast]
  );

  useEffect(() => {
    if (!open || !ticketRefId) return;

    let cancelled = false;
    const initialize = async () => {
      setOptionsLoading(true);
      resetConversationState();
      const response = await ticketChatService.getOptions(ticketRefId);
      if (cancelled) return;

      if (!response.success || !response.data) {
        setOptions(null);
        setOptionsLoading(false);
        toast({
          title: 'Chat Unavailable',
          description: response.error || 'Unable to load chat options for this ticket.',
          variant: 'destructive',
        });
        return;
      }

      const payload = response.data;
      setOptions(payload);

      if (payload.initiateEnabled) {
        setSelectedLocalUserId('');
      } else {
        const firstSession = payload.existingSessions[0];
        setSelectedLocalUserId(firstSession?.localUserId || '');
      }

      setOptionsLoading(false);
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [open, resetConversationState, ticketRefId, toast]);

  useEffect(() => {
    if (!open || !ticketRefId || !session) return;
    const intervalId = window.setInterval(() => {
      void loadMessages(session, true);
    }, 5000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadMessages, open, session, ticketRefId]);

  useEffect(() => {
    if (!open || !ticketRefId || !session) return;
    if (!API_CONFIG.WS_BASE_URL) return;

    const socket = new WebSocket(`${API_CONFIG.WS_BASE_URL}/ws/incidents`);

    socket.onopen = () => setRealtimeConnected(true);
    socket.onerror = () => setRealtimeConnected(false);
    socket.onclose = () => setRealtimeConnected(false);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const data = payload?.data;
        if (payload?.type !== 'TICKET_CHAT_SYNC') return;
        if (!data || data.ticketId !== options?.ticketId || data.sessionId !== session.id) return;
        void loadMessages(session, true);
      } catch {
        return;
      }
    };

    return () => {
      setRealtimeConnected(false);
      socket.close();
    };
  }, [loadMessages, open, options?.ticketId, session, ticketRefId]);

  const handleStartOrOpenChat = async () => {
    if (!ticketRefId || !options) return;
    setSessionLoading(true);

    let payload: { targetRole: TicketChatTargetRole; targetUserId?: string; localUserId?: string };

    if (options.initiateEnabled) {
      if (!options.preferredTargetRole || !options.preferredTargetUser?.id) {
        toast({
          title: 'Official Unavailable',
          description: 'No responsible department or supervisor is available for this ticket right now.',
          variant: 'destructive',
        });
        setSessionLoading(false);
        return;
      }
      payload = {
        targetRole: options.preferredTargetRole,
        targetUserId: options.preferredTargetUser.id,
      };
    } else {
      if (!selectedExistingSession) {
        toast({
          title: 'No Chat Available',
          description: 'Official chat remains hidden until a local user initiates chat.',
          variant: 'destructive',
        });
        setSessionLoading(false);
        return;
      }
      payload = {
        targetRole: selectedExistingSession.targetRole,
        localUserId: selectedExistingSession.localUserId,
      };
    }

    const response = await ticketChatService.openSession(ticketRefId, payload);
    if (!response.success || !response.data) {
      toast({
        title: 'Unable to Open Chat',
        description: response.error || 'Could not open chat session.',
        variant: 'destructive',
      });
      setSessionLoading(false);
      return;
    }

    setSession(response.data);
    await loadMessages(response.data);
    setSessionLoading(false);
  };

  const handleSendMessage = async () => {
    if (!ticketRefId || !session) return;
    if (!messageDraft.trim() && queuedFiles.length === 0) {
      toast({
        title: 'Message Required',
        description: 'Type a message or attach photo/video before sending.',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    const response = await ticketChatService.sendMessage(ticketRefId, session.id, {
      message: messageDraft,
      files: queuedFiles,
      useAiAssist,
    });

    if (!response.success) {
      toast({
        title: 'Message Failed',
        description: response.error || 'Could not send message.',
        variant: 'destructive',
      });
      setSending(false);
      return;
    }

    setMessageDraft('');
    setQueuedFiles([]);
    if (response.data && response.data.length > 0) {
      setMessages((prev) => [...prev, ...response.data]);
      scrollToBottom();
    }
    await loadMessages(session, true);
    setSending(false);
  };

  const handleEndChat = async () => {
    if (!ticketRefId || !session) return;
    setEndingChat(true);
    const response = await ticketChatService.endSession(ticketRefId, session.id);
    if (!response.success || !response.data) {
      toast({
        title: 'Unable to End Chat',
        description: response.error || 'Could not end this chat session.',
        variant: 'destructive',
      });
      setEndingChat(false);
      return;
    }

    setSession(response.data);
    toast({
      title: 'Chat Ended',
      description: 'Chat has ended. You can download transcript PDF.',
    });
    await loadMessages(response.data, true);
    setEndingChat(false);
  };

  const handleDownloadTranscript = async () => {
    if (!ticketRefId || !session) return;
    setDownloadingPdf(true);
    const response = await ticketChatService.downloadTranscript(ticketRefId, session.id);
    if (!response.success) {
      toast({
        title: 'Download Failed',
        description: response.error || 'Could not download transcript.',
        variant: 'destructive',
      });
    }
    setDownloadingPdf(false);
  };

  const handleQueueFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || []);
    if (picked.length === 0) return;
    setQueuedFiles((prev) => {
      const combined = [...prev, ...picked];
      return combined.slice(0, 5);
    });
    event.target.value = '';
  };

  const handleRemoveQueuedFile = (index: number) => {
    setQueuedFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const onDialogOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      resetConversationState();
      setOptions(null);
      setOptionsLoading(false);
      setSessionLoading(false);
      setMessagesLoading(false);
      setSending(false);
      setEndingChat(false);
      setDownloadingPdf(false);
    }
  };

  const localSessionOptions = options?.existingSessions || [];

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Ticket Chat {ticket ? `- ${displayTicketId(ticket)}` : ''}</DialogTitle>
          <DialogDescription>
            Local chat is routed automatically to the official currently handling the ticket. Official chat appears only after local initiation.
          </DialogDescription>
        </DialogHeader>

        {!ticket && <div className="text-sm text-muted-foreground">Select a ticket to open chat.</div>}

        {ticket && (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 p-3">
              {optionsLoading && <div className="text-sm text-muted-foreground">Loading chat options...</div>}

              {!optionsLoading && options && !options.chatVisible && (
                <div className="text-sm text-muted-foreground">
                  No local-initiated chat yet. Official chat stays hidden until local user starts conversation.
                </div>
              )}

              {!optionsLoading && options && options.chatVisible && (
                <div className="grid gap-3 md:grid-cols-4">
                  {options.initiateEnabled ? (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">Assigned Official</label>
                        <Input
                          value={options.preferredTargetUser ? userOptionLabel(options.preferredTargetUser) : 'Not assigned yet'}
                          disabled
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground">Handling Role</label>
                        <Input
                          value={options.preferredTargetRole ? options.preferredTargetRole.replace('_', ' ') : 'N/A'}
                          disabled
                          className="mt-1"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">Local User</label>
                        <select
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={selectedLocalUserId}
                          onChange={(event) => setSelectedLocalUserId(event.target.value)}
                          disabled={sessionLoading || localSessionOptions.length === 0}
                        >
                          {localSessionOptions.map((entry) => (
                            <option key={entry.id} value={entry.localUserId}>
                              {entry.localUserName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs text-muted-foreground">Channel</label>
                        <Input
                          value={selectedExistingSession?.targetRole?.replace('_', ' ') || 'N/A'}
                          disabled
                          className="mt-1"
                        />
                      </div>
                    </>
                  )}

                  <div className="md:col-span-2 flex items-end">
                    <Button
                      className="h-10"
                      onClick={() => void handleStartOrOpenChat()}
                      disabled={
                        sessionLoading ||
                        (options.initiateEnabled && (!options.preferredTargetRole || !options.preferredTargetUser?.id)) ||
                        (!options.initiateEnabled && !selectedExistingSession)
                      }
                    >
                      {sessionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {session ? 'Resume Chat' : options.initiateEnabled ? 'Start Chat' : 'Open Chat'}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {session && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  <div>
                    <div>
                      Started: <span className="font-medium text-foreground">{formatDateTime(session.createdAt)}</span>
                    </div>
                    <div>
                      Last activity: <span className="font-medium text-foreground">{formatDateTime(session.lastActivityAt)}</span>
                    </div>
                    <div>
                      Realtime:{' '}
                      <span className={cn('font-medium', realtimeConnected ? 'text-success' : 'text-muted-foreground')}>
                        {realtimeConnected ? 'Connected' : 'Polling fallback'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {session.endedAt ? (
                      <Button variant="outline" onClick={() => void handleDownloadTranscript()} disabled={downloadingPdf}>
                        {downloadingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                        Download PDF
                      </Button>
                    ) : (
                      <Button variant="outline" onClick={() => void handleEndChat()} disabled={endingChat}>
                        {endingChat ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        End Chat
                      </Button>
                    )}
                  </div>
                </div>

                <div className="h-[340px] overflow-y-auto rounded-md border border-border bg-muted/10 p-3">
                  {messagesLoading && <div className="text-sm text-muted-foreground">Loading messages...</div>}

                  {!messagesLoading && messages.length === 0 && (
                    <div className="text-sm text-muted-foreground">No messages yet. Start the conversation.</div>
                  )}

                  <div className="space-y-3">
                    {messages.map((entry) => {
                      const ownMessage = (entry.senderId || '').trim() === options?.currentUserId;
                      const assistantMessage = (entry.messageType || '').trim() === 'assistant';
                      return (
                        <div key={entry.id} className={cn('flex', ownMessage ? 'justify-end' : 'justify-start')}>
                          <div
                            className={cn(
                              'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                              ownMessage
                                ? 'border-primary bg-primary text-primary-foreground'
                                : assistantMessage
                                  ? 'border-accent bg-accent/20 text-foreground'
                                  : 'border-border bg-card text-foreground'
                            )}
                          >
                            <div className={cn('mb-1 text-[11px]', ownMessage ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                              {assistantMessage && <Bot className="mr-1 inline h-3 w-3" />}
                              {entry.senderName || 'User'}
                              {entry.senderRole ? ` (${String(entry.senderRole).replace(/_/g, ' ')})` : ''} | {formatTime(entry.createdAt)}
                            </div>
                            <div className="whitespace-pre-wrap break-words">{entry.message || '[Attachment]'}</div>

                            {(entry.attachments || []).length > 0 && (
                              <div className="mt-2 space-y-2">
                                {(entry.attachments || []).map((attachment, index) => {
                                  const mediaType = (attachment.mediaType || 'file').toLowerCase();
                                  const url = attachment.url;
                                  const fileLabel = attachment.fileName || `Attachment ${index + 1}`;
                                  if (mediaType === 'image') {
                                    return (
                                      <a key={`${entry.id}-att-${index}`} href={url} target="_blank" rel="noreferrer" className="block">
                                        <img
                                          src={url}
                                          alt={fileLabel}
                                          className="h-28 w-40 rounded-md border border-border object-cover"
                                          loading="lazy"
                                        />
                                      </a>
                                    );
                                  }
                                  if (mediaType === 'video') {
                                    return (
                                      <video
                                        key={`${entry.id}-att-${index}`}
                                        src={url}
                                        controls
                                        className="h-28 w-52 rounded-md border border-border object-cover"
                                      />
                                    );
                                  }
                                  return (
                                    <a key={`${entry.id}-att-${index}`} href={url} target="_blank" rel="noreferrer" className="text-xs underline">
                                      {fileLabel}
                                    </a>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={bottomRef} />
                  </div>
                </div>

                <div className="space-y-2 rounded-md border border-border bg-card p-3">
                  {session.endedAt && (
                    <div className="text-xs text-warning">
                      Chat ended at {formatDateTime(session.endedAt)}. Download transcript PDF or wait for new local initiation.
                    </div>
                  )}

                  <Input
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    placeholder="Type your message..."
                    disabled={!canSendMessages || sending}
                  />

                  {queuedFiles.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {queuedFiles.map((file, index) => (
                        <div key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                          <span className="max-w-[180px] truncate">{file.name}</span>
                          <button type="button" onClick={() => handleRemoveQueuedFile(index)}>
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*,video/*"
                        multiple
                        className="hidden"
                        onChange={handleQueueFiles}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!canSendMessages || sending}
                      >
                        <Paperclip className="mr-1 h-4 w-4" />
                        Upload Photo/Video
                      </Button>

                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={useAiAssist}
                          onChange={(event) => setUseAiAssist(event.target.checked)}
                          disabled={!canSendMessages || sending}
                        />
                        AI Assist
                      </label>
                    </div>

                    <Button type="button" onClick={() => void handleSendMessage()} disabled={!canSendMessages || sending}>
                      {sending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <SendHorizontal className="mr-2 h-4 w-4" />}
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
