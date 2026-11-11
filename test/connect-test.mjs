// Test end-to-end de seo-auditor contra un sitio local con problemas SEO.
import path from 'node:path';
import http from 'node:http';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(path.join(tmpDir, 'dsh-home', 'seo-auditor'), { recursive: true });
writeFileSync(path.join(tmpDir, 'dsh-home', 'seo-auditor', 'config.json'), JSON.stringify({ allowedHosts: ['127.0.0.1'], userAgent: 'seo-test' }, null, 2), 'utf8');

const html = `<!doctype html><html><head>
<title>WENDIGO</title>
</head><body>
<h1>Bienvenido</h1>
<img src="/a.png"><img src="/b.png" alt="logo">
<a href="/about">About</a><a href="/missing">Roto</a><a href="https://example.com">External</a>
</body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
  else if (req.url === '/about') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>about</body></html>'); }
  else if (req.url === '/missing') { res.writeHead(404); res.end('no'); }
  else if (req.url === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nAllow: /'); }
  else if (req.url === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); res.end('<?xml version="1.0"?><urlset><url><loc>/</loc></url><url><loc>/about</loc></url></urlset>'); }
  else { res.writeHead(404); res.end('not found'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/`;

function makeClient(extraEnv = {}) {
  const entry = process.env.SEO_SERVER ? path.resolve(process.env.SEO_SERVER) : path.join(packageDir, 'server.mjs');
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { SystemRoot: process.env.SystemRoot || 'C:\\Windows', PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME || process.env.USERPROFILE, TEMP: process.env.TEMP, TMP: process.env.TMP, DSH_HOME: path.join(tmpDir, 'dsh-home'), ...extraEnv }, stderr: 'pipe' });
  transport.stderr?.on('data', (c) => process.stderr.write(`[server] ${c}`));
  const client = new Client({ name: 'seo-test', version: '1.0.0' }, { capabilities: {}, versionNegotiation: { mode: 'auto' } });
  return client.connect(transport).then(() => ({ client, transport }));
}
const textOf = (r) => (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const { client, transport } = await makeClient();
console.log('tools:', (await client.listTools()).tools.map((t) => t.name).join(', '));
console.log('--- status ---'); console.log(textOf(await client.callTool({ name: 'status', arguments: {} })));
const audit = await client.callTool({ name: 'audit', arguments: { url: base } });
console.log('--- audit ---'); console.log(textOf(audit).slice(0, 900));
const links = await client.callTool({ name: 'links', arguments: { url: base } });
console.log('--- links ---'); console.log(textOf(links));
const blocked = await client.callTool({ name: 'audit', arguments: { url: 'https://example.com/' } });
console.log('host no permitido isError:', blocked.isError === true, '|', textOf(blocked).slice(0, 100));
const bad = await client.callTool({ name: 'audit', arguments: { url: 'ftp://x' } });
console.log('protocolo inválido isError:', bad.isError === true);
await client.close(); try { await transport.close?.(); } catch {}
server.close();
console.log('OK');
