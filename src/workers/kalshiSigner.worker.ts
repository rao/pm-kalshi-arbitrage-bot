/**
 * Bun Worker for Kalshi RSA-PSS signing.
 *
 * Offloads CPU-bound RSA-PSS signature generation (5-20ms) to a dedicated
 * thread so it doesn't block the main event loop during order submission.
 *
 * Protocol:
 *   Main -> Worker: { id, type: "sign", timestamp, method, path }
 *   Main -> Worker: { id, type: "init", apiKeyId, keyPem }
 *   Worker -> Main: { id, headers } | { id, error }
 */

declare var self: Worker;

let privateKey: CryptoKey | null = null;
let apiKeyId: string = "";

async function loadKey(keyPem: string): Promise<CryptoKey> {
  const isPkcs1 = keyPem.includes("-----BEGIN RSA PRIVATE KEY-----");

  const pemLines = keyPem.split("\n");
  const base64Content = pemLines
    .filter(
      (line) =>
        !line.startsWith("-----BEGIN") &&
        !line.startsWith("-----END") &&
        line.trim() !== ""
    )
    .join("");

  let binaryKey = Uint8Array.from(atob(base64Content), (c) => c.charCodeAt(0));

  if (isPkcs1) {
    binaryKey = convertPkcs1ToPkcs8(binaryKey);
  }

  return crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSA-PSS", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function convertPkcs1ToPkcs8(pkcs1Key: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const algorithmId = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09,
    0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d,
    0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  const octetStringHeader = encodeAsn1Length(0x04, pkcs1Key.length);
  const innerLength = version.length + algorithmId.length + octetStringHeader.length + pkcs1Key.length;
  const sequenceHeader = encodeAsn1Length(0x30, innerLength);

  const pkcs8Key = new Uint8Array(
    sequenceHeader.length + version.length + algorithmId.length + octetStringHeader.length + pkcs1Key.length
  );
  let offset = 0;
  pkcs8Key.set(sequenceHeader, offset); offset += sequenceHeader.length;
  pkcs8Key.set(version, offset); offset += version.length;
  pkcs8Key.set(algorithmId, offset); offset += algorithmId.length;
  pkcs8Key.set(octetStringHeader, offset); offset += octetStringHeader.length;
  pkcs8Key.set(pkcs1Key, offset);
  return pkcs8Key;
}

function encodeAsn1Length(tag: number, length: number): Uint8Array {
  if (length < 128) return new Uint8Array([tag, length]);
  if (length < 256) return new Uint8Array([tag, 0x81, length]);
  if (length < 65536) return new Uint8Array([tag, 0x82, (length >> 8) & 0xff, length & 0xff]);
  return new Uint8Array([tag, 0x83, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff]);
}

async function signRequest(
  key: CryptoKey,
  timestamp: string,
  method: string,
  path: string
): Promise<string> {
  const pathWithoutQuery = path.split("?")[0];
  const message = `${timestamp}${method}${pathWithoutQuery}`;
  const encoder = new TextEncoder();
  const messageBytes = encoder.encode(message);

  const signature = await crypto.subtle.sign(
    { name: "RSA-PSS", saltLength: 32 },
    key,
    messageBytes
  );

  const signatureBytes = new Uint8Array(signature);
  return btoa(String.fromCharCode(...signatureBytes));
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === "init") {
    try {
      apiKeyId = msg.apiKeyId;
      // Load key from PEM string or file
      let keyPem: string;
      if (msg.keyPem.includes("-----BEGIN")) {
        keyPem = msg.keyPem;
      } else {
        // It's a file path — read it
        const file = Bun.file(msg.keyPem);
        keyPem = await file.text();
      }
      privateKey = await loadKey(keyPem);
      self.postMessage({ id: msg.id, success: true });
    } catch (err) {
      self.postMessage({ id: msg.id, error: String(err) });
    }
    return;
  }

  if (msg.type === "sign") {
    try {
      if (!privateKey) {
        self.postMessage({ id: msg.id, error: "Worker not initialized" });
        return;
      }

      const ts = msg.timestamp || Date.now().toString();
      const signature = await signRequest(privateKey, ts, msg.method, msg.path);

      self.postMessage({
        id: msg.id,
        headers: {
          "KALSHI-ACCESS-KEY": apiKeyId,
          "KALSHI-ACCESS-SIGNATURE": signature,
          "KALSHI-ACCESS-TIMESTAMP": ts,
        },
      });
    } catch (err) {
      self.postMessage({ id: msg.id, error: String(err) });
    }
    return;
  }

  self.postMessage({ id: msg.id, error: `Unknown message type: ${msg.type}` });
};
