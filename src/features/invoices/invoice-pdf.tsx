import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { InvoiceDetail, InvoiceItemRow } from "./queries";
import { formatMinor, type Currency } from "./money";

/**
 * Invoice PDF (ADR-0009): server-rendered with @react-pdf/renderer.
 *
 * This module is server-only (route handler + email attachment); never
 * import it from a client component — the renderer pulls Node stream
 * APIs. Money stays integer minor units until formatMinor draws it, so
 * the PDF shows exactly the numbers the database computed (ADR-0003).
 */

export type InvoicePdfProps = {
  orgName: string;
  invoice: Pick<
    InvoiceDetail,
    | "number"
    | "currency"
    | "subtotal_minor"
    | "tax_rate_bps"
    | "tax_minor"
    | "total_minor"
    | "issue_date"
    | "due_date"
    | "notes"
    | "clients"
  >;
  items: InvoiceItemRow[];
};

const s = StyleSheet.create({
  page: {
    padding: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#18181b",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  orgName: { fontSize: 15, fontWeight: "bold", maxWidth: 260 },
  titleBlock: { alignItems: "flex-end" },
  title: { fontSize: 22, fontWeight: "bold" },
  number: { fontSize: 11, marginTop: 4 },
  meta: { fontSize: 9, color: "#71717a", marginTop: 6, textAlign: "right" },
  party: { marginBottom: 22 },
  partyLabel: {
    fontSize: 8,
    color: "#71717a",
    marginBottom: 3,
  },
  partyName: { fontSize: 12, fontWeight: "bold" },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#18181b",
    paddingBottom: 5,
    marginBottom: 2,
  },
  th: { fontSize: 8, color: "#52525b", fontWeight: "bold" },
  row: {
    flexDirection: "row",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e4e4e7",
  },
  cDesc: { width: "52%" },
  cQty: { width: "12%", textAlign: "right" },
  cUnit: { width: "18%", textAlign: "right" },
  cTotal: { width: "18%", textAlign: "right" },
  totals: { marginTop: 14, alignSelf: "flex-end", width: 240 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  totalLabel: { color: "#52525b" },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#18181b",
    marginTop: 5,
    paddingTop: 7,
    fontWeight: "bold",
    fontSize: 12,
  },
  notes: {
    marginTop: 30,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e4e4e7",
    fontSize: 9,
    color: "#3f3f46",
  },
  footer: {
    position: "absolute",
    bottom: 32,
    left: 48,
    right: 48,
    fontSize: 8,
    color: "#a1a1aa",
  },
});

function money(minor: number, currency: Currency): string {
  return formatMinor(minor, currency);
}

export function InvoicePdf({ orgName, invoice, items }: InvoicePdfProps) {
  // Same cast as the invoice page: the row schema types currency as a
  // string; the DB CHECK narrows it to the CURRENCIES set.
  const currency = invoice.currency as Currency;
  const taxPercent = (invoice.tax_rate_bps / 100).toFixed(2);

  return (
    <Document title={invoice.number ?? "Invoice"} author={orgName}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.orgName}>{orgName}</Text>
          <View style={s.titleBlock}>
            <Text style={s.title}>INVOICE</Text>
            <Text style={s.number}>{invoice.number ?? "(draft)"}</Text>
            <Text style={s.meta}>
              Issued {invoice.issue_date}
              {invoice.due_date ? `\nDue ${invoice.due_date}` : ""}
            </Text>
          </View>
        </View>

        <View style={s.party}>
          <Text style={s.partyLabel}>BILL TO</Text>
          <Text style={s.partyName}>{invoice.clients?.name ?? "Client"}</Text>
        </View>

        <View style={s.tableHead}>
          <Text style={[s.th, s.cDesc]}>Description</Text>
          <Text style={[s.th, s.cQty]}>Qty</Text>
          <Text style={[s.th, s.cUnit]}>Unit price</Text>
          <Text style={[s.th, s.cTotal]}>Total</Text>
        </View>

        {items.map((item) => (
          <View key={item.id} style={s.row} wrap={false}>
            <Text style={s.cDesc}>{item.description}</Text>
            <Text style={s.cQty}>{String(item.quantity)}</Text>
            <Text style={s.cUnit}>{money(item.unit_price_minor, currency)}</Text>
            <Text style={s.cTotal}>{money(item.line_total_minor, currency)}</Text>
          </View>
        ))}

        <View style={s.totals}>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Subtotal</Text>
            <Text>{money(invoice.subtotal_minor, currency)}</Text>
          </View>
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>Tax ({taxPercent}%)</Text>
            <Text>{money(invoice.tax_minor, currency)}</Text>
          </View>
          <View style={s.grand}>
            <Text>Total</Text>
            <Text>{money(invoice.total_minor, currency)}</Text>
          </View>
        </View>

        {invoice.notes && (
          <View style={s.notes}>
            <Text>Notes</Text>
            <Text style={{ marginTop: 4 }}>{invoice.notes}</Text>
          </View>
        )}

        <Text style={s.footer}>
          Generated by Facturio · amounts in minor units, DB-computed
        </Text>
      </Page>
    </Document>
  );
}

/** Buffer whose first bytes are %PDF- — pinned by the vitest smoke test. */
export async function renderInvoicePdf(props: InvoicePdfProps): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf {...props} />);
}
