const CHAT_PRIVATE_KEY_STORAGE = 'safelive_chat_e2ee_private_jwk_v1';
const CHAT_PUBLIC_KEY_STORAGE = 'safelive_chat_e2ee_public_jwk_v1';
const CHAT_PEER_FINGERPRINTS_STORAGE = 'safelive_chat_peer_fingerprints_v1';
const ECDH_CURVE = 'P-256';

export interface ChatIdentityKeyPair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  fingerprint: string;
  algorithm: 'ECDH-P256';
}

export interface ChatPeerTrustResult {
  status: 'new' | 'trusted' | 'changed';
  fingerprint: string;
  previousFingerprint?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const base64FromBytes = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
};

const bytesFromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const normalized = (value || '').trim();
  if (!normalized) return new Uint8Array(0);
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const cloneBytes = (bytes: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBuffer> => Uint8Array.from(bytes);

const exportPublicJwk = async (publicKey: CryptoKey): Promise<JsonWebKey> => {
  return (await crypto.subtle.exportKey('jwk', publicKey)) as JsonWebKey;
};

const exportPrivateJwk = async (privateKey: CryptoKey): Promise<JsonWebKey> => {
  return (await crypto.subtle.exportKey('jwk', privateKey)) as JsonWebKey;
};

const importPublicJwk = async (publicKeyJwk: JsonWebKey): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    true,
    []
  );
};

const importPrivateJwk = async (privateKeyJwk: JsonWebKey): Promise<CryptoKey> => {
  return crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    true,
    ['deriveBits']
  );
};

const normalizedJwkForFingerprint = (jwk: JsonWebKey): string => {
  const payload = {
    kty: String(jwk.kty || ''),
    crv: String(jwk.crv || ''),
    x: String(jwk.x || ''),
    y: String(jwk.y || ''),
  };
  return JSON.stringify(payload);
};

const computeFingerprint = async (publicKeyJwk: JsonWebKey): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalizedJwkForFingerprint(publicKeyJwk)));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
};

const readPeerFingerprintMap = (): Record<string, string> => {
  if (typeof window === 'undefined') return {};
  const value = window.localStorage.getItem(CHAT_PEER_FINGERPRINTS_STORAGE);
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed;
  } catch {
    return {};
  }
};

const storePeerFingerprintMap = (value: Record<string, string>): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CHAT_PEER_FINGERPRINTS_STORAGE, JSON.stringify(value));
};

const readStoredJwk = (key: string): JsonWebKey | null => {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as JsonWebKey;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
};

const storeJwk = (key: string, jwk: JsonWebKey): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(jwk));
};

const generateIdentity = async (): Promise<ChatIdentityKeyPair> => {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: ECDH_CURVE },
    true,
    ['deriveBits']
  )) as CryptoKeyPair;
  const publicKeyJwk = await exportPublicJwk(keyPair.publicKey);
  const privateKeyJwk = await exportPrivateJwk(keyPair.privateKey);
  storeJwk(CHAT_PUBLIC_KEY_STORAGE, publicKeyJwk);
  storeJwk(CHAT_PRIVATE_KEY_STORAGE, privateKeyJwk);
  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk,
    fingerprint: await computeFingerprint(publicKeyJwk),
    algorithm: 'ECDH-P256',
  };
};

export const isChatCryptoSupported = (): boolean => {
  return typeof window !== 'undefined' && typeof window.crypto?.subtle !== 'undefined';
};

export const computePublicKeyFingerprint = async (publicKeyJwk: JsonWebKey): Promise<string> => {
  return computeFingerprint(publicKeyJwk);
};

