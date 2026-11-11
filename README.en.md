# dsh-plugin-seo-auditor — SEO Auditor

Auditoría SEO para DeepSeek Harness: title, meta, headings, imágenes sin alt, enlaces rotos, robots.txt y sitemap de cualquier sitio http(s) con lista blanca de hosts.

## Herramientas

Ver `docs/HOW-IT-WORKS.md` para el detalle.

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-seo-auditor` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-seo-auditor
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_SEO_AUDITOR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\seo-auditor\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
