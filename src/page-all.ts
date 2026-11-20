/**
 * Fetch every page of a list: ask for `limit` items at a time until a page comes back with fewer than `limit` (the last one),
 * or `maxPages` pages have been read (a safety cap so a runaway list can't loop forever). A page that fails ends the list
 * with what was read so far.
 */
export async function pageAll<T>(fetchPage: (offset: number, limit: number) => Promise<T[]>, limit = 100, maxPages = 20): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    let items: T[];
    try { items = await fetchPage(page * limit, limit); } catch { break; }
    out.push(...items);
    if (items.length < limit) break;
  }
  return out;
}
