# APLUNO External Verification Boundary

**Date:** 2026-08-26

## Items NOT Verifiable from Repository

The following items require account-level access or external systems that are not available in this environment. They are documented here for completeness.

### AdSense

| Item | Status | Notes |
|------|--------|-------|
| AdSense approval | NOT VERIFIED | Google's decision; cannot be unit-tested |
| AdSense policy review | NOT VERIFIED | Requires AdSense account access |
| ads.txt account status | NOT VERIFIED | Publisher ID is configured correctly in code; account linkage is external |
| Ad serving behavior | NOT VERIFIED | Requires live AdSense account |
| Ad placement compliance | NOT VERIFIED | Code audit confirms no ads on processing pages; Google's review is external |

### Search Console

| Item | Status | Notes |
|------|--------|-------|
| Search Console selected canonical | NOT VERIFIED | Requires Search Console access |
| Indexed page count | NOT VERIFIED | Requires Search Console access |
| Manual actions | NOT VERIFIED | Requires Search Console access |
| Crawl stats | NOT VERIFIED | Requires Search Console access |
| Core Web Vitals (field) | NOT VERIFIED | Requires CrUX/Search Console data |

### Legal/Compliance

| Item | Status | Notes |
|------|--------|-------|
| Cookie consent legal compliance | NOT VERIFIED | No consent banner exists; legal risk under EU GDPR/ePrivacy |
| Privacy policy legal adequacy | NOT VERIFIED | Content is accurate; legal review is external |
| Terms of service legal adequacy | NOT VERIFIED | Content is substantive; legal review is external |
| Governing law / jurisdiction | NOT VERIFIED | Not specified in terms of service |

### Performance

| Item | Status | Notes |
|------|--------|-------|
| Field Core Web Vitals | NOT VERIFIED | Requires CrUX/real-user monitoring |
| Lighthouse scores | NOT VERIFIED | Lab-only assessment possible |
| Real-world load times | NOT VERIFIED | Requires analytics |

### Analytics

| Item | Status | Notes |
|------|--------|-------|
| Google Analytics | NOT ACTIVE | Explicitly disabled in site.config.json |
| Traffic volume | NOT VERIFIED | No analytics configured |
| User behavior | NOT VERIFIED | No analytics configured |

## What WAS Verified

| Item | Status | Evidence |
|------|--------|----------|
| Publisher ID format | VERIFIED | `ca-pub-2644615452393440` matches regex `^ca-pub-\d{16}$` |
| ads.txt content | VERIFIED | Correct publisher, single line, plain text |
| AdSense script injection | VERIFIED | async, crossorigin, single per page, 15 allowed pages |
| Tool pages excluded from ads | VERIFIED | 202 tool pages confirmed zero AdSense scripts |
| Privacy discloses AdSense | VERIFIED | Both privacy pages mention AdSense |
| Privacy links to Google policy | VERIFIED | Both link to `policies.google.com/privacy` |
| Privacy discloses storage | VERIFIED | Both mention IndexedDB and localStorage |
| Canonical consistency | VERIFIED | All canonicals HTTPS, absolute, correct hostname |
| Sitemap integrity | VERIFIED | 219 URLs, all valid, no duplicates |
| Tool count accuracy | VERIFIED | 202 tools in registry = 202 pages = 202 sitemap entries |
| Build reproducibility | VERIFIED | Identical output across 2 consecutive builds |
