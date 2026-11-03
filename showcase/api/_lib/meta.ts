import { lookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import type { Environment } from './http.js';

export const META_ENDPOINT = 'https://api.meta.ai/v1/chat/completions';
const META_HOST = 'api.meta.ai';
const MAX_UPSTREAM_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 20_000;

export type MetaPayload = Record<string, unknown>;
export type MetaAdapter = (payload: MetaPayload, apiKey: string, signal: AbortSignal) => Promise<Response>;
export type ResolvedAddress = { address: string; family: number };

export interface MetaTransportDependencies {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: (options: RequestOptions, body: string, signal: AbortSignal, maxBytes: number) => Promise<Response>;
}

function ipv4ToNumber(address: string): number {
  const octets = address.split('.').map(Number);
  return (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 + octets[3]!) >>> 0;
}

function inV4Range(ip: number, base: string, prefix: number): boolean {
  const start = ipv4ToNumber(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (start & mask);
}

function publicIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const ip = ipv4ToNumber(address);
  const denied: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ];
  return !denied.some(([base, prefix]) => inV4Range(ip, base, prefix));
}

function ipv6Groups(address: string): number[] | undefined {
  if (address.includes('%') || address.includes('.')) return undefined;
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...left, ...right].some((part) => !/^[\da-f]{1,4}$/.test(part))) return undefined;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  return [...left.map((part) => Number.parseInt(part, 16)), ...Array.from({ length: missing }, () => 0), ...right.map((part) => Number.parseInt(part, 16))];
}

function publicIpv6(address: string): boolean {
  if (isIP(address) !== 6) return false;
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const first = groups[0]!;
  const second = groups[1]!;
  // Only global-unicast 2000::/3 is eligible. Exclude protocol assignments,
  // documentation, 6to4, and the current documentation prefix.
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && ((second & 0xfe00) === 0 || second === 0x0db8 || (second >= 0x20 && second <= 0x2f))) return false;
  if (first === 0x2002) return false;
  if (first === 0x3fff && (second & 0xf000) === 0) return false;
  return true;
}

export function isPublicAddress(address: string, family = isIP(address)): boolean {
  if (family === 4) return publicIpv4(address);
  if (family === 6) return publicIpv6(address);
  return false;
}

async function resolvePublicAddresses(hostname: string): Promise<ResolvedAddress[]> {
  if (hostname !== META_HOST) throw new Error('invalid upstream host');
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) {
    throw new Error('upstream DNS did not resolve exclusively to public addresses');
  }
  return addresses;
}

function pinnedHttpsRequest(options: RequestOptions, body: string, signal: AbortSignal, maxBytes: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('upstream request aborted'));
      return;
    }
    const request = httpsRequest(options, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes > maxBytes) {
          request.destroy(new Error('upstream response exceeded size limit'));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        const headers = new Headers();
        const contentType = response.headers['content-type'];
        if (typeof contentType === 'string') headers.set('content-type', contentType);
        resolve(new Response(Buffer.concat(chunks), { status: response.statusCode ?? 502, headers }));
      });
      response.on('error', reject);
    });
    const abort = () => request.destroy(new Error('upstream request aborted'));
    signal.addEventListener('abort', abort, { once: true });
    request.on('close', () => signal.removeEventListener('abort', abort));
    request.on('error', reject);
    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => request.destroy(new Error('upstream request timed out')));
    request.end(body);
  });
}

export function createMetaAdapter(_env: Environment, dependencies: MetaTransportDependencies = {}): MetaAdapter {
  const resolve = dependencies.resolve ?? resolvePublicAddresses;
  const send = dependencies.request ?? pinnedHttpsRequest;
  return async (payload, apiKey, signal) => {
    const addresses = await resolve(META_HOST);
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address, entry.family))) {
      throw new Error('upstream DNS did not resolve exclusively to public addresses');
    }
    const pinned = addresses.find((entry) => entry.family === 4) ?? addresses[0]!;
    const requestOptions: RequestOptions = {
      protocol: 'https:',
      hostname: META_HOST,
      servername: META_HOST,
      port: 443,
      path: '/v1/chat/completions',
      method: 'POST',
      rejectUnauthorized: true,
      lookup: (_hostname, options, callback) => {
        if (options && typeof options === 'object' && 'all' in options && options.all) {
          (callback as unknown as (error: NodeJS.ErrnoException | null, addresses: ResolvedAddress[]) => void)(null, [pinned]);
        } else {
          (callback as unknown as (error: NodeJS.ErrnoException | null, address: string, family: number) => void)(null, pinned.address, pinned.family);
        }
      },
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    return send(requestOptions, JSON.stringify(payload), signal, MAX_UPSTREAM_BYTES);
  };
}
