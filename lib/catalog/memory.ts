import { CATALOG_PICTURES, CATALOG_SHEETS } from "./pictures.ts";
import { catalogItem } from "./cameroon.ts";

/**
 * The pictures Boutik remembers, loaded on the phone and sent along with the
 * frames: the built-in sheets of known goods for the identifier, and one
 * example picture per known product for the sorter. Browser only.
 */

export interface SheetUpload {
  blob: Blob;
  legend: { tile: number; id: string; name: string }[];
}

const cache = new Map<string, Promise<Blob | null>>();

function fetchPicture(file: string): Promise<Blob | null> {
  const have = cache.get(file);
  if (have) return have;
  const job = fetch(`/catalog/${file}`)
    .then((res) => (res.ok ? res.blob() : null))
    .catch(() => null);
  cache.set(file, job);
  return job;
}

/** The built-in reference sheets with their legends; sheets that fail to load are skipped. */
export async function catalogSheets(): Promise<SheetUpload[]> {
  const loaded = await Promise.all(
    CATALOG_SHEETS.map(async (sheet) => {
      const blob = await fetchPicture(sheet.file);
      if (!blob) return null;
      const legend = sheet.tiles.map((t) => ({ tile: t.tile, id: t.item, name: catalogItem(t.item)?.name ?? t.item }));
      return { blob, legend };
    }),
  );
  return loaded.filter((s): s is SheetUpload => s !== null);
}

/** One remembered picture of a catalogue item, for the sorter's reference sheet. */
export async function catalogExemplar(id: string): Promise<Blob | null> {
  const picture = CATALOG_PICTURES.find((p) => p.item === id);
  return picture ? fetchPicture(picture.file) : null;
}
