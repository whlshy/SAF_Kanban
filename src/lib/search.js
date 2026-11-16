// Text matching shared by the board filter and the deleted-tasks search.

// Case-insensitive, full-width and half-width treated alike.
export const normalizeText = (value) =>
  (value === null || value === undefined ? "" : String(value)).normalize("NFKC").toLowerCase()

export const searchTerms = (query) => normalizeText(query).split(/\s+/).filter(Boolean)

// Every term must appear in one of the fields.
export const matchesTerms = (fields, terms) => {
  if (!terms.length) return true
  const haystack = normalizeText(fields.join("\n"))
  return terms.every((term) => haystack.includes(term))
}
