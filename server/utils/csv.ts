export function parseCsv(text: string, label = 'CSV'): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let quoteClosed = false;
  const source = text.replace(/^\uFEFF/, '');

  const finishField = () => {
    record.push(field);
    field = '';
    quoteClosed = false;
  };
  const finishRecord = () => {
    finishField();
    if (record.some((value) => value !== '')) records.push(record);
    record = [];
  };

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (field !== '' || quoteClosed) {
        throw new Error(`${label}の引用符の位置が不正です。`);
      }
      quoted = true;
      continue;
    }
    if (character === ',') {
      finishField();
      continue;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index++;
      finishRecord();
      continue;
    }
    if (quoteClosed) {
      throw new Error(`${label}の閉じ引用符の後に不正な文字があります。`);
    }
    field += character;
  }

  if (quoted) throw new Error(`${label}の引用符が閉じられていません。`);
  if (field !== '' || record.length > 0) finishRecord();
  return records;
}
