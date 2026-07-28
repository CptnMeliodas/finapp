// github.js — sync do data.json com um repositório privado via GitHub Contents API
// Config: {owner, repo, branch, path, token}
import { getCfg, saveCfg, getState, replaceState, markClean } from './store.js';

const API = 'https://api.github.com';

function headers(token) {
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

export function syncConfigured() {
  const c = getCfg();
  return !!(c.ghOwner && c.ghRepo && c.ghToken);
}

function fileURL() {
  const c = getCfg();
  const path = c.ghPath || 'data/data.json';
  return `${API}/repos/${c.ghOwner}/${c.ghRepo}/contents/${path}?ref=${c.ghBranch || 'main'}`;
}

// codifica UTF-8 → base64
function b64encode(str) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function pullRemote() {
  const c = getCfg();
  const res = await fetch(fileURL(), { headers: headers(c.ghToken), cache: 'no-store' });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error('GitHub GET ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  return { sha: json.sha, data: JSON.parse(b64decode(json.content)) };
}

async function putRemote(data, sha, message) {
  const c = getCfg();
  const path = c.ghPath || 'data/data.json';
  const body = {
    message: message || ('finapp: atualização ' + new Date().toISOString()),
    content: b64encode(JSON.stringify(data, null, 1)),
    branch: c.ghBranch || 'main'
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${API}/repos/${c.ghOwner}/${c.ghRepo}/contents/${path}`, {
    method: 'PUT', headers: { ...headers(c.ghToken), 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (res.status === 409 || res.status === 422) return { conflict: true };
  if (!res.ok) throw new Error('GitHub PUT ' + res.status + ': ' + (await res.text()).slice(0, 200));
  const json = await res.json();
  return { sha: json.content.sha };
}

// merge por entidade: união por id, updatedAt mais novo vence (tombstones incluídos)
export function mergeData(local, remote) {
  const out = { ...remote, ...local };
  out.schema = 1;
  const COLLS = ['accounts', 'categories', 'transactions', 'investments', 'investmentEntries', 'rules'];
  for (const name of COLLS) {
    const map = new Map();
    for (const x of (remote[name] || [])) map.set(x.id, x);
    for (const x of (local[name] || [])) {
      const r = map.get(x.id);
      if (!r || (x.updatedAt || '') >= (r.updatedAt || '')) map.set(x.id, x);
    }
    out[name] = [...map.values()];
  }
  out.settings = { ...(remote.settings || {}), ...(local.settings || {}) };
  return out;
}

let syncing = false;
export async function syncNow(statusCb) {
  if (!syncConfigured() || syncing) return { skipped: true };
  syncing = true;
  const cb = statusCb || (() => {});
  try {
    cb('sync');
    const local = getState();
    const remote = await pullRemote();
    let merged, sha = null;
    if (remote.notFound) {
      merged = local;
    } else {
      sha = remote.sha;
      const lastSha = getCfg().ghLastSha;
      if (sha === lastSha) {
        merged = local; // remoto não mudou desde o último sync
      } else {
        merged = mergeData(local, remote.data);
      }
    }
    const localStr = JSON.stringify(stripVolatile(merged));
    const remoteStr = remote.notFound ? null : JSON.stringify(stripVolatile(remote.data));
    if (localStr !== remoteStr) {
      const put = await putRemote(merged, sha);
      if (put.conflict) { // alguém escreveu no meio: puxa de novo e tenta 1x
        const again = await pullRemote();
        merged = mergeData(merged, again.data || merged);
        const put2 = await putRemote(merged, again.sha);
        if (put2.conflict) throw new Error('Conflito de sync persistente — tente novamente.');
        sha = put2.sha;
      } else sha = put.sha;
    }
    saveCfg({ ghLastSha: sha, ghLastSync: new Date().toISOString() });
    if (JSON.stringify(merged) !== JSON.stringify(getState())) replaceState(merged);
    else markClean();
    cb('ok');
    return { ok: true };
  } catch (e) {
    console.error('[sync]', e);
    cb('error', e.message);
    return { error: e.message };
  } finally {
    syncing = false;
  }
}

function stripVolatile(d) {
  const { updatedAt, ...rest } = d;
  return rest;
}

export async function testConnection() {
  const c = getCfg();
  const res = await fetch(`${API}/repos/${c.ghOwner}/${c.ghRepo}`, { headers: headers(c.ghToken) });
  if (!res.ok) throw new Error('Não foi possível acessar o repositório (' + res.status + '). Confira owner/repo/token.');
  const json = await res.json();
  return { ok: true, private: json.private, fullName: json.full_name };
}
