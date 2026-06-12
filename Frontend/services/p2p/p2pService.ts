/**
 * p2pService.ts  —  Unified GitLane P2P Transfer Service
 *
 * Transfer methods in one file:
 *   1. File Share      — OS share sheet (AirDrop / Nearby Share / Bluetooth). Fully offline.
 *   2. WebSocket Relay — WebSocket relay via PieSocket. Requires internet.
 */

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as Network from 'expo-network';
import { gitEngine } from '@/services/git/engine';
import type { GitFile } from '@/types/git';

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'context' | 'added' | 'removed' | 'hunk' | 'header';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffFile {
  filepath: string;
  oldFilepath?: string;
  changeType: 'M' | 'A' | 'D' | 'R';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface PatchPayload {
  type: 'gitlane-patch';
  version: '2.0';
  sessionToken: string;
  repoName: string;
  repoId: string;
  commits: string[];
  senderName: string;
  senderDevice: string;
  timestamp: number;
  diffFiles: DiffFile[];
}

// ─── Section 1: Core Utilities ────────────────────────────────────────────────

export function generateSessionToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let t = '';
  for (let i = 0; i < 8; i++) t += chars[Math.floor(Math.random() * chars.length)];
  return t;
}

export async function getDeviceIP(): Promise<string> {
  try {
    return (await Network.getIpAddressAsync()) || '127.0.0.1';
  } catch {
    return '127.0.0.1';
  }
}

// ─── Section 2: Diff Engine ───────────────────────────────────────────────────

const CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 2000;
const PATCH_MIME = 'application/json';

type EditOp = { op: 'keep' | 'add' | 'del'; text: string };

