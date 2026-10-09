// Customer sheet (spec §6): one US Letter page, built with jsPDF + AutoTable and shrunk until it fits.
import type { jsPDF } from 'jspdf';
import type { Otd, Quote } from './financeCalc';
import { LENDER_LABEL, rateLabel } from './financeCalc';
import { isNativeApp } from '../../native/platform';

export interface SheetInput {
  brand: string;
  otd: Otd;
  downPayment: number;
  cartPrice: number;
  accessories: number;
  prepFee: number;
  deliveryFee: number;
  rows: Quote[];
  showRoadrunner: boolean;
  /** Optional cart line, e.g. "2024 Evolution D5 Ranger 4" */
  cartTitle?: string;
  /** Trade-in value (already taken off otd.loanAmount, like the down payment). */
  tradeIn?: number;
  /** Delivery by 3rd-party carrier, price to be confirmed (not included in the totals). */
  deliveryTbc?: boolean;
}

const TBC_NOTE = 'Delivery: price to be confirmed (3rd-party carrier) — not included in the prices above.';

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const RED: [number, number, number] = [176, 30, 47];
const SCALES = [1, 0.9, 0.8, 0.72, 0.65, 0.58, 0.52, 0.46];

async function build(input: SheetInput, scale: number) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;

  // Header band
  doc.setFillColor(...RED);
  doc.rect(0, 0, W, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold').setFontSize(22).text('Your financing options', M, 42);
  doc.setFont('helvetica', 'normal').setFontSize(11);
  doc.text(`${input.brand} · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, W - M, 42, { align: 'right' });
  let y = 92;
  doc.setTextColor(40, 40, 40);
  if (input.cartTitle) {
    doc.setFont('helvetica', 'bold').setFontSize(13).text(input.cartTitle, M, y);
    y += 16;
  }

  // Three boxes
  const boxes: Array<[string, number]> = [
    ['Out-the-door price', input.otd.otd],
    ...(input.tradeIn ? [['Trade-in', input.tradeIn] as [string, number]] : []),
    ['Down payment', input.downPayment],
    ['Amount to finance', input.otd.loanAmount],
  ];
  const gap = 12;
  const bw = (W - 2 * M - (boxes.length - 1) * gap) / boxes.length;
  const last = boxes.length - 1;
  boxes.forEach(([label, v], i) => {
    const x = M + i * (bw + gap);
    doc.setDrawColor(220, 220, 220).setFillColor(248, 248, 248).roundedRect(x, y, bw, 54, 6, 6, 'FD');
    doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(100, 100, 100).text(label, x + 12, y + 18);
    doc.setFont('helvetica', 'bold').setFontSize(boxes.length > 3 ? 15 : 18).setTextColor(i === last ? RED[0] : 30, i === last ? RED[1] : 30, i === last ? RED[2] : 30).text(money(v), x + 12, y + 42);
  });
  y += 70;

  // What the OTD includes
  const parts = [`Cart ${money(input.cartPrice)}`];
  if (input.accessories) parts.push(`accessories ${money(input.accessories)}`);
  if (input.prepFee) parts.push(`dealer prep ${money(input.prepFee)}`);
  if (input.deliveryFee) parts.push(`delivery ${money(input.deliveryFee)}`);
  else if (input.deliveryTbc) parts.push('delivery to be confirmed (not included)');
  if (input.otd.militaryDiscount) parts.push(`military discount −${money(input.otd.militaryDiscount)}`);
  if (input.otd.salesTax) parts.push(`sales tax ${money(input.otd.salesTax)}`);
  doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(90, 90, 90);
  const incl = doc.splitTextToSize(`Out-the-door price includes: ${parts.join(', ')}.`, W - 2 * M);
  doc.text(incl, M, y);
  y += incl.length * 12 + 8;

  // Table: months printed once per group, divider between groups
  const body: string[][] = [];
  let prevTerm = -1;
  const groupStart: number[] = [];
  input.rows.forEach((q, i) => {
    const first = q.option.term !== prevTerm;
    if (first) groupStart.push(i);
    body.push([first ? String(q.option.term) : '', LENDER_LABEL[q.option.lender], rateLabel(q.option), money(q.payment), money(q.totalOfPayments), q.option.note || '']);
    prevTerm = q.option.term;
  });
  const pad = Math.max(2, 6 * scale * scale);
  const fs = 10 * Math.max(scale, 0.8);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Months', 'Lender', 'Interest rate', 'Monthly payment', "Total you'll pay", 'Good to know']],
    body,
    theme: 'plain',
    styles: { fontSize: fs, cellPadding: { top: pad, bottom: pad, left: 6, right: 6 }, textColor: [40, 40, 40], valign: 'middle' },
    headStyles: { fillColor: [245, 245, 245], fontStyle: 'bold', textColor: [60, 60, 60] },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 52 },
      3: { fontStyle: 'bold', fontSize: 12 * Math.max(scale, 0.82), textColor: RED },
      5: { textColor: [110, 110, 110], fontSize: fs * 0.92 },
    },
    didDrawCell: (d) => {
      if (d.section === 'body' && d.column.index === 0 && groupStart.includes(d.row.index) && d.row.index > 0) {
        d.doc.setDrawColor(200, 200, 200).setLineWidth(0.6).line(M, d.cell.y, W - M, d.cell.y);
      }
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  if (input.deliveryTbc) y = tbcLine(doc, M, y, W);

  // Note box
  const note = 'These payments are estimates only. Your actual interest rate and monthly payment are set by the lender after a credit review, based on the credit tier you\'re approved for. The rates shown are for the highest credit tier, so your rate may be higher.';
  doc.setFont('helvetica', 'normal').setFontSize(9.5);
  const noteLines = doc.splitTextToSize(note, W - 2 * M - 24);
  const nh = 22 + noteLines.length * 12;
  doc.setFillColor(255, 247, 230).setDrawColor(240, 190, 90).roundedRect(M, y, W - 2 * M, nh, 6, 6, 'FD');
  doc.setTextColor(90, 60, 0).setFont('helvetica', 'bold').text('Please note: these are estimates.', M + 12, y + 16);
  doc.setFont('helvetica', 'normal').text(noteLines, M + 12, y + 30);
  y += nh + 12;

  doc.setTextColor(60, 60, 60).setFontSize(9.5);
  if (input.showRoadrunner) {
    const rr = doc.splitTextToSize('Other options are available for customers who are building credit. Approvals start at a 550 credit score. Ask us about a soft-pull application to see your payment.', W - 2 * M);
    doc.text(rr, M, y);
    y += rr.length * 12 + 6;
  }
  doc.setFontSize(8.5).setTextColor(120, 120, 120);
  const fine = doc.splitTextToSize('"Total you\'ll pay" is every monthly payment added together, including interest and loan fees. All financing is subject to credit approval by the lender. Program terms can change without notice.', W - 2 * M);
  doc.text(fine, M, y + 4);
  y += fine.length * 11 + 4;
  return { doc, fits: doc.getNumberOfPages() === 1 && y < doc.internal.pageSize.getHeight() - 20 };
}

/** Builds the sheet (shrinking until it fits one page) and saves it / hands it to the phone. */
export async function downloadCustomerSheet(input: SheetInput) {
  let built = await build(input, SCALES[0]);
  for (const s of SCALES.slice(1)) {
    if (built.fits) break;
    built = await build(input, s);
  }
  return savePdf(built.doc, `${input.brand.replace(/[^\w]+/g, '_')}-financing-${Math.round(input.otd.otd)}.pdf`);
}

/** One-option sheet: everything about the financing option the salesperson selected. */
export async function downloadOptionSheet(input: Omit<SheetInput, 'rows' | 'showRoadrunner'> & { choice: Quote }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const M = 40;
  const q = input.choice;
  const o = q.option;

  doc.setFillColor(...RED);
  doc.rect(0, 0, W, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold').setFontSize(22).text('Your financing quote', M, 42);
  doc.setFont('helvetica', 'normal').setFontSize(11);
  doc.text(`${input.brand} · ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, W - M, 42, { align: 'right' });
  let y = 92;
  doc.setTextColor(40, 40, 40);
  if (input.cartTitle) {
    doc.setFont('helvetica', 'bold').setFontSize(13).text(input.cartTitle, M, y);
    y += 18;
  }

  // Headline: the monthly payment for this option.
  doc.setDrawColor(220, 220, 220).setFillColor(248, 248, 248).roundedRect(M, y, W - 2 * M, 78, 6, 6, 'FD');
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(100, 100, 100)
    .text(`${LENDER_LABEL[o.lender]} · ${rateLabel(o)} · ${o.term} months${o.tier ? ` · Tier ${o.tier}` : ''}`, M + 14, y + 22);
  doc.setFont('helvetica', 'bold').setFontSize(30).setTextColor(...RED).text(`${money(q.payment)}/mo`, M + 14, y + 58);
  doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(60, 60, 60)
    .text(`for ${o.term} months · total ${money(q.totalOfPayments)}`, W - M - 14, y + 58, { align: 'right' });
  y += 96;

  const rows: Array<[string, string]> = [
    ['Cart price', money(input.cartPrice)],
    ...(input.accessories ? [['Accessories', money(input.accessories)] as [string, string]] : []),
    ...(input.prepFee ? [['Dealer prep fee', money(input.prepFee)] as [string, string]] : []),
    ...(input.deliveryFee ? [['Delivery', money(input.deliveryFee)] as [string, string]] : []),
    ...(input.deliveryTbc ? [['Delivery (3rd-party carrier)', 'To be confirmed'] as [string, string]] : []),
    ...(input.otd.militaryDiscount ? [['Military discount', `−${money(input.otd.militaryDiscount)}`] as [string, string]] : []),
    ...(input.otd.salesTax ? [['Sales tax', money(input.otd.salesTax)] as [string, string]] : []),
    ['Out-the-door price', money(input.otd.otd)],
    ...(input.tradeIn ? [['Trade-in', `−${money(input.tradeIn)}`] as [string, string]] : []),
    ...(input.downPayment ? [['Down payment', `−${money(input.downPayment)}`] as [string, string]] : []),
    ['Loan amount', money(input.otd.loanAmount)],
    ...(q.programFee ? [[`Program fee (${+(o.feePct * 100).toFixed(2)}% + $10)`, money(q.programFee)] as [string, string]] : []),
    ...(o.orig ? [['Origination fee', money(o.orig)] as [string, string]] : []),
    ['Amount financed', money(q.amountFinanced)],
    ['Interest rate', rateLabel(o)],
    ['Term', `${o.term} months`],
    ['Monthly payment', money(q.payment)],
    ["Total you'll pay (all payments)", money(q.totalOfPayments)],
    ['Total fees & interest', money(q.totalFeesAndInterest)],
    ...(o.note ? [['Good to know', o.note] as [string, string]] : []),
  ];
  const bold = new Set(['Out-the-door price', 'Amount financed', 'Monthly payment']);
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    body: rows,
    theme: 'plain',
    styles: { fontSize: 11, cellPadding: { top: 4, bottom: 4, left: 8, right: 8 }, textColor: [40, 40, 40] },
    columnStyles: { 1: { halign: 'right' } },
    didParseCell: (d) => {
      if (bold.has(String(d.row.raw && (d.row.raw as string[])[0]))) d.cell.styles.fontStyle = 'bold';
      if (d.row.index % 2 === 0) d.cell.styles.fillColor = [250, 250, 250];
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14;

  if (input.deliveryTbc) y = tbcLine(doc, M, y, W);
  const note = 'This payment is an estimate only. Your actual interest rate and monthly payment are set by the lender after a credit review, based on the credit tier you\'re approved for.';
  doc.setFont('helvetica', 'normal').setFontSize(9.5);
  const noteLines = doc.splitTextToSize(note, W - 2 * M - 24);
  const nh = 22 + noteLines.length * 12;
  doc.setFillColor(255, 247, 230).setDrawColor(240, 190, 90).roundedRect(M, y, W - 2 * M, nh, 6, 6, 'FD');
  doc.setTextColor(90, 60, 0).setFont('helvetica', 'bold').text('Please note: this is an estimate.', M + 12, y + 16);
  doc.setFont('helvetica', 'normal').text(noteLines, M + 12, y + 30);
  y += nh + 12;
  doc.setFontSize(8.5).setTextColor(120, 120, 120);
  doc.text(doc.splitTextToSize('All financing is subject to credit approval by the lender. Program terms can change without notice.', W - 2 * M), M, y + 4);

  const slug = `${LENDER_LABEL[o.lender]}-${o.term}mo`.replace(/[^\w]+/g, '_');
  return savePdf(doc, `${input.brand.replace(/[^\w]+/g, '_')}-${slug}-${Math.round(input.otd.otd)}.pdf`);
}

/** Bold red "Delivery: price to be confirmed" line; returns the next y. */
function tbcLine(doc: jsPDF, M: number, y: number, W: number): number {
  doc.setFont('helvetica', 'bold').setFontSize(10.5).setTextColor(...RED);
  const lines = doc.splitTextToSize(TBC_NOTE, W - 2 * M);
  doc.text(lines, M, y + 4);
  doc.setFont('helvetica', 'normal').setTextColor(40, 40, 40);
  return y + lines.length * 13 + 10;
}

async function savePdf(doc: jsPDF, name: string) {
  if (!isNativeApp()) {
    doc.save(name);
    return name;
  }
  // Phone app: save to the app's documents, then open the share sheet (Save to Files / Drive, or send to the customer).
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const data = doc.output('datauristring').split(',')[1];
  const saved = await Filesystem.writeFile({ path: `financing/${name}`, data, directory: Directory.Cache, recursive: true });
  await Share.share({ title: name, files: [saved.uri] });
  return name;
}
