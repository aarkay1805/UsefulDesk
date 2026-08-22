/** One Graph version for browser login and every server-side Meta request. */
export const META_GRAPH_VERSION = 'v26.0' as const;

export const META_GRAPH_BASE_URL =
  `https://graph.facebook.com/${META_GRAPH_VERSION}` as const;
