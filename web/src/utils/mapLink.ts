// The map's view (artist, genre, path) lives in the URL fragment, never the query string. Crawlers ignore
// fragments, so every deep link counts as the homepage instead of one more URL to fetch and render.

/** A link that opens the map on a view, e.g. mapHref({ artist: id }) */
export const mapHref = (params: Record<string, string>): string => `/#${new URLSearchParams(params)}`;

/** The view the current URL asks for */
export const readMapParams = (): URLSearchParams => new URLSearchParams(window.location.hash.slice(1));
