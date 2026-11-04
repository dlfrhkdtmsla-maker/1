'use strict';

// 비밀번호로 암호화 키를 보호한다. 비밀번호와 풀린 키는 저장하지 않고 메모리에만 둔다.
const vault = (() => {
  const ITERATIONS = 600000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let dataKey = null;

  const randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));
  const importDataKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

  async function deriveKey(passcode, salt, iterations) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async function wrap(raw, passcode) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveKey(passcode, salt, ITERATIONS);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
    return { salt, iv, iterations: ITERATIONS, data };
  }

  async function unwrap(record, passcode) {
    const key = await deriveKey(passcode, record.salt, record.iterations);
    try {
      return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, key, record.data);
    } catch {
      return null;
    }
  }

  async function encryptBytes(bytes) {
    const iv = randomBytes(12);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, bytes);
    return { iv, data };
  }

  const decryptBytes = ({ iv, data }) => crypto.subtle.decrypt({ name: 'AES-GCM', iv }, dataKey, data);

  return {
    get unlocked() { return dataKey !== null; },

    async create(passcode) {
      const raw = randomBytes(32);
      dataKey = await importDataKey(raw);
      return wrap(raw, passcode);
    },

    async unlock(record, passcode) {
      const raw = await unwrap(record, passcode);
      if (!raw) return false;
      dataKey = await importDataKey(raw);
      return true;
    },

    async rewrap(record, oldPasscode, newPasscode) {
      const raw = await unwrap(record, oldPasscode);
      return raw ? wrap(raw, newPasscode) : null;
    },

    lock() { dataKey = null; },

    encryptJson: (value) => encryptBytes(encoder.encode(JSON.stringify(value))),
    decryptJson: async (encrypted) => JSON.parse(decoder.decode(await decryptBytes(encrypted))),

    async encryptBlob(blob) {
      return { ...await encryptBytes(await blob.arrayBuffer()), type: blob.type };
    },
    async decryptBlob(encrypted) {
      return new Blob([await decryptBytes(encrypted)], { type: encrypted.type });
    },
  };
})();
