/**
 * A minimal XLSX writer, hand-rolled.
 *
 * `PROJECT-PLAN.md` P5 planned this as ClosedXML on the server. There is no
 * server, and rule 12 makes every package a bundle-size decision against a
 * 150 kB budget — SheetJS alone is several times this whole application. So it
 * is written here: an .xlsx is a ZIP of five small XML files, and the parts of
 * that this needs fit in one module.
 *
 * The ZIP is **stored, not deflated**. `CompressionStream` would shrink it, but
 * it is async, it is not on every engine this has to run on, and the file is a
 * few hundred kilobytes either way for a ledger this size. Stored entries are
 * the version that is a pure function and can be tested.
 *
 * Money never becomes a float on the way out. A cell value is built from the
 * integer's own digits — `-123456` haléře is assembled into the four characters
 * of `-1234.56` — which is the same reason `formatMoney` splits rather than
 * divides. The spreadsheet receives an exact decimal literal.
 *
 * Pure (§13.6). No Dexie, no fetch, no DOM.
 */

import type { Minor } from './money';

export type CellValue = string | number | Minor | { money: Minor } | { date: string } | null;

export interface Sheet {
	/** Becomes the tab name. Excel forbids []:*?/\ and caps it at 31 characters. */
	name: string;
	/** The first row is the header, and is styled bold. */
	header: readonly string[];
	rows: readonly (readonly CellValue[])[];
}

// ── the decimal string, built from integer digits ───────────────────────────

/**
 * `-123456` → `"-1234.56"`, without dividing anything.
 *
 * A period rather than a comma: this is the cell's raw value in the XML, which
 * is locale-independent by specification. Excel renders it with whatever
 * separator the reader's own locale uses, which is what makes the file portable
 * between a Czech machine and any other.
 */
export function moneyLiteral(value: Minor | number): string {
	const negative = value < 0;
	const magnitude = Math.abs(Math.trunc(value));
	const koruny = Math.trunc(magnitude / 100);
	const halere = magnitude % 100;
	return `${negative ? '-' : ''}${koruny}.${String(halere).padStart(2, '0')}`;
}

// ── XML ─────────────────────────────────────────────────────────────────────

const XML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;'
};

function escapeXml(text: string): string {
	let out = '';
	for (const ch of text) {
		const escaped = XML_ESCAPES[ch];
		if (escaped !== undefined) {
			out += escaped;
			continue;
		}
		// Control characters are not representable in XML 1.0 at all, and a payee
		// pasted from a bank statement is exactly where one turns up. Tab, newline
		// and carriage return are the three that are legal, and they survive.
		const code = ch.codePointAt(0) ?? 0;
		if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) continue;
		out += ch;
	}
	return out;
}

