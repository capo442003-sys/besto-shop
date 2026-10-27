/** Normalise GET /clients (tableau ou { clients, summary }). */
export function parseClientsListResponse(data) {
  if (Array.isArray(data)) {
    return { clients: data, summary: null, listMeta: null };
  }
  return {
    clients: Array.isArray(data?.clients) ? data.clients : [],
    summary: data?.summary ?? null,
    listMeta: data?.list_meta ?? null,
  };
}
