import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Paperclip, SendHorizontal, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { getRealtimeTransportSecurityError, subscribeIncidentSocket } from '@/services/realtime';
import {
  decryptBytesWithKey,
  decryptTextWithKey,
  deriveSessionEncryptionKey,
  encryptBytesWithKey,
  encryptTextWithKey,
  getOrCreateIdentityKeyPair,
  isChatCryptoSupported,
  verifyOrStorePeerFingerprint,
} from '@/services/chat-crypto';
import {
  TicketChatMessage,
  TicketChatSession,
  TicketChatSessionKeyBundle,
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

const attachmentMediaTypeFromMime = (mimeType: string): 'image' | 'video' | 'file' => {
  const normalized = (mimeType || '').trim().toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  return 'file';
};

const resolvePeerParticipantKey = (
  currentSession: TicketChatSession | null,
  currentUserId: string
): { participantId: string; bundle: TicketChatSessionKeyBundle } | null => {
  if (!currentSession || !currentUserId) return null;
  const participantKeys = currentSession.participantKeys || {};
  for (const participant of currentSession.participants || []) {
    const participantId = String(participant.userId || '').trim();
    if (!participantId || participantId === currentUserId) continue;
    const bundle = participantKeys[participantId];
    if (bundle && bundle.publicKeyJwk) {
      return {
        participantId,
        bundle,
      };
    }
  }
  return null;
};

export const TicketChatDialog = ({ open, onOpenChange, ticket }: TicketChatDialogProps) => {
  const { toast } = useToast();
  const ticketRefId = (ticket?.id || '').trim();
  const transportSecurityError = getRealtimeTransportSecurityError();

  const [optionsLoading, setOptionsLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [endingChat, setEndingChat] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  const [selectedTargetRole, setSelectedTargetRole] = useState<TicketChatTargetRole | ''>('');
  const [selectedTargetUserId, setSelectedTargetUserId] = useState('');

  const [messageDraft, setMessageDraft] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);

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
  const [encryptionStatus, setEncryptionStatus] = useState<'unsupported' | 'initializing' | 'waiting-peer' | 'ready' | 'error'>(
    isChatCryptoSupported() ? 'initializing' : 'unsupported'
  );
  const [encryptionError, setEncryptionError] = useState('');
  const [decryptedTextByMessageId, setDecryptedTextByMessageId] = useState<Record<string, string>>({});
  const [decryptedAttachmentUrlByKey, setDecryptedAttachmentUrlByKey] = useState<Record<string, string>>({});
  const [decryptionFailuresByMessageId, setDecryptionFailuresByMessageId] = useState<Record<string, boolean>>({});
  const [sessionEncryptionVersion, setSessionEncryptionVersion] = useState(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TicketChatSession | null>(null);
  const previousSessionIdRef = useRef('');
  const sessionEncryptionKeyRef = useRef<CryptoKey | null>(null);
  const localPublicKeyJwkRef = useRef<JsonWebKey | null>(null);
  const localPrivateKeyRef = useRef<CryptoKey | null>(null);
  const localFingerprintRef = useRef('');
  const registeredKeySessionsRef = useRef<Set<string>>(new Set());
  const createdObjectUrlsRef = useRef<Set<string>>(new Set());

  const selectedExistingSession = useMemo(() => {
    if (!options || options.existingSessions.length === 0) return null;
    return options.existingSessions[0];
  }, [options]);

  const canSendMessages = Boolean(session) && !session?.endedAt;
  const canSendEncryptedMessages = canSendMessages && encryptionStatus === 'ready';

  const selectedTargetOptions = useMemo(() => {
    if (!options || !selectedTargetRole) return [] as TicketChatUserOption[];
    return selectedTargetRole === 'department' ? options.departments : options.supervisors;
  }, [options, selectedTargetRole]);

  const selectedTargetUser = useMemo(() => {
    if (selectedTargetOptions.length === 0) return null;
    if (selectedTargetUserId) {
      const exactMatch = selectedTargetOptions.find((entry) => entry.id === selectedTargetUserId);
      if (exactMatch) {
        return exactMatch;
      }
    }
    return selectedTargetOptions[0] || null;
  }, [selectedTargetOptions, selectedTargetUserId]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 30);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const cleanupDecryptedAttachmentUrls = useCallback(() => {
    for (const objectUrl of createdObjectUrlsRef.current) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch {
        continue;
      }
    }
    createdObjectUrlsRef.current.clear();
  }, []);

  const resetConversationState = useCallback(() => {
    cleanupDecryptedAttachmentUrls();
    setSession(null);
    setMessages([]);
    setMessageDraft('');
    setQueuedFiles([]);
    setSelectedTargetRole('');
    setSelectedTargetUserId('');
    setRealtimeConnected(false);
    setEncryptionStatus(isChatCryptoSupported() ? 'initializing' : 'unsupported');
    setEncryptionError('');
    setDecryptedTextByMessageId({});
    setDecryptedAttachmentUrlByKey({});
    setDecryptionFailuresByMessageId({});
    sessionEncryptionKeyRef.current = null;
    localPublicKeyJwkRef.current = null;
    localPrivateKeyRef.current = null;
    localFingerprintRef.current = '';
    registeredKeySessionsRef.current = new Set();
    previousSessionIdRef.current = '';
    setSessionEncryptionVersion(0);
  }, [cleanupDecryptedAttachmentUrls]);

  const clearActiveSessionState = useCallback(() => {
    cleanupDecryptedAttachmentUrls();
    setSession(null);
    setMessages([]);
    setMessageDraft('');
    setQueuedFiles([]);
    setMessagesLoading(false);
    setSending(false);
    setEndingChat(false);
    setDownloadingPdf(false);
    setDecryptedTextByMessageId({});
    setDecryptedAttachmentUrlByKey({});
    setDecryptionFailuresByMessageId({});
    sessionRef.current = null;
    sessionEncryptionKeyRef.current = null;
    previousSessionIdRef.current = '';
    setSessionEncryptionVersion(0);
    setEncryptionStatus(isChatCryptoSupported() ? 'initializing' : 'unsupported');
    setEncryptionError('');
  }, [cleanupDecryptedAttachmentUrls]);

  useEffect(() => {
    return () => {
      cleanupDecryptedAttachmentUrls();
    };
  }, [cleanupDecryptedAttachmentUrls]);

  useEffect(() => {
    const currentSessionId = String(session?.id || '').trim();
    if (!currentSessionId || currentSessionId === previousSessionIdRef.current) return;
    previousSessionIdRef.current = currentSessionId;
    cleanupDecryptedAttachmentUrls();
    setDecryptedTextByMessageId({});
    setDecryptedAttachmentUrlByKey({});
    setDecryptionFailuresByMessageId({});
    sessionEncryptionKeyRef.current = null;
    setSessionEncryptionVersion(0);
    setEncryptionStatus('initializing');
    setEncryptionError('');
  }, [cleanupDecryptedAttachmentUrls, session?.id]);

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

  const ensureLocalIdentityKey = useCallback(async (): Promise<boolean> => {
    if (!isChatCryptoSupported()) {
      setEncryptionStatus('unsupported');
      setEncryptionError('This browser does not support WebCrypto for end-to-end encryption.');
      return false;
    }
    if (localPublicKeyJwkRef.current && localPrivateKeyRef.current && localFingerprintRef.current) {
      return true;
    }
    try {
      const keyPair = await getOrCreateIdentityKeyPair();
      localPublicKeyJwkRef.current = keyPair.publicKeyJwk;
      localPrivateKeyRef.current = keyPair.privateKey;
      localFingerprintRef.current = keyPair.fingerprint || '';
      return true;
    } catch (error) {
      setEncryptionStatus('error');
      setEncryptionError(error instanceof Error ? error.message : 'Unable to initialize encryption keys.');
      return false;
    }
  }, []);

  const tryDeriveSessionKey = useCallback(
    async (currentSession: TicketChatSession): Promise<boolean> => {
      const currentUserId = String(options?.currentUserId || '').trim();
      const localPrivateKey = localPrivateKeyRef.current;
      if (!currentUserId || !localPrivateKey) return false;

      const peerParticipant = resolvePeerParticipantKey(currentSession, currentUserId);
      const peerPublicKeyJwk = peerParticipant?.bundle.publicKeyJwk;
      if (!peerPublicKeyJwk) return false;

      try {
        if (peerParticipant) {
          const trustResult = await verifyOrStorePeerFingerprint(peerParticipant.participantId, peerPublicKeyJwk);
          if (trustResult.status === 'changed') {
            setEncryptionStatus('error');
            setEncryptionError('Peer encryption key changed unexpectedly. Potential MITM risk. End chat and verify the participant.');
            return false;
          }
        }
        const derivedKey = await deriveSessionEncryptionKey(currentSession.id, localPrivateKey, peerPublicKeyJwk);
        sessionEncryptionKeyRef.current = derivedKey;
        setEncryptionError('');
        setEncryptionStatus('ready');
        setSessionEncryptionVersion((prev) => prev + 1);
        return true;
      } catch (error) {
        setEncryptionStatus('error');
        setEncryptionError(error instanceof Error ? error.message : 'Unable to derive session encryption key.');
        return false;
      }
    },
    [options?.currentUserId]
  );

  const announceSessionKey = useCallback(
    async (currentSession: TicketChatSession): Promise<void> => {
      if (!ticketRefId) return;
      const sessionId = (currentSession.id || '').trim();
      if (!sessionId || registeredKeySessionsRef.current.has(sessionId)) {
        return;
      }
      const hasIdentity = await ensureLocalIdentityKey();
      if (!hasIdentity || !localPublicKeyJwkRef.current) return;

      setEncryptionStatus('initializing');
      const identityResponse = await ticketChatService.upsertIdentityKey({
        publicKeyJwk: localPublicKeyJwkRef.current,
        algorithm: 'ECDH-P256',
        fingerprint: localFingerprintRef.current || undefined,
      });
      if (!identityResponse.success) {
        setEncryptionStatus('error');
        setEncryptionError(identityResponse.error || 'Unable to publish identity key.');
        return;
      }
      const response = await ticketChatService.upsertSessionKey(ticketRefId, sessionId, {
        publicKeyJwk: localPublicKeyJwkRef.current,
        algorithm: 'ECDH-P256',
        fingerprint: localFingerprintRef.current || undefined,
      });
      if (!response.success || !response.data) {
        setEncryptionStatus('error');
        setEncryptionError(response.error || 'Unable to exchange encryption keys.');
        return;
      }

      registeredKeySessionsRef.current.add(sessionId);
      setSession((prev) => {
        if (!prev || prev.id !== sessionId) return prev;
        return response.data?.session || prev;
      });
      const nextSession = response.data.session || currentSession;
      const ready = await tryDeriveSessionKey(nextSession);
      if (!ready) {
        setEncryptionStatus('waiting-peer');
      }
    },
    [ensureLocalIdentityKey, ticketRefId, tryDeriveSessionKey]
  );

  const loadOptions = useCallback(
    async ({ showLoading = false, resetState = false }: { showLoading?: boolean; resetState?: boolean } = {}) => {
      if (!ticketRefId) return null;
      if (transportSecurityError) return null;
      if (showLoading) {
        setOptionsLoading(true);
      }
      if (resetState) {
        resetConversationState();
      }

      const response = await ticketChatService.getOptions(ticketRefId);
      if (!response.success || !response.data) {
        setOptions(null);
        if (showLoading) {
          setOptionsLoading(false);
        }
        return null;
      }

      const payload = response.data;
      setOptions(payload);

      if (payload.initiateEnabled) {
        const defaultTargetRole =
          payload.defaultTargetRole ||
          payload.preferredTargetRole ||
          payload.targetRoles[0]?.value ||
          '';
        setSelectedTargetRole(defaultTargetRole);
        const defaultTargetCandidates =
          defaultTargetRole === 'department'
            ? payload.departments
            : defaultTargetRole === 'supervisor'
              ? payload.supervisors
              : [];
        const preferredTargetId =
          payload.preferredTargetRole === defaultTargetRole ? payload.preferredTargetUser?.id || '' : '';
        const defaultTargetUserId =
          (preferredTargetId && defaultTargetCandidates.find((entry) => entry.id === preferredTargetId)?.id) ||
          defaultTargetCandidates[0]?.id ||
          '';
        setSelectedTargetUserId(defaultTargetUserId);
      } else {
        setSelectedTargetRole('');
        setSelectedTargetUserId('');

        const firstSession = payload.existingSessions[0];
        const currentSession = sessionRef.current;
        const shouldAutoOpenReceivedSession =
          payload.chatVisible &&
          Boolean(firstSession) &&
          (!currentSession || currentSession.id !== firstSession.id || Boolean(currentSession.endedAt));

        if (shouldAutoOpenReceivedSession && firstSession) {
          setSessionLoading(true);
          const sessionResponse = await ticketChatService.openSession(ticketRefId, {
            targetRole: firstSession.targetRole,
          });

          if (sessionResponse.success && sessionResponse.data) {
            setSession(sessionResponse.data);
            await loadMessages(sessionResponse.data, !showLoading);
          } else if (showLoading) {
            toast({
              title: 'Unable to Open Chat',
              description: sessionResponse.error || 'Could not open the received chat session.',
              variant: 'destructive',
            });
          }
          setSessionLoading(false);
        }
      }

      if (showLoading) {
        setOptionsLoading(false);
      }

      return payload;
    },
    [loadMessages, resetConversationState, ticketRefId, toast, transportSecurityError]
  );

  useEffect(() => {
    if (!open || !ticketRefId) return;
    if (transportSecurityError) {
      resetConversationState();
      setOptions(null);
      setOptionsLoading(false);
      return;
    }

    let cancelled = false;
    const initialize = async () => {
      const response = await loadOptions({ showLoading: true, resetState: true });
      if (cancelled) return;

      if (!response) {
        toast({
          title: 'Chat Unavailable',
          description: 'Unable to load chat options for this ticket.',
          variant: 'destructive',
        });
        return;
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [loadOptions, open, resetConversationState, ticketRefId, toast, transportSecurityError]);

  useEffect(() => {
    if (!options || !selectedTargetRole) {
      setSelectedTargetUserId('');
      return;
    }

    const candidateOptions = selectedTargetRole === 'department' ? options.departments : options.supervisors;
    if (candidateOptions.length === 0) {
      setSelectedTargetUserId('');
      return;
    }

    const preferredTargetId =
      options.preferredTargetRole === selectedTargetRole ? options.preferredTargetUser?.id || '' : '';

    setSelectedTargetUserId((current) => {
      if (current && candidateOptions.some((entry) => entry.id === current)) {
        return current;
      }
      if (preferredTargetId && candidateOptions.some((entry) => entry.id === preferredTargetId)) {
        return preferredTargetId;
      }
      return candidateOptions[0]?.id || '';
    });
  }, [options, selectedTargetRole]);

  useEffect(() => {
    if (!open || !session || transportSecurityError) return;
    void announceSessionKey(session);
  }, [announceSessionKey, open, session, transportSecurityError]);

  useEffect(() => {
    if (!open || !session || transportSecurityError) return;
    if (sessionEncryptionKeyRef.current) return;
    void tryDeriveSessionKey(session).then((ready) => {
      if (!ready) {
        setEncryptionStatus('waiting-peer');
      }
    });
  }, [open, session, session?.updatedAt, transportSecurityError, tryDeriveSessionKey]);

  useEffect(() => {
    if (!open || !ticketRefId || !session || session.endedAt) return;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void loadMessages(session, true);
    }, realtimeConnected ? 20000 : 5000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadMessages, open, realtimeConnected, session, ticketRefId]);

  useEffect(() => {
    const encryptionKey = sessionEncryptionKeyRef.current;
    if (!open || !session || !encryptionKey || sessionEncryptionVersion <= 0) return;

    let cancelled = false;
    const decryptPendingTextMessages = async () => {
      const decryptedRows: Record<string, string> = {};
      const failures: Record<string, boolean> = {};
      for (const entry of messages) {
        if (!entry.encrypted || !entry.messageCiphertext || !entry.messageIv) continue;
        if (decryptedTextByMessageId[entry.id]) continue;
        try {
          decryptedRows[entry.id] = await decryptTextWithKey(encryptionKey, entry.messageCiphertext, entry.messageIv);
        } catch {
          failures[entry.id] = true;
        }
      }

      if (cancelled) return;
      if (Object.keys(decryptedRows).length > 0) {
        setDecryptedTextByMessageId((prev) => ({ ...prev, ...decryptedRows }));
      }
      if (Object.keys(failures).length > 0) {
        setDecryptionFailuresByMessageId((prev) => ({ ...prev, ...failures }));
      }
    };

    void decryptPendingTextMessages();

    return () => {
      cancelled = true;
    };
  }, [decryptedTextByMessageId, messages, open, session, sessionEncryptionVersion]);

  useEffect(() => {
    const encryptionKey = sessionEncryptionKeyRef.current;
    if (!open || !session || !encryptionKey || sessionEncryptionVersion <= 0) return;

    let cancelled = false;
    const decryptPendingAttachments = async () => {
      const nextAttachmentUrls: Record<string, string> = {};
      for (const entry of messages) {
        const attachments = entry.attachments || [];
        for (let index = 0; index < attachments.length; index += 1) {
          const attachment = attachments[index];
          if (!attachment?.encrypted || !attachment.iv || !attachment.url) continue;
          const attachmentKey = `${entry.id}:${index}`;
          if (decryptedAttachmentUrlByKey[attachmentKey]) continue;
          try {
            const response = await fetch(attachment.url);
            if (!response.ok) continue;
            const encryptedBytes = new Uint8Array(await response.arrayBuffer());
            const plainBytes = await decryptBytesWithKey(encryptionKey, encryptedBytes, attachment.iv);
            const blob = new Blob([plainBytes], {
              type: attachment.originalMimeType || attachment.contentType || 'application/octet-stream',
            });
            const objectUrl = URL.createObjectURL(blob);
            nextAttachmentUrls[attachmentKey] = objectUrl;
          } catch {
            continue;
          }
        }
      }

      if (cancelled || Object.keys(nextAttachmentUrls).length === 0) return;
      for (const objectUrl of Object.values(nextAttachmentUrls)) {
        createdObjectUrlsRef.current.add(objectUrl);
      }
      setDecryptedAttachmentUrlByKey((prev) => ({ ...prev, ...nextAttachmentUrls }));
    };

    void decryptPendingAttachments();

    return () => {
      cancelled = true;
    };
  }, [decryptedAttachmentUrlByKey, messages, open, session, sessionEncryptionVersion]);

  useEffect(() => {
    if (!open || !ticketRefId || !options?.ticketId) return;

    const subscription = subscribeIncidentSocket({
      onStateChange: (state) => {
        setRealtimeConnected(state === 'connected');
      },
      onMessage: (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const eventPayload = payload as {
          type?: string;
          data?: {
            ticketId?: string;
            sessionId?: string;
            at?: string;
            ended?: boolean;
            endedAt?: string;
            started?: boolean;
            purged?: boolean;
            purgeReason?: string;
          };
        };
        const data = eventPayload.data;
        if (eventPayload.type !== 'TICKET_CHAT_SYNC') return;
        if (!data || data.ticketId !== options.ticketId) return;

        const activeSession = sessionRef.current;
        const nextSessionId = String(data.sessionId || '').trim();
        const at = String(data.at || '').trim();
        const endedAt = String(data.endedAt || at).trim();
        const purged = Boolean(data.purged);
        const purgeReason = String(data.purgeReason || '').trim().toLowerCase();

        if (purged) {
          if (activeSession && activeSession.id === nextSessionId) {
            clearActiveSessionState();
            toast({
              title: 'Chat Deleted',
              description:
                purgeReason === 'downloaded'
                  ? 'Transcript downloaded. Chat has been deleted from storage.'
                  : 'Chat was disconnected and deleted from storage.',
            });
          }
          void loadOptions();
          return;
        }

        if (!activeSession || activeSession.id !== nextSessionId || data.started) {
          void loadOptions();
          return;
        }

        if (data.ended) {
          setSession((prev) =>
            prev && prev.id === nextSessionId
              ? {
                  ...prev,
                  endedAt: endedAt || prev.endedAt,
                  lastActivityAt: at || prev.lastActivityAt,
                  updatedAt: at || prev.updatedAt,
                }
              : prev
          );
        } else if (at) {
          setSession((prev) =>
            prev && prev.id === nextSessionId
              ? {
                  ...prev,
                  lastActivityAt: at,
                  updatedAt: at,
                }
              : prev
          );
        }

        void loadMessages(activeSession, true);
      },
    });

    if (!subscription) {
      setRealtimeConnected(false);
      return;
    }

    return () => {
      setRealtimeConnected(false);
      subscription.close();
    };
  }, [clearActiveSessionState, loadMessages, loadOptions, open, options?.ticketId, ticketRefId, toast]);

  useEffect(() => {
    if (!open || !ticketRefId || session || options?.initiateEnabled) return;

    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      void loadOptions();
    }, 8000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadOptions, open, options?.initiateEnabled, session, ticketRefId]);

  useEffect(() => {
    return () => {
      const activeSession = sessionRef.current;
      const sessionId = String(activeSession?.id || '').trim();
      if (!ticketRefId || !sessionId) return;
      void ticketChatService.disconnectSession(ticketRefId, sessionId);
    };
  }, [ticketRefId]);

  const requestSessionDisconnectPurge = useCallback(
    async (targetSession: TicketChatSession | null) => {
      const sessionId = String(targetSession?.id || '').trim();
      if (!ticketRefId || !sessionId) return;
      await ticketChatService.disconnectSession(ticketRefId, sessionId);
    },
    [ticketRefId]
  );

  const handleStartOrOpenChat = async () => {
    if (!ticketRefId || !options) return;
    setSessionLoading(true);

    let payload: { targetRole: TicketChatTargetRole; targetUserId?: string; localUserId?: string };

    if (options.initiateEnabled) {
      if (!selectedTargetRole || !selectedTargetUser?.id) {
        toast({
          title: 'Official Unavailable',
          description: 'No responsible department or supervisor is available for this ticket right now.',
          variant: 'destructive',
        });
        setSessionLoading(false);
        return;
      }
      payload = {
        targetRole: selectedTargetRole,
        targetUserId: selectedTargetUser.id,
      };
    } else {
      if (!selectedExistingSession) {
        toast({
          title: 'No Chat Available',
          description: 'No chat has been received for this ticket yet.',
          variant: 'destructive',
        });
        setSessionLoading(false);
        return;
      }
      payload = {
        targetRole: selectedExistingSession.targetRole,
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
    if (!sessionEncryptionKeyRef.current || encryptionStatus !== 'ready') {
      toast({
        title: 'Encryption Not Ready',
        description: 'Waiting for secure key exchange with the other participant.',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    const encryptedFiles: File[] = [];
    const encryptedAttachmentMeta: Array<{
      encrypted?: boolean;
      iv?: string;
      encryptionAlgorithm?: string;
      mediaType?: 'image' | 'video' | 'file';
      originalFileName?: string;
      originalMimeType?: string;
    }> = [];

    try {
      const encryptionKey = sessionEncryptionKeyRef.current;
      if (!encryptionKey) throw new Error('Session encryption key unavailable.');

      const trimmedMessage = messageDraft.trim();
      const encryptedMessage = trimmedMessage
        ? await encryptTextWithKey(encryptionKey, trimmedMessage)
        : null;

      for (const file of queuedFiles) {
        const sourceBytes = new Uint8Array(await file.arrayBuffer());
        const encryptedFile = await encryptBytesWithKey(encryptionKey, sourceBytes);
        const encryptedBlob = new Blob([encryptedFile.ciphertext], { type: 'application/octet-stream' });
        encryptedFiles.push(new File([encryptedBlob], `${file.name || 'attachment'}.enc`, { type: 'application/octet-stream' }));
        encryptedAttachmentMeta.push({
          encrypted: true,
          iv: encryptedFile.iv,
          encryptionAlgorithm: encryptedFile.algorithm,
          mediaType: attachmentMediaTypeFromMime(file.type),
          originalFileName: file.name,
          originalMimeType: file.type || 'application/octet-stream',
        });
      }

      const response = await ticketChatService.sendMessage(ticketRefId, session.id, {
        message: '',
        files: encryptedFiles,
        encryptedMessage: encryptedMessage
          ? {
              ciphertext: encryptedMessage.ciphertext,
              iv: encryptedMessage.iv,
              algorithm: encryptedMessage.algorithm,
            }
          : null,
        attachmentMeta: encryptedAttachmentMeta,
      });

      if (!response.success) {
        toast({
          title: 'Message Failed',
          description: response.error || 'Could not send encrypted message.',
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
    } catch (error) {
      toast({
        title: 'Encryption Failed',
        description: error instanceof Error ? error.message : 'Could not encrypt message payload.',
        variant: 'destructive',
      });
    }
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
      setDownloadingPdf(false);
      return;
    }
    clearActiveSessionState();
    await loadOptions();
    toast({
      title: 'Transcript Downloaded',
      description: 'Chat was deleted from storage after download.',
    });
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
      const activeSession = sessionRef.current;
      if (activeSession) {
        void requestSessionDisconnectPurge(activeSession);
      }
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

  return (
    <Dialog open={open} onOpenChange={onDialogOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Ticket Chat {ticket ? `- ${displayTicketId(ticket)}` : ''}</DialogTitle>
          <DialogDescription>
            Local users can choose the department employee or assigned supervisor for this ticket. Officials are taken directly to chats received from the local user.
          </DialogDescription>
        </DialogHeader>

        {!ticket && <div className="text-sm text-muted-foreground">Select a ticket to open chat.</div>}

        {ticket && (
          <div className="space-y-4">
            {transportSecurityError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {transportSecurityError}
              </div>
            )}
            {(optionsLoading || !options || options.initiateEnabled || !options.chatVisible || (!session && !options.initiateEnabled)) && (
              <div className="rounded-md border border-border bg-muted/20 p-3">
                {optionsLoading && <div className="text-sm text-muted-foreground">Loading chat options...</div>}

                {!optionsLoading && options && !options.chatVisible && (
                  <div className="text-sm text-muted-foreground">
                    No chat has been received for this ticket yet. This official can only open chats started by the local user.
                  </div>
                )}

                {!optionsLoading && options && options.initiateEnabled && (
                  <div className="grid gap-3 md:grid-cols-4">
                    <div>
                      <label className="text-xs text-muted-foreground">Chat Channel</label>
                      {options.targetRoles.length > 1 ? (
                        <select
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={selectedTargetRole}
                          onChange={(event) => setSelectedTargetRole(event.target.value as TicketChatTargetRole)}
                          disabled={sessionLoading}
                        >
                          {options.targetRoles.map((entry) => (
                            <option key={entry.value} value={entry.value}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={options.targetRoles[0]?.label || 'N/A'}
                          disabled
                          className="mt-1"
                        />
                      )}
                    </div>

                    <div>
                      <label className="text-xs text-muted-foreground">
                        {selectedTargetRole === 'department' ? 'Department Employee' : 'Assigned Supervisor'}
                      </label>
                      {selectedTargetRole === 'department' && selectedTargetOptions.length > 0 ? (
                        <select
                          className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={selectedTargetUserId}
                          onChange={(event) => setSelectedTargetUserId(event.target.value)}
                          disabled={sessionLoading}
                        >
                          {selectedTargetOptions.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {userOptionLabel(entry)}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          value={selectedTargetUser ? userOptionLabel(selectedTargetUser) : 'Not assigned yet'}
                          disabled
                          className="mt-1"
                        />
                      )}
                    </div>

                    <div className="md:col-span-2 flex items-end">
                      <Button
                        className="h-10"
                        onClick={() => void handleStartOrOpenChat()}
                        disabled={sessionLoading || !selectedTargetRole || !selectedTargetUser?.id}
                      >
                        {sessionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {session ? 'Resume Chat' : 'Start Chat'}
                      </Button>
                    </div>
                  </div>
                )}

                {!optionsLoading && options && !options.initiateEnabled && options.chatVisible && !session && (
                  <div className="text-sm text-muted-foreground">
                    {sessionLoading ? 'Opening received chat...' : 'Unable to load the received chat.'}
                  </div>
                )}
              </div>
            )}

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
                      <span
                        className={cn(
                          'font-medium',
                          session.endedAt ? 'text-warning' : realtimeConnected ? 'text-success' : 'text-muted-foreground'
                        )}
                      >
                        {session.endedAt ? 'Ended' : realtimeConnected ? 'Connected' : 'Polling fallback'}
                      </span>
                    </div>
                    <div>
                      Encryption:{' '}
                      <span
                        className={cn(
                          'font-medium',
                          encryptionStatus === 'ready'
                            ? 'text-success'
                            : encryptionStatus === 'error' || encryptionStatus === 'unsupported'
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                        )}
                      >
                        {encryptionStatus === 'ready'
                          ? 'End-to-end encrypted'
                          : encryptionStatus === 'waiting-peer'
                            ? 'Waiting for peer key'
                            : encryptionStatus === 'error'
                              ? 'Encryption error'
                              : encryptionStatus === 'unsupported'
                                ? 'Unsupported'
                                : 'Initializing'}
                      </span>
                    </div>
                    {encryptionError && <div className="text-[11px] text-destructive">{encryptionError}</div>}
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
                      const isEncryptedEntry = Boolean(entry.encrypted && entry.messageCiphertext && entry.messageIv);
                      const decryptedText = isEncryptedEntry ? decryptedTextByMessageId[entry.id] : '';
                      const hasDecryptionFailure = Boolean(decryptionFailuresByMessageId[entry.id]);
                      const messageBody = isEncryptedEntry
                        ? decryptedText || (hasDecryptionFailure ? '[Unable to decrypt message]' : '[Encrypted message]')
                        : entry.message || '[Attachment]';
                      return (
                        <div key={entry.id} className={cn('flex', ownMessage ? 'justify-end' : 'justify-start')}>
                          <div
                            className={cn(
                              'max-w-[85%] rounded-lg border px-3 py-2 text-sm',
                              ownMessage
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-card text-foreground'
                            )}
                          >
                            <div className={cn('mb-1 text-[11px]', ownMessage ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                              {entry.senderName || 'User'}
                              {entry.senderRole ? ` (${String(entry.senderRole).replace(/_/g, ' ')})` : ''} | {formatTime(entry.createdAt)}
                            </div>
                            <div className="whitespace-pre-wrap break-words">{messageBody}</div>

                            {(entry.attachments || []).length > 0 && (
                              <div className="mt-2 space-y-2">
                                {(entry.attachments || []).map((attachment, index) => {
                                  const mediaType = (attachment.mediaType || 'file').toLowerCase();
                                  const attachmentLookupKey = `${entry.id}:${index}`;
                                  const url = attachment.encrypted
                                    ? decryptedAttachmentUrlByKey[attachmentLookupKey] || ''
                                    : attachment.url;
                                  const fileLabel =
                                    attachment.originalFileName || attachment.fileName || `Attachment ${index + 1}`;
                                  if (attachment.encrypted && !url) {
                                    return (
                                      <div
                                        key={`${entry.id}-att-${index}`}
                                        className="text-xs text-muted-foreground"
                                      >
                                        Decrypting attachment...
                                      </div>
                                    );
                                  }
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
                  {!session.endedAt && encryptionStatus !== 'ready' && (
                    <div className="text-xs text-muted-foreground">
                      Secure channel is not ready yet. Sending is disabled until key exchange completes.
                    </div>
                  )}

                  <Input
                    value={messageDraft}
                    onChange={(event) => setMessageDraft(event.target.value)}
                    placeholder="Type your message..."
                    disabled={!canSendEncryptedMessages || sending}
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
                        disabled={!canSendEncryptedMessages || sending}
                      >
                        <Paperclip className="mr-1 h-4 w-4" />
                        Upload Photo/Video
                      </Button>
                    </div>

                    <Button type="button" onClick={() => void handleSendMessage()} disabled={!canSendEncryptedMessages || sending}>
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
