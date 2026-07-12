# Kabuyomi Static Legal Site

Cloudflare Pages-ready static legal pages for Kabuyomi v1.

## Local Validation

```bash
cd /Users/0xt4/t4dano/Kabuyomi/legal-site
npm run validate
```

The validator reads `shared/product-catalog.json` and checks the public pages, bundled iOS legal/credit copy, Privacy/App Review-sensitive wording, active submission documents, Tokushoho disclosure-by-request text, and the absence of hard-coded shipping prices.

## Pages

- `public/privacy/index.html`
- `public/terms/index.html`
- `public/support/index.html`
- `public/tokushoho/index.html`

`public/index.html` links to each page.

## Public URL

- `https://kabuyomi-legal-site.pages.dev/privacy/`
- `https://kabuyomi-legal-site.pages.dev/terms/`
- `https://kabuyomi-legal-site.pages.dev/support/`
- `https://kabuyomi-legal-site.pages.dev/tokushoho/`

## Tokushoho Identity Wording

The 特商法 page uses disclosure-by-request wording for seller/operator name, address, and phone number. Do not add private identity values to the public repository unless the owner explicitly provides and approves them.
