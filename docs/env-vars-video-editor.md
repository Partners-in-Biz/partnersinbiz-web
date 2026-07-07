# Video Editor env vars

Server-side stock media search uses provider keys. Keep these values out of
client bundles and add them with `printf`, not `echo`, so no trailing newline is
stored in Vercel.

Required for stock search:

```bash
printf "%s" "<pexels-key>" | vercel env add PEXELS_API_KEY development
printf "%s" "<pixabay-key>" | vercel env add PIXABAY_API_KEY development
```

Repeat for Preview/Production only when the target deployment is approved.

Optional:

```bash
printf "%s" "host1.example.com,host2.example.com" | vercel env add STOCK_IMPORT_EXTRA_HOSTS development
```

`STOCK_IMPORT_EXTRA_HOSTS` is a comma-separated HTTPS host allowlist extension
for server-side stock imports. Leave it unset unless a reviewed provider needs
an additional CDN host.
