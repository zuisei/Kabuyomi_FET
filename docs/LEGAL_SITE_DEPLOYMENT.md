# Kabuyomi Static Legal Site Deployment

Last updated: 2026-05-06 JST

## Goal

Kabuyomi v1 legal pages should be served from a static Cloudflare Pages site, independent from the API Worker. The Worker `/legal/*` routes remain legacy API-hosted fallback copies only and should not be used as the preferred App Store metadata URLs.

## Cloudflare Pages Project

- Recommended project name: `kabuyomi-legal-site`
- Current Pages project URL: `https://kabuyomi-legal-site.pages.dev`
- Latest deployment checked in this pass: `https://f7a0adae.kabuyomi-legal-site.pages.dev`
- Framework preset: None / static
- Build command: none
- Output directory: `legal-site/public`
- Source directory in this repo: `legal-site`

The preferred App Store URL for this pass is `https://kabuyomi-legal-site.pages.dev`. A custom domain can replace it later, but do not point App Store metadata at the API Worker.

If Cloudflare requires a build command, use a no-op command such as:

```bash
echo "static legal site"
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
- `docs/app_store_submission_notes.md`
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

For the path-based strategy, use:

```bash
curl -I https://kabuyomi.app/legal/privacy
curl -I https://kabuyomi.app/legal/terms
curl -I https://kabuyomi.app/legal/support
curl -I https://kabuyomi.app/legal/tokushoho
```

Expected result:

- HTTP `200`
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

- deployed public static pages still contain stale `TODO_FINAL_LEGAL_*` placeholders
- App Store Connect metadata still points to Worker `/legal/*` URLs