function myersDiff(a: string[], b: string[]): EditOp[] {
  const n = a.length, m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map(text => ({ op: 'add' as const, text }));
  if (m === 0) return a.map(text => ({ op: 'del' as const, text }));
  if (n + m > MAX_DIFF_LINES)
    return [...a.map(t => ({ op: 'del' as const, text: t })), ...b.map(t => ({ op: 'add' as const, text: t }))];

  const max = n + m, offset = max + 1, size = 2 * max + 3;
  const v = new Int32Array(size).fill(-1);
  const history: Int32Array[] = [];
  v[offset + 1] = 0;
  let foundD = -1;

  outer: for (let d = 0; d <= max; d++) {
    history.push(Int32Array.from(v));
    for (let k = -d; k <= d; k += 2) {
      const ki = k + offset;
      let x = (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) ? v[ki + 1] : v[ki - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[ki] = x;
      if (x >= n && y >= m) { foundD = d; break outer; }
    }
  }

  if (foundD < 0)
    return [...a.map(t => ({ op: 'del' as const, text: t })), ...b.map(t => ({ op: 'add' as const, text: t }))];

  const script: EditOp[] = [];
  let x = n, y = m;
  for (let d = foundD; d > 0; d--) {
    const vh = history[d], k = x - y, ki = k + offset;
    const prevK = (k === -d || (k !== d && vh[ki - 1] < vh[ki + 1])) ? k + 1 : k - 1;
    const prevX = vh[prevK + offset], prevY = prevX - prevK;
    while (x > prevX && y > prevY) { script.unshift({ op: 'keep', text: a[x - 1] }); x--; y--; }
    if (x === prevX) { script.unshift({ op: 'add', text: b[y - 1] }); y--; }
    else { script.unshift({ op: 'del', text: a[x - 1] }); x--; }
  }
  while (x > 0 && y > 0) { script.unshift({ op: 'keep', text: a[x - 1] }); x--; y--; }
  return script;
}

function buildHunks(script: EditOp[]): DiffHunk[] {
  const n = script.length;
  if (n === 0) return [];
  const changeAt = script.reduce<number[]>((acc, s, i) => { if (s.op !== 'keep') acc.push(i); return acc; }, []);
  if (changeAt.length === 0) return [];

  const spans: Array<[number, number]> = [];
  let start = Math.max(0, changeAt[0] - CONTEXT_LINES);
  let end = Math.min(n - 1, changeAt[0] + CONTEXT_LINES);
  for (let ci = 1; ci < changeAt.length; ci++) {
    const ns = Math.max(0, changeAt[ci] - CONTEXT_LINES);
    if (ns <= end + 1) { end = Math.min(n - 1, changeAt[ci] + CONTEXT_LINES); }
    else { spans.push([start, end]); start = ns; end = Math.min(n - 1, changeAt[ci] + CONTEXT_LINES); }
  }
  spans.push([start, end]);

  return spans.map(([spanStart, spanEnd]) => {
    let oldBase = 1, newBase = 1;
    for (let i = 0; i < spanStart; i++) {
      if (script[i].op !== 'add') oldBase++;
      if (script[i].op !== 'del') newBase++;
    }
    let oldCount = 0, newCount = 0;
    const lines: DiffLine[] = [];
    for (let i = spanStart; i <= spanEnd; i++) {
      const { op, text } = script[i];
      if (op === 'keep') { lines.push({ type: 'context', content: ' ' + text, oldLineNo: oldBase + oldCount, newLineNo: newBase + newCount }); oldCount++; newCount++; }
      else if (op === 'del') { lines.push({ type: 'removed', content: '-' + text, oldLineNo: oldBase + oldCount }); oldCount++; }
      else { lines.push({ type: 'added', content: '+' + text, newLineNo: newBase + newCount }); newCount++; }
    }
    return { header: `@@ -${oldBase},${oldCount} +${newBase},${newCount} @@`, lines };
  });
}

function isBinary(content: string): boolean {
  return content.slice(0, 8192).includes('\x00');
}

function diffFileFromBlobs(filepath: string, oldContent: string, newContent: string, changeType: 'M' | 'A' | 'D'): DiffFile {
  if (isBinary(oldContent) || isBinary(newContent))
    return { filepath, changeType, additions: 0, deletions: 0, hunks: [{ header: '@@ binary file @@', lines: [{ type: 'header', content: ' Binary file — content not shown' }] }] };

  const oldLines = oldContent ? oldContent.split('\n') : [];
  const newLines = newContent ? newContent.split('\n') : [];
  if (oldLines[oldLines.length - 1] === '') oldLines.pop();
  if (newLines[newLines.length - 1] === '') newLines.pop();

  if (changeType === 'A') {
    const lines: DiffLine[] = newLines.map((text, i) => ({ type: 'added' as const, content: '+' + text, newLineNo: i + 1 }));
    return { filepath, changeType: 'A', additions: newLines.length, deletions: 0, hunks: lines.length > 0 ? [{ header: `@@ -0,0 +1,${newLines.length} @@`, lines }] : [] };
  }
  if (changeType === 'D') {
    const lines: DiffLine[] = oldLines.map((text, i) => ({ type: 'removed' as const, content: '-' + text, oldLineNo: i + 1 }));
    return { filepath, changeType: 'D', additions: 0, deletions: oldLines.length, hunks: lines.length > 0 ? [{ header: `@@ -1,${oldLines.length} +0,0 @@`, lines }] : [] };
  }
  const script = myersDiff(oldLines, newLines);
  return { filepath, changeType, additions: script.filter(s => s.op === 'add').length, deletions: script.filter(s => s.op === 'del').length, hunks: buildHunks(script) };
}

export async function buildLocalDiffFiles(repoId: string, commitShas: string[]): Promise<DiffFile[]> {
  console.log(`[P2P] buildLocalDiffFiles — repoId=${repoId}, ${commitShas.length} commits:`, commitShas.map(s => s.slice(0, 7)));
  const blobMap = new Map<string, { oldContent: string; newContent: string; changeType: 'M' | 'A' | 'D' }>();
  let successCount = 0;
  let failCount = 0;
  for (const sha of commitShas) {
    try {
      console.log(`[P2P] Processing commit ${sha.slice(0, 7)}...`);
      const entries = await gitEngine.getCommitDiff(repoId, sha);
      console.log(`[P2P] getCommitDiff(${sha.slice(0, 7)}) returned:`, entries ? entries.length : 'null/undefined', 'entries');
      if (!entries || !Array.isArray(entries)) {
        console.warn(`[P2P] getCommitDiff(${sha.slice(0, 7)}) returned empty/non-array:`, typeof entries);
        failCount++;
        continue;
      }
      successCount++;
      for (const entry of entries) {
        console.log(`[P2P] Commit ${sha.slice(0, 7)} modified:`, entry.filepath, entry.changeType);
        const existing = blobMap.get(entry.filepath);
        if (!existing) {
          blobMap.set(entry.filepath, { oldContent: entry.oldContent, newContent: entry.newContent, changeType: entry.changeType });
        } else {
          existing.newContent = entry.newContent;
          if (existing.changeType === 'A' && entry.changeType === 'D') existing.changeType = 'D';
          else if (existing.changeType !== 'D') existing.changeType = entry.changeType;
        }
      }
    } catch (err: any) {
      failCount++;
      console.warn(`[P2P] getCommitDiff THREW for ${sha.slice(0, 7)}:`, err?.message ?? err);
    }
  }
  console.log(`[P2P] buildLocalDiffFiles done — success=${successCount}, fail=${failCount}, files=${blobMap.size}`);
  if (blobMap.size === 0) {
    console.log(`[P2P] ⚠️  Zero files found! Empty commits or all getCommitDiff calls failed.`);

    // Fallback: send a snapshot of the current working tree so that P2P
    // still transfers useful data even if commit-level diffing yields
    // nothing (e.g. empty commits, unusual histories, or engines that
    // cannot compute tree diffs for this repo).
    try {
      const tree = await gitEngine.getWorkingTree(repoId);
      const files: DiffFile[] = [];

      const visit = (nodes: GitFile[]) => {
        for (const node of nodes) {
          if (node.isDirectory && node.children) {
            visit(node.children);
          } else if (!node.isDirectory && typeof node.content === 'string') {
            const relPath = node.path.startsWith('/') ? node.path.slice(1) : node.path;
            files.push(
              diffFileFromBlobs(relPath, '', node.content, 'A')
            );
          }
        }
      };

      visit(tree);
      console.log(`[P2P] Snapshot fallback produced ${files.length} files`);
      if (files.length > 0) return files;
    } catch (err: any) {
      console.warn('[P2P] Snapshot fallback failed:', err?.message ?? err);
    }
  }
  if (blobMap.size === 0) return [];
  return Array.from(blobMap.entries()).map(([filepath, { oldContent, newContent, changeType }]) =>
    diffFileFromBlobs(filepath, oldContent, newContent, changeType)
  );
}

// ─── Section 3: File Share (AirDrop / Nearby Share / Bluetooth) ───────────────

export async function sharePatch(
  repoId: string,
  repoName: string,
  senderName: string,
  commitShas: string[],
): Promise<{ payload: PatchPayload; fileUri: string }> {
  const token = generateSessionToken();
  const senderDevice = await getDeviceIP();
  const diffFiles = await buildLocalDiffFiles(repoId, commitShas);
  const payload: PatchPayload = {
    type: 'gitlane-patch', version: '2.0', sessionToken: token,
    repoName, repoId, commits: commitShas, senderName, senderDevice,
    timestamp: Date.now(), diffFiles,
  };
  const fileName = `gitlane-${token}.gitlanepatch`;
  const fileUri = `${Paths.cache.uri.replace(/\/$/, '')}/${fileName}`;
  const file = new File(fileUri);
  if (!file.exists) file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(payload, null, 2));
  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(fileUri, { mimeType: PATCH_MIME, dialogTitle: `Share GitLane patch — ${repoName}`, UTI: 'public.json' });
  return { payload, fileUri };
}

