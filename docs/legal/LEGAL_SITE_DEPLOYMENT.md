# Kabuyomi Static Legal Site Deployment

Last updated: 2026-07-11 JST

## Goal

Kabuyomi v1 legal pages should be served from a static Cloudflare Pages site, independent from the API Worker. The Worker `/legal/*` routes remain legacy API-hosted fallback copies only and should not be used as the preferred App Store metadata URLs.

## Cloudflare Pages Project

- Recommended project name: `kabuyomi-legal-site`
- Current Pages project URL: `https://kabuyomi-legal-site.pages.dev`
- Live production check on 2026-07-11: all four pages were still on their May revisions and hash-different from local `2026-07-11` source
- Framework preset: None / static
- Build command: `npm run validate`
- Output directory: `legal-site/public`
- Source directory in this repo: `legal-site`

The preferred App Store URL for this pass is `https://kabuyomi-legal-site.pages.dev`. A custom domain can replace it later, but do not point App Store metadata at the API Worker.

Run validation as the Pages build command so catalog/iOS/App Review drift blocks publication:

```bash
npm run validate
```

## Suggested Custom Domain

Preferred if the domain and routing setup support it:

- `https://kabuyomi.app/legal/privacy`
- `https://kabuyomi.app/legal/terms`
- `https://kabuyomi.app/legal/support`
- `https://kabuyomi.app/legal/tokushoho`

Alternative:

- `https://legal.kabuyomi.app/privacy`
- `https://legal.kabuyomi.app/terms`
- `https://legal.kabuyomi.app/support`
- `https://legal.kabuyomi.app/tokushoho`

If a custom domain is adopted later, update:

- `ios/Kabuyomi/Services/LegalSiteConfig.swift`
- App Store Connect metadata
- `docs/release/APP_STORE_SUBMISSION_NOTES.md`
- this document

## DNS Notes

- For `legal.kabuyomi.app`, add the Cloudflare Pages custom domain and create/verify the required DNS record in Cloudflare.
- For `kabuyomi.app/legal`, confirm that the root domain routing can serve `/legal/*` from Pages without coupling legal pages back to the API Worker.
- Do not point App Store metadata at `workers.dev` or the API Worker as the preferred legal surface.

## Verification

Verify headers for all public pages:

```bash
curl -I https://kabuyomi-legal-site.pages.dev/privacy/
curl -I https://kabuyomi-legal-site.pages.dev/terms/
curl -I https://kabuyomi-legal-site.pages.dev/support/
curl -I https://kabuyomi-legal-site.pages.dev/tokushoho/
```

Then compare each live body to its local source, for example:

```bash
curl -fsSL https://kabuyomi-legal-site.pages.dev/privacy/ | shasum -a 256
shasum -a 256 legal-site/public/privacy/index.html
```

Repeat for Terms, Support, and 特商法. A `200` response alone is not sufficient.

For the path-based strategy, use:

```bash
curl -I https://kabuyomi.app/legal/privacy
curl -I https://kabuyomi.app/legal/terms
curl -I https://kabuyomi.app/legal/support
curl -I https://kabuyomi.app/legal/tokushoho
```

Expected result:

- HTTP `200`
- each body hash matches the reviewed local source and displays `最終更新日: 2026-07-11`
- content type is HTML
- pages render on mobile
- no tracking scripts
- no API calls
- 特商法 uses disclosure-by-request wording for seller/operator name, address, and phone
- no `TODO_FINAL_LEGAL_*` placeholders are present

## App Store Connect Updates

Update App Store Connect after the static site is live:

- Privacy Policy URL
- Support URL
- Terms URL if used in metadata
- IAP review notes if linking terms or paid-credit conditions

Also re-check the iOS Settings legal links after any future domain change.

## Release Gate

Release remains blocked if either of these is true:

- any deployed body hash differs from the reviewed local source
- any deployed page reports a revision older than `2026-07-11`
- deployed public static pages still contain stale `TODO_FINAL_LEGAL_*` placeholders
- App Store Connect metadata still points to Worker `/legal/*` URLs
