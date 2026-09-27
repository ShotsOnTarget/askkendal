export interface GazetteerEntry {
  name: string;
  kind: string;
  lat: number;
  lon: number;
}

export interface PlaceCandidate extends GazetteerEntry {
  mentions: number;
  inTitle: boolean;
}

const WORD = /[A-Za-z0-9']/;

/**
 * Find gazetteer places mentioned in a document. Longest names are matched first and their
 * text is masked, so "Kendal Castle" is not also counted as "Castle". Case-sensitive, whole words.
 * Code finds the candidates; Jev picks the main one when there is more than one.
 */
export class Geocoder {
  private readonly entries: GazetteerEntry[];

  constructor(gazetteer: GazetteerEntry[]) {
    this.entries = [...gazetteer].sort((a, b) => b.name.length - a.name.length);
  }

  candidates(title: string, text: string, max = 6): PlaceCandidate[] {
    let haystack = `${title}\n${text}`;
    const titleEnd = title.length;
    const found: PlaceCandidate[] = [];
    for (const e of this.entries) {
      let from = 0;
      let mentions = 0;
      let inTitle = false;
      for (;;) {
        const at = haystack.indexOf(e.name, from);
        if (at < 0) break;
        const before = haystack[at - 1];
        const after = haystack[at + e.name.length];
        if ((!before || !WORD.test(before)) && (!after || !WORD.test(after))) {
          mentions++;
          if (at < titleEnd) inTitle = true;
          haystack = haystack.slice(0, at) + " ".repeat(e.name.length) + haystack.slice(at + e.name.length);
        }
        from = at + e.name.length;
      }
      if (mentions) found.push({ ...e, mentions, inTitle });
    }
    found.sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.mentions - a.mentions || b.name.length - a.name.length);
    return found.slice(0, max);
  }
}
