/**
 * Make free-text user input safe to put inside a PostgREST `.or()` / `ilike`
 * filter string.
 *
 * `.or('username.ilike.%TERM%,full_name.ilike.%TERM%')` is parsed by
 * PostgREST, so a raw `,` or `)` typed by the user would add or break filter
 * clauses. `%` and `_` are LIKE wildcards and `*` is a PostgREST wildcard.
 * We drop the structural characters and cap the length. Search is substring
 * match, so losing punctuation only changes what matches, never what runs.
 */
export function sanitizeSearchTerm(raw: string, maxLength = 60): string {
  return raw
    .normalize('NFKC')
    .replace(/[,()"'\\%_*:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