export async function importPatch(): Promise<PatchPayload | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets?.length) return null;
  const raw = await new File(result.assets[0].uri).text();
  const parsed = JSON.parse(raw) as PatchPayload;
  if (parsed.type !== 'gitlane-patch') throw new Error('Not a valid GitLane patch file.');
  return parsed;
}

export async function deletePatchFile(fileUri: string): Promise<void> {
  try { const f = new File(fileUri); if (f.exists) f.delete(); } catch { /* ignore */ }
}

// ─── Section 4: WebSocket Relay ────────────────────────────────────────────────
//
//  Relay config — either use your PieSocket app or fall back.
//  Set EXPO_PUBLIC_PIESOCKET_KEY to your PieSocket API key and we will use
//  the free.blr2 PieSocket cluster with the session token as channel id.
//  If not set, we fall back to the generic ws.vi-server.org mirror.

const PIE_SOCKET_KEY = process.env.EXPO_PUBLIC_PIESOCKET_KEY;

const RELAY_URL = (ch: string) =>
  PIE_SOCKET_KEY
    ? `wss://free.blr2.piesocket.com/v3/${ch}?api_key=${PIE_SOCKET_KEY}&notify_self=1`
    : `wss://ws.vi-server.org/mirror`;

const RELAY_CHANNEL = 'gitlane';

