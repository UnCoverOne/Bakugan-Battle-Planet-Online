# Administrator Patch Notes Editor

## Access

Sign in as an Administrator and open **Administrator → Patch Notes** at `/admin?tab=patches`.

The Patch Notes API (`/api/admin/patch-notes`) requires the existing Administrator role for reading and writing. Public pages never fetch draft records.

## Creating a patch

1. Select **New Patch**.
2. On **Overview**, enter a semantic version, title, and summary.
3. Add or rename sections using **Outline**.
4. Use **Add change** to create Card, Bakugan, BakuCore, Mechanic, Bug Fix, or General entries.
5. For catalogue-related changes, search and select the referenced element. Enter before/after values and an explanation.
6. Use **Preview** to review the content before publishing.
7. Save a draft or select **Publish**. Publishing requires confirmation and at least one described change.

Saved drafts autosave after the editor has been idle for 2.5 seconds. Unsaved new patches must be saved explicitly once a version and title have been set. Changes to an already-published patch are only saved when an Administrator explicitly selects Save Changes/Publish. Leaving with unsaved edits prompts confirmation.

Section and change order can be adjusted with the adjacent Up/Down controls on desktop and mobile. Change entries can be duplicated or deleted.

## Publishing and URLs

- `/updates`: Published patch history, newest version first.
- `/updates/<version>`: Permanent patch-detail URL.
- Homepage: Shows deployed application version from `lib/content/versions.ts` and dynamically links to the latest *published* patch.
- Drafts and archived patches are not visible to visitors.
- The bundled v0.4.0 development update remains available until overridden by a saved administrator record.

Publishing notes **does not deploy code or modify card/gameplay data**. Catalogue references only document affected elements.

## Technical notes

Records are stored as structured JSON in the existing D1 `admin_resources` table, under resource type `website-patch`. Saves use revision checks so concurrent administrators cannot silently overwrite existing records. The public list falls back to the bundled development note if the database is unavailable.

This initial release includes structured entries, catalogue search, comparisons, section navigation, responsive editing, drafts, preview, archive, and publishing. Planned advanced editorial features (scheduled publication, revision restoration, rich media uploads, multi-admin approvals, and bulk spreadsheet-style changes) are not implemented yet.
