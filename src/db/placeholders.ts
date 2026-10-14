/** Convert positional `?` placeholders to Postgres `$1` style, skipping single-quoted strings. */
export function toPostgresPlaceholders(sql: string): string {
  let index = 0;
  let out = '';
  let cursor = 0;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (char === "'") {
      let end = cursor + 1;
      while (end < sql.length) {
        if (sql[end] === "'" && sql[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (sql[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      out += sql.slice(cursor, end);
      cursor = end;
      continue;
    }
    if (char === '?') {
      index += 1;
      out += `$${index}`;
      cursor += 1;
      continue;
    }
    out += char;
    cursor += 1;
  }
  return out;
}