const DEEP_LINK_SCHEME = 'gitlane://live/';
const CHUNK_SIZE = 4096;   // safe under every relay's message-size limit
const HEARTBEAT_MS = 1500; // aggressive keep-alive

type LiveRole = 'sender' | 'receiver';
type LiveMsg =
  | { type: 'HELLO'; role: LiveRole; _sid?: string }
  | { type: 'READY'; _sid?: string }
  | { type: 'META'; repoName: string; repoId: string; senderName: string; senderDevice: string; sessionToken: string; totalChunks: number; commitCount: number; timestamp: number; _sid?: string }
  | { type: 'CHUNK'; idx: number; data: string; _sid?: string }
  | { type: 'COMPLETE'; _sid?: string }
  | { type: 'ACK'; _sid?: string }
  | { type: 'ERROR'; message: string; _sid?: string };

export type LiveStatus = 'connecting' | 'waiting-peer' | 'building' | 'transferring' | 'complete' | 'error';
export interface LiveProgress { sent: number; total: number }

export interface SenderSession { token: string; qrData: string; cancel: () => void }
export interface ReceiverSession { cancel: () => void }

export interface SenderCallbacks {
  onStatus: (s: LiveStatus) => void;
  onProgress: (p: LiveProgress) => void;
  onError: (msg: string) => void;
}
export interface ReceiverCallbacks {
  onStatus: (s: LiveStatus) => void;
  onProgress: (p: LiveProgress) => void;
  onPayload: (payload: PatchPayload) => void;
  onError: (msg: string) => void;
}

/**
 * Parse a raw WebSocket message with simple JSON format.
 */
function parseRelayMsg(raw: unknown, mySid: string): LiveMsg | null {
  try {
    let parsed: any;
    if (typeof raw === 'string') {
      parsed = JSON.parse(raw);
    } else if (typeof raw === 'object' && raw !== null) {
      parsed = raw;
    } else {
      return null;
    }

    // Handle our message format
    if (parsed && typeof parsed.type === 'string') {
      // Drop self-echoes (only if _sid matches)
      if (parsed._sid && parsed._sid === mySid) return null;
      return parsed as LiveMsg;
    }

    console.log('[Relay] parseRelayMsg — unrecognised frame:', JSON.stringify(parsed).slice(0, 200));
    return null;
  } catch {
    return null;
  }
}

function wsSend(ws: WebSocket, msg: LiveMsg, sid: string) {
  if (ws.readyState === WebSocket.OPEN) {
    // Send simple JSON format
    ws.send(JSON.stringify({ ...msg, _sid: sid }));
  }
}

function chunkString(str: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

function openRelay(channel: string): Promise<WebSocket> {
  const url = RELAY_URL(channel);
  console.log('[Relay] Connecting →', url.replace(/api_key=[^&]+/, 'api_key=***'));
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      console.log('[Relay] ⏰ Timed out after 10 s');
      ws.onopen = null; ws.onerror = null;
      ws.close();
      reject(new Error('Relay connection timed out.'));
    }, 10_000);
    ws.onopen = () => {
      clearTimeout(timer);
      console.log('[Relay] ✅ WebSocket OPEN — channel gl_' + channel);
      resolve(ws);
    };
    ws.onerror = (e: any) => {
      clearTimeout(timer);
      console.log('[Relay] ❌ WebSocket ERROR on connect:', e?.message ?? e);
      reject(new Error('Relay connection failed.'));
    };
  });
}