export const getOrCreateIdentityKeyPair = async (): Promise<ChatIdentityKeyPair> => {
  if (!isChatCryptoSupported()) {
    throw new Error('WebCrypto is not available in this browser.');
  }

  const storedPublicJwk = readStoredJwk(CHAT_PUBLIC_KEY_STORAGE);
  const storedPrivateJwk = readStoredJwk(CHAT_PRIVATE_KEY_STORAGE);
  if (storedPublicJwk && storedPrivateJwk) {
    try {
      const importedPublicKey = await importPublicJwk(storedPublicJwk);
      const importedPrivateKey = await importPrivateJwk(storedPrivateJwk);
      return {
        privateKey: importedPrivateKey,
        publicKey: importedPublicKey,
        publicKeyJwk: storedPublicJwk,
        fingerprint: await computeFingerprint(storedPublicJwk),
        algorithm: 'ECDH-P256',
      };
    } catch {
      // Fall through to regeneration when persisted keys are invalid.
    }
  }

  return generateIdentity();
};

export const deriveSessionEncryptionKey = async (
  sessionId: string,
  localPrivateKey: CryptoKey,
  peerPublicKeyJwk: JsonWebKey
): Promise<CryptoKey> => {
  const peerPublicKey = await importPublicJwk(peerPublicKeyJwk);
  const sharedSecretBits = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerPublicKey,
    },
    localPrivateKey,
    256
  );
  const sharedSecretBytes = new Uint8Array(sharedSecretBits);
  const hkdfMaterial = await crypto.subtle.importKey('raw', sharedSecretBytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(`safelive-chat-session:${sessionId}`),
      info: encoder.encode('message+attachment'),
    },
    hkdfMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

export const verifyOrStorePeerFingerprint = async (
  peerUserId: string,
  peerPublicKeyJwk: JsonWebKey
): Promise<ChatPeerTrustResult> => {
  const cleanPeerUserId = (peerUserId || '').trim();
  if (!cleanPeerUserId) {
    throw new Error('Peer user id is required for fingerprint verification.');
  }

  const nextFingerprint = await computeFingerprint(peerPublicKeyJwk);
  const knownMap = readPeerFingerprintMap();
  const previousFingerprint = (knownMap[cleanPeerUserId] || '').trim();
  if (!previousFingerprint) {
    knownMap[cleanPeerUserId] = nextFingerprint;
    storePeerFingerprintMap(knownMap);
    return {
      status: 'new',
      fingerprint: nextFingerprint,
    };
  }

  if (previousFingerprint !== nextFingerprint) {
    return {
      status: 'changed',
      fingerprint: nextFingerprint,
      previousFingerprint,
    };
  }

  return {
    status: 'trusted',
    fingerprint: nextFingerprint,
    previousFingerprint,
  };
};

export const encryptTextWithKey = async (
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; iv: string; algorithm: 'AES-GCM' }> => {
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const plaintextBytes = encoder.encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, plaintextBytes);
  return {
    ciphertext: base64FromBytes(new Uint8Array(cipherBuffer)),
    iv: base64FromBytes(ivBytes),
    algorithm: 'AES-GCM',
  };
};

export const decryptTextWithKey = async (
  key: CryptoKey,
  ciphertextBase64: string,
  ivBase64: string
): Promise<string> => {
  const ciphertextBytes = bytesFromBase64(ciphertextBase64);
  const ivBytes = bytesFromBase64(ivBase64);
  const plaintextBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, ciphertextBytes);
  return decoder.decode(plaintextBuffer);
};

export const encryptBytesWithKey = async (
  key: CryptoKey,
  bytes: Uint8Array<ArrayBufferLike>
): Promise<{ ciphertext: Uint8Array<ArrayBuffer>; iv: string; algorithm: 'AES-GCM' }> => {
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBytes }, key, cloneBytes(bytes));
  return {
    ciphertext: new Uint8Array(cipherBuffer),
    iv: base64FromBytes(ivBytes),
    algorithm: 'AES-GCM',
  };
};

export const decryptBytesWithKey = async (
  key: CryptoKey,
  ciphertext: Uint8Array<ArrayBufferLike>,
  ivBase64: string
): Promise<Uint8Array<ArrayBuffer>> => {
  const ivBytes = bytesFromBase64(ivBase64);
  const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, key, cloneBytes(ciphertext));
  return new Uint8Array(plainBuffer);
};
