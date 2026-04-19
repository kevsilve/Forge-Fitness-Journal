import { GIST_FILENAME } from '../constants.js';
import { sv } from '../storage.js';

export async function gistPull(cfg) {
  if(!cfg.pat || !cfg.gistId) return null;
  const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
    headers: { 'Authorization': `token ${cfg.pat}`, 'Accept': 'application/vnd.github.v3+json' }
  });
  if(!res.ok) throw new Error('GitHub error ' + res.status);
  const data = await res.json();
  const fileObj = data.files && data.files[GIST_FILENAME];
  if(!fileObj) throw new Error(`"${GIST_FILENAME}" not found in Gist`);
  let content = fileObj.content;
  if(fileObj.truncated && fileObj.raw_url) {
    const raw = await fetch(fileObj.raw_url, { headers: { 'Authorization': `token ${cfg.pat}` } });
    content = await raw.text();
  }
  return JSON.parse(content);
}

export async function gistPush(cfg, payload) {
  if(!cfg.pat) return;
  const body = {
    description: 'FORGE Fitness Journal Backup',
    public: false,
    files: { [GIST_FILENAME]: { content: payload } }
  };
  let url = 'https://api.github.com/gists';
  let method = 'POST';
  if(cfg.gistId) { url = `https://api.github.com/gists/${cfg.gistId}`; method = 'PATCH'; }
  const res = await fetch(url, {
    method,
    headers: { 'Authorization': `token ${cfg.pat}`, 'Content-Type': 'application/json', 'Accept': 'application/vnd.github.v3+json' },
    body: JSON.stringify(body)
  });
  if(!res.ok) { const e = await res.json(); throw new Error(e.message || 'GitHub error ' + res.status); }
  const data = await res.json();
  if(!cfg.gistId) { cfg.gistId = data.id; sv('fj_gist_cfg', cfg); }
  return data;
}