export async function startSenderSession(
  repoId: string,
  repoName: string,
  senderName: string,
  commitShas: string[],
  callbacks: SenderCallbacks,
): Promise<SenderSession> {
  const token = generateSessionToken();
  const sid = 's_' + Math.random().toString(36).slice(2, 10);
  const qrData = DEEP_LINK_SCHEME + token;
  let cancelled = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  console.log(`[Relay:Sender] session start — token=${token}  sid=${sid}`);
  console.log(`[Relay:Sender] commitShas from UI (${commitShas.length}):`, commitShas.map(s => s.slice(0, 7)));

  // ── Step 1: Connect immediately ──
  callbacks.onStatus('connecting');
  let ws: WebSocket;
  try {
    ws = await openRelay(token);
  } catch {
    callbacks.onStatus('error');
    callbacks.onError('Could not reach relay server. Check your internet connection.');
    return { token, qrData, cancel: () => { cancelled = true; } };
  }
  if (cancelled) { ws.close(); return { token, qrData, cancel: () => {} }; }

  // ── Step 2: Shared mutable state ──
  let chunks: string[] = [];
  let senderDeviceCached = '127.0.0.1';
  let diffReady = false;
  let receiverJoined = false;
  let transferStarted = false;

  // ── Step 3: startTransfer — declared BEFORE callers ──
  function startTransfer() {
    if (transferStarted || !diffReady || !receiverJoined) return;
    transferStarted = true;
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (cancelled || ws.readyState !== WebSocket.OPEN) return;
    console.log(`[Relay:Sender] 🚀 Transfer go — ${chunks.length} chunks`);
    callbacks.onStatus('transferring');
    wsSend(ws, {
      type: 'META', repoName, repoId, senderName, senderDevice: senderDeviceCached,
      sessionToken: token, totalChunks: chunks.length,
      commitCount: commitShas.length, timestamp: Date.now(),
    }, sid);
    let idx = 0;
    const sendNext = () => {
      if (cancelled || ws.readyState !== WebSocket.OPEN) return;
      if (idx >= chunks.length) {
        wsSend(ws, { type: 'COMPLETE' }, sid);
        console.log('[Relay:Sender] ✅ COMPLETE sent');
        callbacks.onStatus('complete');
        return;
      }
      wsSend(ws, { type: 'CHUNK', idx, data: chunks[idx] }, sid);
      callbacks.onProgress({ sent: idx + 1, total: chunks.length });
      idx++;
      setTimeout(sendNext, 30);
    };
    sendNext();
  }

  // ── Step 4: Announce + build diff in parallel ──
  wsSend(ws, { type: 'HELLO', role: 'sender' }, sid);
  callbacks.onStatus('building');
  console.log('[Relay:Sender] HELLO sent, building diffs…');

  Promise.all([
    buildLocalDiffFiles(repoId, commitShas).catch(() => [] as DiffFile[]),
    getDeviceIP(),
  ]).then(([diffFiles, senderDevice]) => {
    if (cancelled) return;
    senderDeviceCached = senderDevice;
    const payload: PatchPayload = {
      type: 'gitlane-patch', version: '2.0', sessionToken: token,
      repoName, repoId, commits: commitShas, senderName, senderDevice,
      timestamp: Date.now(), diffFiles,
    };
    chunks = chunkString(JSON.stringify(payload), CHUNK_SIZE);
    diffReady = true;
    console.log(`[Relay:Sender] ✅ Diff ready — ${diffFiles.length} files, ${chunks.length} chunks`);
    if (ws.readyState === WebSocket.OPEN) {
      wsSend(ws, { type: 'READY' }, sid);
      if (!receiverJoined) callbacks.onStatus('waiting-peer');
    }
    if (receiverJoined) startTransfer();
  }).catch((e) => {
    console.log('[Relay:Sender] ❌ Diff build error:', e);
    if (!cancelled) { callbacks.onStatus('error'); callbacks.onError('Failed to compute diffs.'); }
  });

  // ── Step 5: Heartbeat ──
  heartbeat = setInterval(() => {
    if (cancelled || ws.readyState !== WebSocket.OPEN) {
      if (heartbeat) clearInterval(heartbeat);
      return;
    }
    wsSend(ws, { type: 'HELLO', role: 'sender' }, sid);
  }, HEARTBEAT_MS);

  // ── Step 6: Listen ──
  ws.onmessage = (evt) => {
    if (cancelled) return;
    const msg = parseRelayMsg(evt.data, sid);
    if (!msg) return;
    console.log('[Relay:Sender] ← rx:', msg.type, (msg as any).role ?? '');
    if (msg.type === 'HELLO' && msg.role === 'receiver') {
      if (!receiverJoined) console.log('[Relay:Sender] 🤝 Receiver joined!');
      receiverJoined = true;
      wsSend(ws, { type: 'HELLO', role: 'sender' }, sid);
      if (diffReady) startTransfer();
    }
  };
  ws.onclose = (ev) => {
    console.log(`[Relay:Sender] WS CLOSED code=${ev.code} reason=${ev.reason}`);
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (!cancelled && !transferStarted) {
      callbacks.onStatus('error');
      callbacks.onError('Relay connection closed unexpectedly.');
    }
  };
  ws.onerror = (e: any) => {
    console.log('[Relay:Sender] WS ERROR:', e?.message ?? e);
    if (!cancelled) { callbacks.onStatus('error'); callbacks.onError('Relay connection dropped.'); }
  };

  return {
    token, qrData,
    cancel: () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      ws?.close();
      console.log('[Relay:Sender] Cancelled');
    },
  };
}

