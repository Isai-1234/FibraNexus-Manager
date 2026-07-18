/**
 * PDF de factura interna (no DTE).
 */
import PDFDocument from 'pdfkit';

/**
 * @param {object} opts
 * @param {object} opts.invoice
 * @param {object} opts.client
 * @param {object} [opts.org]
 * @param {number} [opts.paidSum]
 * @param {number} [opts.balance]
 * @returns {Promise<Buffer>}
 */
export function buildInvoicePdfBuffer({ invoice, client, org, paidSum = 0, balance = null }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const orgName = org?.name || 'ISP';
    const total = Number(invoice.total || 0);
    const amount = Number(invoice.amount || 0);
    const tax = Number(invoice.tax || 0);
    const paid = Number(paidSum || 0);
    const bal = balance != null ? Number(balance) : Math.max(0, total - paid);

    doc.fontSize(18).fillColor('#111827').text(orgName, { continued: false });
    doc.fontSize(10).fillColor('#6b7280').text('Factura interna — no es DTE / boleta electrónica');
    doc.moveDown();

    doc.fontSize(14).fillColor('#111827').text(invoice.invoiceNumber || `Factura #${invoice.id}`);
    doc.fontSize(10).fillColor('#374151');
    doc.text(`Estado: ${invoice.status || '—'}`);
    doc.text(`Emitida: ${formatDate(invoice.createdAt)}`);
    doc.text(`Vence: ${formatDate(invoice.dueDate)}`);
    if (invoice.billingPeriod) doc.text(`Período: ${invoice.billingPeriod}`);
    doc.moveDown();

    doc.fontSize(12).fillColor('#111827').text('Abonado');
    doc.fontSize(10).fillColor('#374151');
    doc.text(client?.fullName || client?.user?.fullName || `Cliente #${invoice.clientId}`);
    if (client?.email || client?.user?.email) doc.text(client.email || client.user.email);
    if (client?.rut) doc.text(`RUT: ${client.rut}`);
    if (client?.address) doc.text(client.address);
    doc.moveDown();

    doc.fontSize(12).fillColor('#111827').text('Detalle');
    doc.moveDown(0.3);
    const tableTop = doc.y;
    doc.fontSize(10).fillColor('#6b7280');
    doc.text('Concepto', 50, tableTop);
    doc.text('Monto', 400, tableTop, { width: 140, align: 'right' });
    doc.moveTo(50, tableTop + 14).lineTo(545, tableTop + 14).strokeColor('#e5e7eb').stroke();
    doc.fillColor('#111827');
    doc.text('Servicio / plan (neto)', 50, tableTop + 22);
    doc.text(`$ ${amount.toLocaleString('es-CL')}`, 400, tableTop + 22, { width: 140, align: 'right' });
    doc.text('IVA', 50, tableTop + 40);
    doc.text(`$ ${tax.toLocaleString('es-CL')}`, 400, tableTop + 40, { width: 140, align: 'right' });
    doc.moveTo(50, tableTop + 58).lineTo(545, tableTop + 58).strokeColor('#e5e7eb').stroke();
    doc.fontSize(11).text('Total', 50, tableTop + 68);
    doc.text(`$ ${total.toLocaleString('es-CL')}`, 400, tableTop + 68, { width: 140, align: 'right' });
    doc.fontSize(10).fillColor('#374151');
    doc.text(`Pagado: $ ${paid.toLocaleString('es-CL')}`, 50, tableTop + 90);
    doc.text(`Saldo: $ ${bal.toLocaleString('es-CL')}`, 50, tableTop + 106);

    doc.moveDown(4);
    doc.fontSize(8).fillColor('#9ca3af')
      .text('Documento interno generado por FibraNexus Manager. No constituye documento tributario electrónico.', 50, 750, {
        width: 495,
        align: 'center',
      });

    doc.end();
  });
}

function formatDate(value) {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toLocaleDateString('es-CL');
  } catch {
    return String(value);
  }
}
