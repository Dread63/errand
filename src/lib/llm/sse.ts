export function createSseParser(onData: (data: string) => void) {
  let buf = '';
  const emit = (block: string) => {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''))
      .join('\n');
    if (data) onData(data);
  };
  return {
    push(chunk: string) {
      buf += chunk;
      for (;;) {
        const m = /\r?\n\r?\n/.exec(buf);
        if (!m) return;
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        emit(block);
      }
    },
    end() {
      if (buf.trim()) emit(buf);
      buf = '';
    },
  };
}
