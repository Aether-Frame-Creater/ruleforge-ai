/**
 * Generates the demo circular used to exercise the pipeline end to end.
 *
 * Run with `npm run demo:circular`. Output: samples/circulars/demo-aml-cash-threshold.pdf
 *
 * The document is written in the style of an RBI master-circular amendment and
 * is clearly marked as a sample. Paragraph 3 lowers the cash-deposit reporting
 * threshold, which should drive a modification of R-101; paragraphs 5 and 6 are
 * process obligations that need no rule change at all.
 *
 * Note on currency: pdf-lib's standard fonts are WinAnsi-encoded and cannot
 * represent the rupee sign (U+20B9), so amounts are written as "Rs." — which
 * is also how many circulars render in plain text.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUTPUT = "samples/circulars/demo-aml-cash-threshold.pdf";

const DISCLAIMER = "SAMPLE FOR DEMONSTRATION - NOT AN OFFICIAL RBI DOCUMENT";

const HEADER = [
  "RESERVE BANK OF INDIA",
  "Department of Regulation",
  "Central Office, Mumbai 400001",
];

const META = [
  "RBI/2026-27/118",
  "DOR.AML.REC.42/14.01.001/2026-27",
  "October 12, 2026",
];

const SUBJECT =
  "Subject: Revision of Reporting Threshold for Cash Deposit Transactions";

const SALUTATION = [
  "The Chairman / Managing Director / Chief Executive Officer",
  "All Scheduled Commercial Banks (excluding Regional Rural Banks)",
  "All Small Finance Banks and Payments Banks",
];

/** Numbered paragraphs. The paragraph number becomes the `paragraph_ref`. */
const PARAGRAPHS: ReadonlyArray<{ number: string; text: string }> = [
  {
    number: "1",
    text:
      "Please refer to the Master Direction on Know Your Customer (KYC) Direction, 2016, " +
      "as amended from time to time, and to paragraph 4.2 of the Master Circular on " +
      "Monitoring of Transactions dated April 1, 2024, which prescribes the threshold " +
      "above which cash deposit transactions are to be reported to the Financial " +
      "Intelligence Unit - India (FIU-IND).",
  },
  {
    number: "2",
    text:
      "On a review of the prevailing cash usage patterns and in order to strengthen the " +
      "monitoring of cash-intensive accounts, it has been decided to lower the reporting " +
      "threshold for cash deposits. These instructions are applicable to all banks " +
      "licensed to accept deposits in India.",
  },
  {
    number: "3",
    text:
      "Accordingly, with effect from December 1, 2026, every cash deposit of " +
      "Rs. 5,00,000 (Rupees five lakh only) or more accepted in a single transaction in " +
      "Indian Rupees shall be reported to FIU-IND. The erstwhile threshold of " +
      "Rs. 10,00,000 (Rupees ten lakh only) specified in paragraph 4.2 of the Master " +
      "Circular dated April 1, 2024 stands withdrawn from that date.",
  },
  {
    number: "4",
    text:
      "Banks shall ensure that the revised threshold is applied at the point of " +
      "acceptance of the deposit, irrespective of whether the deposit is tendered at a " +
      "branch counter or at a cash recycler machine, and irrespective of the mode of " +
      "credit to the beneficiary account.",
  },
  {
    number: "5",
    text:
      "The report in respect of each such transaction shall be submitted to FIU-IND not " +
      "later than seven working days from the date of the transaction, in the prescribed " +
      "electronic format. Banks shall retain the underlying records for a period of five " +
      "years from the date of the transaction.",
  },
  {
    number: "6",
    text:
      "Banks shall display the revised threshold prominently at all branch cash counters " +
      "and shall sensitise frontline staff through their internal training programmes " +
      "within sixty days of the date of this circular. This paragraph is advisory in " +
      "nature and does not by itself alter any transaction monitoring parameter.",
  },
];

const CLOSING = [
  "Yours faithfully,",
  "(Illustrative Signatory)",
  "Chief General Manager",
];

