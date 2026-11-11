#!/usr/bin/env node
// dsh-plugin-seo-auditor — auditoría SEO local para DeepSeek Harness.
// Tools: status, audit, links.

import path from 'node:path';
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const v = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  return v || path.join(process.env.USERPROFILE || process.env.HOME || os.homedir(), '.dsh');
})();
const CONFIG_FILE = path.join(DSH_HOME, 'seo-auditor', 'config.json');
const READ_ONLY = String(process.env.DSH_SEO_MODE || '').toLowerCase() === 'read-only';
const PAGE_TIMEOUT_MS = 15_000;
const LINK_TIMEOUT_MS = 6_000;
const MAX_LINK_CHECKS = 25;

const log = (m) => process.stderr.write(`[seo] ${m}\n`);

function loadConfig() {
  const defaults = { allowedHosts: [], userAgent: 'dsh-plugin-seo-auditor/0.1', note: 'allowedHosts vacío = cualquier host http(s).' };
  try {
    if (existsSync(CONFIG_FILE)) return { ...defaults, ...(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {}) };
  } catch (error) { log(`config inválida: ${error.message}`); }
  return defaults;
}

function ensureAllowed(config, url) {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('solo se permiten URLs http:// o https://');
  if (config.allowedHosts.length > 0 && !config.allowedHosts.includes(url.hostname)) {
    throw new Error(`host no permitido: ${url.hostname}. Lista blanca: ${config.allowedHosts.join(', ')}`);
  }
}

