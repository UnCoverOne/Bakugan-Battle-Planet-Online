# Card authoring and validation

The card editor is a review workbench for the schema-controlled Battle Planet catalogue. It deliberately cannot write to production content from the browser.

## Browser editor

Open `/tools/card-editor` in a development or deployed build.

The editor provides:

- search and selection across all 374 controlled records;
- editable identity, card characteristics, faction identity, BakuCore indicators, printed text, mechanics, and asset metadata;
- local browser draft recovery;
- live catalogue schema and uniqueness validation;
- Character and Evo characteristic checks;
- typed rule compilation preview;
- generated source provenance marked as unreviewed;
- JSON import and export;
- a minimal catalogue patch showing changed fields;
- a card-specific golden-test scaffold;
- a complete review bundle fingerprinted against the current schema, catalogue, and rules versions.

The preview is an authoring visualization, not a replacement for the supplied card scan.

## Review bundle

A bundle contains:

- editor, schema, catalogue, and rules version identifiers;
- the selected base card ID, when replacing a record;
- the normalized card draft;
- an add or replace patch;
- the generated draft rule definition;
- validation errors, warnings, and review notices;
- a golden-test template;
- a deterministic fingerprint.

Generated definitions have `implementationStatus: "draft"` and `provenance.reviewed: false`. A browser export can never satisfy the production content gate by itself.

## Command-line tool

Run the CLI through npm:

```bash
npm run card:author -- export bb-93 fireball-authoring.json
npm run card:author -- scaffold 375 new-card.json
npm run card:author -- validate fireball-authoring.json
npm run card:author -- patch fireball-authoring.json
```

`export` creates a review bundle from a controlled card. `scaffold` creates an unbound draft. `validate` runs the same browser-safe validations and returns a non-zero exit status for errors. `patch` prints the normalized changed fields.

## Production workflow

1. Export a review bundle from the browser or CLI.
2. Review printed characteristics against the supplied workbook and scan.
3. Review effect interpretation against the source authority hierarchy.
4. Implement any bespoke typed rule behavior that cannot be generated safely.
5. Apply the catalogue and rules changes in source control.
6. Add the generated golden-test scaffold and real edge-case assertions.
7. Run `npm run content:lock` and commit the updated lock.
8. Run the physical-simulation and authoring quality gate, the full repository suite, lint, and the Cloudflare dry run.

The production catalogue remains immutable at runtime. This prevents a local draft, imported JSON file, or compromised browser session from modifying live card definitions.