const FOOTER =
  "This document is synthetic sample data created for a software demonstration. " +
  "It is not issued by, endorsed by, or affiliated with the Reserve Bank of India.";

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const LINE_HEIGHT = 14;

async function main() {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Revision of Reporting Threshold for Cash Deposit Transactions");
  pdf.setSubject(DISCLAIMER);
  pdf.setAuthor("RuleForge AI sample generator");
  pdf.setProducer("RuleForge AI");

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const usableWidth = PAGE_WIDTH - MARGIN * 2;

  function newPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  /** Splits `text` into lines that fit `width` at the given font and size. */
  function wrap(
    text: string,
    font: typeof regular,
    size: number,
    width: number,
  ): string[] {
    const lines: string[] = [];
    let current = "";

    for (const word of text.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  function write(
    text: string,
    options: {
      font?: typeof regular;
      size?: number;
      indent?: number;
      align?: "left" | "center";
      color?: ReturnType<typeof rgb>;
      spacing?: number;
    } = {},
  ) {
    const font = options.font ?? regular;
    const size = options.size ?? BODY_SIZE;
    const indent = options.indent ?? 0;
    const color = options.color ?? rgb(0, 0, 0);
    const lineHeight = options.spacing ?? LINE_HEIGHT;

    for (const line of wrap(text, font, size, usableWidth - indent)) {
      if (y < MARGIN + lineHeight) newPage();
      const x =
        options.align === "center"
          ? (PAGE_WIDTH - font.widthOfTextAtSize(line, size)) / 2
          : MARGIN + indent;
      page.drawText(line, { x, y, size, font, color });
      y -= lineHeight;
    }
  }

  function gap(amount = 8) {
    y -= amount;
  }

  // Disclaimer banner, boxed so it cannot be mistaken for part of the text.
  page.drawRectangle({
    x: MARGIN - 8,
    y: y - 20,
    width: usableWidth + 16,
    height: 28,
    borderColor: rgb(0.6, 0.1, 0.1),
    borderWidth: 1,
    color: rgb(0.99, 0.95, 0.95),
  });
  y -= 14;
  write(DISCLAIMER, {
    font: bold,
    size: 11,
    align: "center",
    color: rgb(0.6, 0.1, 0.1),
  });
  gap(18);

  for (const line of HEADER) {
    write(line, { font: bold, size: line === HEADER[0] ? 13 : 10, align: "center" });
  }
  gap(16);

  for (const line of META) {
    write(line, { font: regular, size: 10 });
  }
  gap(14);

  for (const line of SALUTATION) {
    write(line, { font: regular, size: 10 });
  }
  gap(16);

  write(SUBJECT, { font: bold, size: 11 });
  gap(14);

  write("Madam / Dear Sir,", { size: 10 });
  gap(12);

  for (const paragraph of PARAGRAPHS) {
    // The number is drawn in the margin so the body text stays block-aligned,
    // which keeps "Para 3" unambiguous when the text is extracted again.
    if (y < MARGIN + LINE_HEIGHT * 2) newPage();
    const numberY = y;
    page.drawText(`${paragraph.number}.`, {
      x: MARGIN,
      y: numberY,
      size: BODY_SIZE,
      font: bold,
    });
    write(paragraph.text, { indent: 24 });
    gap(8);
  }

  gap(10);
  for (const line of CLOSING) {
    write(line, { size: 10 });
  }

  gap(10);
  write(FOOTER, { font: italic, size: 8.5, color: rgb(0.35, 0.35, 0.35), spacing: 11 });

  const bytes = await pdf.save();
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, bytes);

  console.log(`wrote ${OUTPUT} (${(bytes.length / 1024).toFixed(1)} KB, ${pdf.getPageCount()} page(s))`);
  console.log(`paragraphs: ${PARAGRAPHS.length}`);
}

main().catch((error) => {
  console.error("failed to generate the demo circular:");
  console.error(error);
  process.exit(1);
});
