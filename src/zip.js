'use strict';
const zlib = require('node:zlib');

/**
 * Minimal streaming ZIP writer. Each entry is buffered on its own (so memory
 * stays bounded by the largest file), written to the stream, and the central
 * directory is emitted on finish(). No ZIP64: keep exports under 4 GB.
 */
class ZipWriter {
  constructor(out) {
    this.out = out;
    this.offset = 0;
    this.entries = [];
    const d = new Date();
    this.time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    this.date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }

  _write(buf) {
    this.out.write(buf);
    this.offset += buf.length;
  }

  /** Add a file. Set store=true for already-compressed data such as audio. */
  add(name, data, { store = false } = {}) {
    if (typeof data === 'string') data = Buffer.from(data, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data) >>> 0;
    const method = store ? 0 : 8;
    const body = store ? data : zlib.deflateRawSync(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6); // UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(this.time, 10);
    header.writeUInt16LE(this.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);

    this.entries.push({ nameBuf, crc, method, compSize: body.length, size: data.length, offset: this.offset });
    this._write(header);
    this._write(nameBuf);
    this._write(body);
  }

  finish() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(20, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(0x0800, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(this.time, 12);
      c.writeUInt16LE(this.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compSize, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28);
      c.writeUInt32LE(e.offset, 42);
      this._write(c);
      this._write(e.nameBuf);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this._write(end);
    this.out.end();
  }
}

/** Rows (array of flat objects) -> CSV string. */
function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

module.exports = { ZipWriter, toCsv };
