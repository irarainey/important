/**
 * Well-known standard abbreviations for `import y as z` (Google style 2.2.4).
 *
 * Only these aliases are accepted without a warning. The map is keyed by
 * the full module name; the value is the conventional short alias.
 *
 * @see https://google.github.io/styleguide/pyguide.html#s2.2-imports
 */
export const STANDARD_IMPORT_ALIASES: ReadonlyMap<string, string> = new Map([
    ['numpy', 'np'],
    ['pandas', 'pd'],
    ['matplotlib', 'mpl'],
    ['matplotlib.pyplot', 'plt'],
    ['seaborn', 'sns'],
    ['tensorflow', 'tf'],
    ['scipy', 'sp'],
    ['polars', 'pl'],
    ['networkx', 'nx'],
    ['sqlalchemy', 'sa'],
    ['datetime', 'dt'],
]);
