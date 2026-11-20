const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

export function esc(v: string | number): string {
  return String(v).replace(/[&<>"']/g, (c) => ESC[c]!);
}

/** Remove acentos/caracteres inválidos e colapsa espaços (regra do leiaute para textos). */
export function sanitizeText(v: string): string {
  return v
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export type XmlValue = string | number | null | undefined | false;

/** Gera `<tag>valor</tag>`; retorna '' se valor vazio (campos opcionais). */
export function tag(name: string, value: XmlValue): string {
  if (value === undefined || value === null || value === false || value === '') return '';
  return `<${name}>${esc(value)}</${name}>`;
}

/** Gera `<tag attrs>filhos</tag>`; filhos podem ser string ou lista. Vazio => ''. */
export function group(name: string, children: string | string[], attrs: Record<string, string> = {}): string {
  const inner = Array.isArray(children) ? children.join('') : children;
  if (!inner) return '';
  const a = Object.entries(attrs)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join('');
  return `<${name}${a}>${inner}</${name}>`;
}

export const fmt = {
  /** Decimal com n casas, ponto como separador. */
  dec(v: number, casas: number): string {
    return (Math.round((v + Number.EPSILON) * 10 ** casas) / 10 ** casas).toFixed(casas);
  },
  money(v: number): string {
    return fmt.dec(v, 2);
  },
  /** Quantidade/valor unitário: 4 casas (mín. 0 a 4). */
  qty(v: number): string {
    return fmt.dec(v, 4);
  },
  pad(v: number | string, n: number): string {
    return String(v).padStart(n, '0');
  },
  onlyDigits(v: string): string {
    return v.replace(/\D/g, '');
  },
};

/** Data/hora ISO com fuso no formato exigido (AAAA-MM-DDThh:mm:ssTZD), ex.: 2026-11-20T10:00:00-03:00. */
export function dhFormat(d: Date, offsetMinutes: number): string {
  const local = new Date(d.getTime() + offsetMinutes * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const ao = Math.abs(offsetMinutes);
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}` +
    `T${p(local.getUTCHours())}:${p(local.getUTCMinutes())}:${p(local.getUTCSeconds())}` +
    `${sign}${p(Math.floor(ao / 60))}:${p(ao % 60)}`
  );
}
