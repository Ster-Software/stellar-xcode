// Apple's XML property lists, read and written without an npm package: what the Xcode extension needs of them (an
// archive's Info.plist, Xcode's preferences for its teams, the ExportOptions.plist of an upload). Dates come back as
// ISO strings, data as base64 text.
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&amp;': '&' };
const unescape = (text) => text.replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENTITIES[m]).replace(/&#(x?[0-9a-f]+);/gi, (_, n) => String.fromCodePoint(n[0] === 'x' ? parseInt(n.slice(1), 16) : Number(n)));
const escape = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN = /<(\/?)(dict|array|key|string|integer|real|date|data|true|false)\s*(\/?)>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/?plist[^>]*>/g;

/** The value in plist XML `xml`; throws on what isn't one. */
export function parse(xml) {
  const tokens = [];
  let last = 0;
  for (const m of String(xml).matchAll(TOKEN)) {
    if (m[2]) tokens.push({ close: m[1] === '/', tag: m[2], self: m[3] === '/', text: xml.slice(last, m.index) });
    last = m.index + m[0].length;
  }
  let i = 0;
  const textUntil = (tag) => {
    const open = tokens[i];
    if (open.self) { i += 1; return ''; }
    const close = tokens[i + 1];
    if (!close || !close.close || close.tag !== tag) throw new Error(`plist: <${tag}> is niet gesloten.`);
    i += 2;
    return unescape(close.text);
  };
  const value = () => {
    const t = tokens[i];
    if (!t || t.close) throw new Error('plist: waarde verwacht.');
    switch (t.tag) {
      case 'true': case 'false': textUntil(t.tag); return t.tag === 'true';
      case 'string': return textUntil('string');
      case 'integer': return Number.parseInt(textUntil('integer'), 10);
      case 'real': return Number.parseFloat(textUntil('real'));
      case 'date': return new Date(textUntil('date').trim()).toISOString();
      case 'data': return textUntil('data').replace(/\s+/g, '');
      case 'array': {
        if (t.self) { i += 1; return []; }
        i += 1;
        const list = [];
        while (!(tokens[i]?.close && tokens[i].tag === 'array')) list.push(value());
        i += 1;
        return list;
      }
      case 'dict': {
        if (t.self) { i += 1; return {}; }
        i += 1;
        const out = {};
        while (!(tokens[i]?.close && tokens[i].tag === 'dict')) {
          if (tokens[i]?.tag !== 'key') throw new Error('plist: <key> verwacht.');
          const key = textUntil('key');
          out[key] = value();
        }
        i += 1;
        return out;
      }
      default: throw new Error(`plist: onbekend <${t.tag}>.`);
    }
  };
  if (!tokens.length) throw new Error('plist: leeg.');
  return value();
}

/** Plist XML for `value` (objects, arrays, strings, numbers, booleans, dates). */
export function build(value) {
  const out = (v, pad) => {
    if (typeof v === 'boolean') return `${pad}<${v}/>`;
    if (v instanceof Date) return `${pad}<date>${v.toISOString().replace(/\.\d{3}Z$/, 'Z')}</date>`;
    if (typeof v === 'number') return `${pad}<${Number.isInteger(v) ? 'integer' : 'real'}>${v}</${Number.isInteger(v) ? 'integer' : 'real'}>`;
    if (Array.isArray(v)) return `${pad}<array>\n${v.map((x) => out(x, `${pad}\t`)).join('\n')}\n${pad}</array>`;
    if (v && typeof v === 'object') {
      return `${pad}<dict>\n${Object.entries(v).map(([k, x]) => `${pad}\t<key>${escape(k)}</key>\n${out(x, `${pad}\t`)}`).join('\n')}\n${pad}</dict>`;
    }
    return `${pad}<string>${escape(v)}</string>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${out(value, '')}\n</plist>\n`;
}