export function joinReceiverSession(token: string, callbacks: ReceiverCallbacks): ReceiverSession {
  const sid = 'r_' + Math.random().toString(36).slice(2, 10);
  let cancelled = false;
  const buffer: string[] = [];
  let totalChunks = 0;
  let metaReceived = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let wsRef: WebSocket | null = null;

  console.log(`[Relay:Receiver] Joining — token=${token}  sid=${sid}`);
  callbacks.onStatus('connecting');

  openRelay(token).then((ws) => {
    wsRef = ws;
    if (cancelled) { ws.close(); return; }

    wsSend(ws, { type: 'HELLO', role: 'receiver' }, sid);
    callbacks.onStatus('waiting-peer');
    console.log('[Relay:Receiver] HELLO sent, waiting for sender…');

    // Heartbeat until META received
    heartbeat = setInterval(() => {
      if (cancelled || ws.readyState !== WebSocket.OPEN) {
        if (heartbeat) clearInterval(heartbeat);
        return;
      }
      if (!metaReceived) wsSend(ws, { type: 'HELLO', role: 'receiver' }, sid);
    }, HEARTBEAT_MS);

    ws.onmessage = (evt) => {
      if (cancelled) return;
      const msg = parseRelayMsg(evt.data, sid);
      if (!msg) return;
      console.log('[Relay:Receiver] ← rx:', msg.type, (msg as any).role ?? '');

      switch (msg.type) {
        case 'HELLO':
          if (!metaReceived) {
            console.log('[Relay:Receiver] 🤝 Sender alive, replying HELLO');
            wsSend(ws, { type: 'HELLO', role: 'receiver' }, sid);
          }
          break;

        case 'READY':
          console.log('[Relay:Receiver] Sender diff READY');
          if (!metaReceived) wsSend(ws, { type: 'HELLO', role: 'receiver' }, sid);
          break;

        case 'META':
          if (metaReceived) break;
          metaReceived = true;
          if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
          totalChunks = msg.totalChunks;
          buffer.length = 0;
          console.log(`[Relay:Receiver] 📦 META — ${totalChunks} chunks expected`);
          callbacks.onStatus('transferring');
          wsSend(ws, { type: 'ACK' }, sid);
          break;

        case 'CHUNK':
          if (msg.idx >= 0 && msg.idx < totalChunks) {
            buffer[msg.idx] = msg.data;
            const rcvd = buffer.filter(Boolean).length;
            callbacks.onProgress({ sent: rcvd, total: totalChunks });
            if (rcvd % 10 === 0) console.log(`[Relay:Receiver] chunks ${rcvd}/${totalChunks}`);
          }
          break;

        case 'COMPLETE': {
          const received = buffer.filter(Boolean).length;
          console.log(`[Relay:Receiver] COMPLETE — ${received}/${totalChunks}`);
          if (received < totalChunks) {
            callbacks.onError(`Incomplete: received ${received}/${totalChunks} chunks.`);
            callbacks.onStatus('error'); return;
          }
          try {
            const p = JSON.parse(buffer.join('')) as PatchPayload;
            if (p.type !== 'gitlane-patch') throw new Error('Not a GitLane patch.');
            console.log('[Relay:Receiver] ✅ Patch parsed!');
            callbacks.onStatus('complete');
            callbacks.onPayload(p);
          } catch (e: any) {
            console.log('[Relay:Receiver] ❌ Parse failed:', e);
            callbacks.onError(`Failed to parse patch: ${e?.message ?? e}`);
            callbacks.onStatus('error');
          }
          break;
        }

        case 'ERROR':
          callbacks.onError(msg.message);
          callbacks.onStatus('error');
          break;
      }
    };

    ws.onclose = (ev) => {
      console.log(`[Relay:Receiver] WS CLOSED code=${ev.code} reason=${ev.reason}`);
      if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
      if (!cancelled && !metaReceived) {
        callbacks.onStatus('error');
        callbacks.onError('Relay connection closed unexpectedly.');
      }
    };
    ws.onerror = (e: any) => {
      console.log('[Relay:Receiver] WS ERROR:', e?.message ?? e);
      if (!cancelled) { callbacks.onStatus('error'); callbacks.onError('Relay connection dropped.'); }
    };
  }).catch((e) => {
    console.log('[Relay:Receiver] ❌ openRelay failed:', e);
    if (!cancelled) { callbacks.onStatus('error'); callbacks.onError('Could not reach relay server.'); }
  });

  return {
    cancel: () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      wsRef?.close();
      console.log('[Relay:Receiver] Cancelled');
    },
  };
}

