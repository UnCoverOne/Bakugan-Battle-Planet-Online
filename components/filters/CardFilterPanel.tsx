"use client";

import {
  CARD_FILTER_LABELS,
  type CardFilterFacet,
  type CardFilterOptionCatalogue,
  type CardFilterState,
} from "../../lib/card-filters";
import { FilterPicker } from "./FilterPicker";

export function CardFilterPanel({
  filters,
  facets,
  options,
  onChange,
}: {
  filters: CardFilterState;
  facets: readonly CardFilterFacet[];
  options: CardFilterOptionCatalogue;
  onChange: (next: CardFilterState, facet: CardFilterFacet) => void;
}) {
  return (
    <>
      {facets.map((facet) => (
        <FilterPicker
          key={facet}
          label={CARD_FILTER_LABELS[facet]}
          values={filters[facet]}
          options={options[facet]}
          searchable={facet === "keyword"}
          onChange={(values) => onChange({ ...filters, [facet]: values }, facet)}
        />
      ))}
    </>
  );
}