/** A1, B1 … Z1, AA1. Columns are 0-based here and 1-based in the file. */
function cellRef(column: number, row: number): string {
	let name = '';
	let n = column;
	do {
		name = String.fromCharCode(65 + (n % 26)) + name;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return `${name}${row + 1}`;
}

/** Excel's serial day number. Day 0 is 1899-12-30 — the famous 1900 leap bug. */
function dateSerial(iso: string): number {
	const [y, m, d] = iso.split('-').map(Number);
	if (!y || !m || !d) return 0;
	return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_MONEY = 2;
const STYLE_DATE = 3;

function cellXml(value: CellValue, column: number, row: number, header: boolean): string {
	const ref = cellRef(column, row);
	if (value === null || value === '') return '';

	if (header) {
		return `<c r="${ref}" s="${STYLE_HEADER}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
	}
	if (typeof value === 'object' && 'money' in value) {
		return `<c r="${ref}" s="${STYLE_MONEY}"><v>${moneyLiteral(value.money)}</v></c>`;
	}
	if (typeof value === 'object' && 'date' in value) {
		return `<c r="${ref}" s="${STYLE_DATE}"><v>${dateSerial(value.date)}</v></c>`;
	}
	if (typeof value === 'number') {
		return `<c r="${ref}" s="${STYLE_DEFAULT}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
	}
	return `<c r="${ref}" s="${STYLE_DEFAULT}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function sheetXml(sheet: Sheet): string {
	const rows: string[] = [];

	rows.push(`<row r="1">${sheet.header.map((h, i) => cellXml(h, i, 0, true)).join('')}</row>`);
	sheet.rows.forEach((row, index) => {
		const cells = row.map((value, column) => cellXml(value, column, index + 1, false)).join('');
		rows.push(`<row r="${index + 2}">${cells}</row>`);
	});

	// A frozen header, because a ledger is read by scrolling.
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

/** Excel truncates and rejects; do it here so the file is never the one at fault. */
function safeSheetName(name: string, index: number): string {
	const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim();
	return (cleaned || `List ${index + 1}`).slice(0, 31);
}

// ── ZIP (stored) ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let c = i;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

interface Entry {
	path: string;
	bytes: Uint8Array;
}

function writeUint32(target: number[], value: number): void {
	target.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function writeUint16(target: number[], value: number): void {
	target.push(value & 0xff, (value >>> 8) & 0xff);
}

/**
 * A ZIP with every entry stored uncompressed.
 *
 * No timestamps: every entry is stamped 1980-01-01, which is the DOS epoch and
 * the value a zero date field means. That makes the output a pure function of
 * its input — the same ledger exports byte-identical twice — which is worth
 * more here than a modification date nobody reads.
 */
function zip(entries: readonly Entry[]): Uint8Array {
	const local: number[] = [];
	const central: number[] = [];
	const offsets: number[] = [];

	for (const entry of entries) {
		const name = new TextEncoder().encode(entry.path);
		const sum = crc32(entry.bytes);
		offsets.push(local.length);

		writeUint32(local, 0x04034b50); // local file header
		writeUint16(local, 20); // version needed
		writeUint16(local, 0); // flags
		writeUint16(local, 0); // method: stored
		writeUint16(local, 0); // time
		writeUint16(local, 33); // date: 1980-01-01
		writeUint32(local, sum);
		writeUint32(local, entry.bytes.length);
		writeUint32(local, entry.bytes.length);
		writeUint16(local, name.length);
		writeUint16(local, 0); // extra
		local.push(...name, ...entry.bytes);
	}

	entries.forEach((entry, index) => {
		const name = new TextEncoder().encode(entry.path);
		const sum = crc32(entry.bytes);

		writeUint32(central, 0x02014b50); // central directory header
		writeUint16(central, 20); // version made by
		writeUint16(central, 20); // version needed
		writeUint16(central, 0); // flags
		writeUint16(central, 0); // method
		writeUint16(central, 0); // time
		writeUint16(central, 33); // date
		writeUint32(central, sum);
		writeUint32(central, entry.bytes.length);
		writeUint32(central, entry.bytes.length);
		writeUint16(central, name.length);
		writeUint16(central, 0); // extra
		writeUint16(central, 0); // comment
		writeUint16(central, 0); // disk
		writeUint16(central, 0); // internal attrs
		writeUint32(central, 0); // external attrs
		writeUint32(central, offsets[index]!);
		central.push(...name);
	});

	const end: number[] = [];
	writeUint32(end, 0x06054b50); // end of central directory
	writeUint16(end, 0);
	writeUint16(end, 0);
	writeUint16(end, entries.length);
	writeUint16(end, entries.length);
	writeUint32(end, central.length);
	writeUint32(end, local.length);
	writeUint16(end, 0); // comment

	return Uint8Array.from([...local, ...central, ...end]);
}

// ── the workbook ────────────────────────────────────────────────────────────

const CONTENT_TYPES = (count: number) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${Array.from(
	{ length: count },
	(_, i) =>
		`<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
).join('')}</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/**
 * Four formats, and no more.
 *
 * `#,##0.00` on money so a column of amounts lines up the way it does in the
 * app, and a plain date so a ledger sorts chronologically instead of
 * alphabetically. Everything else is General.
 */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="d/m/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

/** The bytes of an .xlsx holding one worksheet per sheet given. */
export function buildXlsx(sheets: readonly Sheet[]): Uint8Array {
	const named = sheets.map((sheet, index) => ({
		...sheet,
		name: safeSheetName(sheet.name, index)
	}));

	const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${named
		.map(
			(sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
		)
		.join('')}</sheets></workbook>`;

	const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${named
		.map(
			(_, i) =>
				`<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
		)
		.join(
			''
		)}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

	const encoder = new TextEncoder();
	const entries: Entry[] = [
		{ path: '[Content_Types].xml', bytes: encoder.encode(CONTENT_TYPES(named.length)) },
		{ path: '_rels/.rels', bytes: encoder.encode(ROOT_RELS) },
		{ path: 'xl/workbook.xml', bytes: encoder.encode(workbook) },
		{ path: 'xl/_rels/workbook.xml.rels', bytes: encoder.encode(workbookRels) },
		{ path: 'xl/styles.xml', bytes: encoder.encode(STYLES) },
		...named.map((sheet, i) => ({
			path: `xl/worksheets/sheet${i + 1}.xml`,
			bytes: encoder.encode(sheetXml(sheet))
		}))
	];

	return zip(entries);
}