// ─── Section 5: Apply Patch to Git Repo ───────────────────────────────────────

export async function applyPatch(payload: PatchPayload, repoId?: string): Promise<string> {
  console.log('[P2P] applyPatch called —', payload.repoName, payload.diffFiles.length, 'files');

  // If repoId not provided, create a new repo
  let targetRepoId: string;
  if (!repoId) {
    console.log('[P2P] Creating new repo:', payload.repoName);
    const newRepo = await gitEngine.createRepository(payload.repoName, false);
    targetRepoId = newRepo.id;
  } else {
    targetRepoId = repoId;
  }

  // Apply each diff file
  for (const file of payload.diffFiles) {
    console.log('[P2P] Applying file:', file.filepath, 'changeType:', file.changeType);
    try {
      if (file.changeType === 'D') {
        // Delete file
        await gitEngine.deleteFile(targetRepoId, file.filepath);
      } else {
        // Build the final content by resolving hunks (take all 'added' lines or keep 'context' lines)
        let finalContent = '';
        for (const hunk of file.hunks) {
          for (const line of hunk.lines) {
            if (line.type === 'added') {
              finalContent += line.content.slice(1) + '\n'; // remove the '+' prefix
            } else if (line.type === 'context') {
              finalContent += line.content.slice(1) + '\n'; // remove the ' ' prefix
            } else if (line.type === 'removed') {
              // skip removed lines
            }
          }
        }

        // If no hunks (binary file or empty), just create empty
        if (finalContent === '' && file.changeType === 'A') {
          finalContent = '';
        }

        // Remove trailing newline
        if (finalContent.endsWith('\n')) {
          finalContent = finalContent.slice(0, -1);
        }

        // Write to git
        await gitEngine.createFile(targetRepoId, file.filepath, finalContent);
      }
    } catch (err: any) {
      console.warn('[P2P] Failed to apply file', file.filepath, ':', err?.message ?? err);
    }
  }

  // Create a commit for the imported patch
  console.log('[P2P] Creating commit for applied patch');
  const authorName = payload.senderName;
  const authorEmail = 'imported@gitle.app';
  await gitEngine.commit(
    targetRepoId,
    `Imported patch from ${payload.senderName}`,
    { name: authorName, email: authorEmail }
  );

  console.log('[P2P] ✅ Patch applied successfully');
  return targetRepoId;
}

export function extractToken(raw: string): string | null {
  if (raw.startsWith(DEEP_LINK_SCHEME)) return raw.slice(DEEP_LINK_SCHEME.length).trim();
  if (/^[A-Z2-9]{8}$/.test(raw.trim())) return raw.trim();
  return null;
}
