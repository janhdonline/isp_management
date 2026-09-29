import ExcelJS from "exceljs";
import { getSettings } from "@/lib/settings";

/**
 * Real .xlsx export.
 *
 * CSV is fine for a quick look and useless for the month end: an accountant
 * opening it in Excel or importing it into accounting software needs real
 * cells, real numbers, and dates that arrive as dates rather than as text
 * someone has to clean up.
 *
 * Each sheet gets a styled header, frozen panes, an auto-filter and sized
 * columns, so the file that lands is something a person can use without
 * tidying it first.
 */

export type ExcelColumn = {
  header: string;
  /** Pre-formatted display value, for text columns. */
  value: (row: Record<string, unknown>) => string;
  /** The raw value for numeric and date columns, so Excel can sort and total. */
  raw?: (row: Record<string, unknown>) => number | Date | null;
  width?: number;
  /** Money columns get the thousands separator and two decimals. */
  money?: boolean;
};

export type ExcelSheet = {
  name: string;
  columns: ExcelColumn[];
  rows: Record<string, unknown>[];
  /** A line under the title stating what the numbers cover. */
  subtitle?: string;
};

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
  row.alignment = { vertical: "middle", horizontal: "left" };
  row.height = 22;
}

/**
 * Builds a workbook from one or more sheets.
 *
 * @param title  Document title, printed above the table.
 */
export async function buildWorkbook(
  title: string,
  sheets: ExcelSheet[],
  { landscape = false }: { landscape?: boolean } = {}
): Promise<{ buffer: Buffer; filename: string }> {
  const settings = await getSettings();
  const company = settings["company.name"] ?? "ISP";
  const currency = settings["company.currency"] ?? "BDT";

  const wb = new ExcelJS.Workbook();
  wb.creator = company;
  wb.created = new Date();

  sheets.forEach((sheet, sheetIndex) => {
    // Excel forbids these characters in a sheet name, and a 31-character cap.
    const safeName =
      sheet.name.replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || `Sheet${sheetIndex + 1}`;

    const ws = wb.addWorksheet(safeName, {
      views: [{ state: "frozen", ySplit: 4 }],
      pageSetup: { orientation: landscape ? "landscape" : "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    // Column letters have to exist before the title can be merged across them.
    const lastCol = Math.max(sheet.columns.length, 1);

    ws.mergeCells(1, 1, 1, lastCol);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 14 };

    ws.mergeCells(2, 1, 2, lastCol);
    const meta = ws.getCell(2, 1);
    meta.value = [
      company,
      sheet.subtitle,
      `Generated ${new Date().toLocaleString("en-GB")}`,
    ]
      .filter(Boolean)
      .join("  ·  ");
    meta.font = { size: 9, color: { argb: "FF666666" } };

    ws.getRow(3).height = 6;

    const headerRow = ws.getRow(4);
    sheet.columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      ws.getColumn(i + 1).width = col.width ?? Math.min(40, Math.max(12, col.header.length + 6));
    });
    styleHeader(headerRow);

    for (const row of sheet.rows) {
      const added = ws.addRow({});
      sheet.columns.forEach((col, i) => {
        const cell = added.getCell(i + 1);
        if (col.raw) {
          const v = col.raw(row);
          if (v instanceof Date) {
            cell.value = v;
            cell.numFmt = "dd/mm/yyyy";
          } else if (typeof v === "number") {
            cell.value = v;
            if (col.money) {
              // Stored without the currency symbol: a symbol in a cell turns
              // the value into text and stops Excel totalling the column.
              cell.numFmt = `#,##0.00 "${currency}"`;
            } else {
              cell.numFmt = "#,##0.##";
            }
          } else {
            cell.value = v ?? null;
          }
        } else {
          cell.value = col.value(row);
        }
      });
    }

    const lastRow = 4 + sheet.rows.length;
    if (sheet.rows.length) {
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: lastRow, column: lastCol } };
    }

    // A total row, but only where a total is meaningful.
    const moneyCols = sheet.columns
      .map((c, i) => ({ col: c, index: i + 1 }))
      .filter((c) => c.col.money && c.col.raw);
    if (moneyCols.length && sheet.rows.length) {
      const totalRow = ws.getRow(lastRow + 1);
      totalRow.getCell(1).value = "Total";
      totalRow.getCell(1).font = { bold: true };
      for (const { index } of moneyCols) {
        const colLetter = ws.getColumn(index).letter;
        const cell = totalRow.getCell(index);
        cell.value = { formula: `SUM(${colLetter}5:${colLetter}${lastRow})` };
        cell.font = { bold: true };
        cell.numFmt = `#,##0.00 "${currency}"`;
      }
    }
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `${title.replace(/[^\w-]+/g, "-").toLowerCase()}.xlsx` };
}