async function fetchText(url, timeoutMs = PAGE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const started = Date.now();
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'user-agent': loadConfig().userAgent } });
    const text = await response.text();
    return { response, text, ms: Date.now() - started };
  } catch (error) {
    throw new Error(`no se pudo obtener ${url}: ${error.name === 'AbortError' ? 'timeout' : error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function extract(html) {
  const attr = (re) => { const m = html.match(re); return m ? (m[1] || '').trim() : ''; };
  const collect = (re) => { const out = []; let m; while ((m = re.exec(html))) out.push(m[1]); return out; };
  const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    title: attr(/<title[^>]*>([\s\S]*?)<\/title>/i),
    metaDescription: attr(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
    canonical: attr(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
    robots: attr(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']*)["']/i),
    viewport: attr(/<meta[^>]+name=["']viewport["'][^>]+content=["']([^"']*)["']/i),
    lang: attr(/<html[^>]+lang=["']([^"']*)["']/i),
    h1: collect(/<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(strip),
    h2: collect(/<h2[^>]*>([\s\S]*?)<\/h2>/gi),
    images: [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]),
    og: [...html.matchAll(/<meta[^>]+property=["']og:([a-z:]+)["'][^>]+content=["']([^"']*)["']/gi)].map((m) => [m[1], m[2]]),
    links: collect(/<a\b[^>]+href=["']([^"'#]+)["']/gi),
    jsonLd: /application\/ld\+json/i.test(html),
  };
}

function scoreReport(data) {
  const issues = [];
  const wins = [];
  if (!data.title) issues.push('falta <title>'); else if (data.title.length < 15) issues.push(`title corto (${data.title.length} caracteres)`); else if (data.title.length > 65) issues.push(`title largo (${data.title.length} caracteres)`); else wins.push(`title: "${data.title}"`);
  if (!data.metaDescription) issues.push('falta meta description'); else if (data.metaDescription.length < 50) issues.push(`meta description corta (${data.metaDescription.length})`); else wins.push('meta description presente');
  if (!data.lang) issues.push('falta atributo lang en <html>'); else wins.push(`lang: ${data.lang}`);
  if (!data.viewport) issues.push('falta meta viewport (responsive)');
  if (data.h1.length === 0) issues.push('falta H1'); else if (data.h1.length > 1) issues.push(`${data.h1.length} H1 (debería haber uno)`); else wins.push(`H1: "${data.h1[0]}"`);
  const missingAlt = data.images.filter((tag) => !/\balt=["']/i.test(tag)).length;
  if (data.images.length > 0) { if (missingAlt > 0) issues.push(`${missingAlt} de ${data.images.length} imágenes sin alt`); else wins.push('todas las imágenes tienen alt'); }
  if (!data.canonical) issues.push('falta canonical');
  if (data.jsonLd) wins.push('JSON-LD presente');
  if (data.og.length === 0) issues.push('sin Open Graph tags'); else wins.push(`Open Graph: ${data.og.length} tags`);
  return { issues, wins };
}

function textResult(text) { return { content: [{ type: 'text', text }] }; }

function resolveTarget(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error(`URL inválida: ${raw}`); }
  ensureAllowed(loadConfig(), url);
  return url;
}

async function fetchOptional(url, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    return { status: response.status, ok: response.ok, text: response.ok ? await response.text() : '' };
  } catch { return { status: null, ok: false, text: '' }; }
  finally { clearTimeout(timer); }
}

function buildInstructions() {
  return [
    'SEO Auditor: auditoría SEO de páginas web para WENDIGO.',
    '',
    'Herramientas: status, audit, links.',
    '',
    'Reglas:',
    '- Solo sitios http(s); respeta allowedHosts.',
    '- audit hace una petición a la página + robots.txt y sitemap.xml; links revisa hasta 25 enlaces.',
    '- Reporta hallazgos reales con severidad; no inventes métricas de tráfico ni rankings.',
    '- Es solo lectura: no modifica el sitio.',
  ].join('\n');
}

function buildServer() {
  const server = new McpServer({ name: 'dsh-plugin-seo-auditor', version: VERSION }, { capabilities: { tools: {} }, instructions: buildInstructions() });

  server.registerTool(
    'status',
    { title: 'Estado', description: 'Configuración, hosts permitidos y modo.', inputSchema: z.object({}) },
    async () => {
      const config = loadConfig();
      return textResult([`Modo: ${READ_ONLY ? 'read-only (todo es lectura)' : 'normal'}`, `Config: ${CONFIG_FILE}`, `Hosts permitidos: ${config.allowedHosts.length ? config.allowedHosts.join(', ') : 'todos'}`, `User-Agent: ${config.userAgent}`, `Máx. enlaces a revisar: ${MAX_LINK_CHECKS}`].join('\n'));
    },
  );

  server.registerTool(
    'audit',
    {
      title: 'Auditar página',
      description: 'Analiza title, meta, headings, imágenes, canonical, Open Graph, robots.txt y sitemap.',
      inputSchema: z.object({ url: z.string().min(6).describe('URL http(s) a auditar.') }),
    },
    async (args) => {
      const url = resolveTarget(args.url);
      const { response, text, ms } = await fetchText(url);
      const data = extract(text);
      const { issues, wins } = scoreReport(data);
      const robots = await fetchOptional(new URL('/robots.txt', url.origin).toString());
      const sitemap = await fetchOptional(new URL('/sitemap.xml', url.origin).toString());
      const lines = [
        `# ${url.toString()}`,
        `HTTP ${response.status} · ${ms} ms · ${text.length} bytes de HTML`,
        '',
        `Score: ${Math.max(0, 100 - issues.length * 7)}/100 · ${issues.length} problema(s)`,
        '',
        '## Hallazgos',
        ...wins.map((w) => `✅ ${w}`),
        ...issues.map((i) => `❌ ${i}`),
        '',
        `## Recursos`,
        `robots.txt: ${robots.status ? `HTTP ${robots.status}` : 'no disponible'}`,
        `sitemap.xml: ${sitemap.status ? `HTTP ${sitemap.status}${sitemap.text ? ` (${(sitemap.text.match(/<url>/g) || []).length} URLs)` : ''}` : 'no disponible'}`,
        `Enlaces internos/externos: ${data.links.length} · imágenes: ${data.images.length} · h2: ${data.h2.length}`,
      ];
      return textResult(lines.join('\n'));
    },
  );

  server.registerTool(
    'links',
    {
      title: 'Enlaces rotos',
      description: `Revisa hasta ${MAX_LINK_CHECKS} enlaces de la página y reporta los que fallan.`,
      inputSchema: z.object({ url: z.string().min(6) }),
    },
    async (args) => {
      const url = resolveTarget(args.url);
      const { text } = await fetchText(url);
      const data = extract(text);
      const unique = [...new Set(data.links.map((href) => { try { return new URL(href, url).toString(); } catch { return null; } }).filter(Boolean))].slice(0, MAX_LINK_CHECKS);
      const rows = [];
      for (const link of unique) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);
          let status = null;
          try {
            const response = await fetch(link, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
            status = response.status;
            if (status === 405 || status === 501) {
              const getResponse = await fetch(link, { method: 'GET', signal: controller.signal, redirect: 'follow' });
              status = getResponse.status;
            }
          } finally { clearTimeout(timer); }
          rows.push({ link, status, ok: status < 400 });
        } catch (error) {
          rows.push({ link, status: null, ok: false, error: error.name === 'AbortError' ? 'timeout' : error.message });
        }
      }
      const broken = rows.filter((r) => !r.ok);
      const lines = [`Enlaces revisados: ${rows.length} · rotos: ${broken.length}`, ...broken.map((r) => `❌ ${r.link} → ${r.error || `HTTP ${r.status}`}`)];
      if (rows.length > broken.length) lines.push('Resto OK.');
      return textResult(lines.join('\n'));
    },
  );

  return server;
}

try {
  if (!existsSync(CONFIG_FILE)) {
    mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
    writeFileSync(CONFIG_FILE, JSON.stringify({ allowedHosts: [], userAgent: 'dsh-plugin-seo-auditor/0.1' }, null, 2) + '\n', 'utf8');
  }
} catch { /* ignora */ }
log(`modo ${READ_ONLY ? 'read-only' : 'normal'} · config: ${CONFIG_FILE}`);
serveStdio(buildServer, { onerror: (e) => log(`serveStdio: ${e.message}`) });
process.on('uncaughtException', (e) => log(`excepción: ${e.message}`));
process.on('unhandledRejection', (e) => log(`rechazo: ${e && e.message ? e.message : String(e)}`));
