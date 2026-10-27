package com.flowgastronomie.hardware;

import org.json.JSONArray;
import org.json.JSONObject;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

/** Unicode text layout shared by integrated SDK and external printer adapters.
 * Transport, charset encoding, cutter and drawer remain device responsibilities.
 * Amounts come exclusively from the signed finalized snapshot, never tax calculation.
 */
final class ReceiptTextRenderer {
    static List<String> render(JSONObject receipt, int columns) throws Exception {
        if (columns < 24 || columns > 64 || !"FINALIZED".equals(receipt.getString("status")))
            throw new IllegalArgumentException("Unsupported receipt layout");
        List<String> lines = new ArrayList<>();
        JSONObject business = receipt.getJSONObject("business");
        for (String field : new String[]{"legalName", "venueName", "addressLine1"})
            append(lines, business.getString(field), columns);
        append(lines, business.getString("postalCode") + " " + business.getString("city"), columns);
        append(lines, business.getString("countryCode"), columns);
        if (!business.isNull("vatId")) append(lines, "VAT ID: " + business.getString("vatId"), columns);
        append(lines, "#" + receipt.getString("number"), columns);
        append(lines, receipt.getString("issuedAt"), columns);
        append(lines, receipt.getJSONObject("cashier").getString("displayName"), columns);
        lines.add("-".repeat(columns));
        JSONArray items = receipt.getJSONArray("items");
        String currency = receipt.getString("currency");
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.getJSONObject(i);
            append(lines, item.getInt("quantity") + " x " + item.getString("productName"), columns);
            if (!item.isNull("variantName")) append(lines, item.getString("variantName"), columns);
            JSONArray modifiers = item.getJSONArray("modifiers");
            for (int j = 0; j < modifiers.length(); j++)
                append(lines, "+ " + modifiers.getJSONObject(j).getString("optionName"), columns);
            append(lines, money(item.getLong("grossMinor"), currency), columns);
        }
        lines.add("-".repeat(columns));
        append(lines, "Net: " + money(receipt.getLong("netMinor"), currency), columns);
        append(lines, "Tax: " + money(receipt.getLong("taxMinor"), currency), columns);
        append(lines, "Total: " + money(receipt.getLong("grossMinor"), currency), columns);
        JSONArray tax = receipt.getJSONArray("breakdown");
        for (int i = 0; i < tax.length(); i++) {
            JSONObject group = tax.getJSONObject(i);
            append(lines, group.getString("taxCode") + " " + BigDecimal.valueOf(group.getLong("rateBasisPoints"), 2).toPlainString() + "%", columns);
            append(lines, "Net: " + money(group.getLong("netMinor"), currency), columns);
            append(lines, "Tax: " + money(group.getLong("taxMinor"), currency), columns);
        }
        append(lines, receipt.getString("method"), columns);
        if (!receipt.isNull("receivedMinor")) append(lines, "Received: " + money(receipt.getLong("receivedMinor"), currency), columns);
        if (!receipt.isNull("changeMinor")) append(lines, "Change: " + money(receipt.getLong("changeMinor"), currency), columns);
        if (!receipt.isNull("footer")) append(lines, receipt.getString("footer"), columns);
        return List.copyOf(lines);
    }
    private static String money(long minor, String currency) {
        return BigDecimal.valueOf(minor, 2).toPlainString() + " " + currency;
    }
    private static void append(List<String> lines, String value, int columns) {
        // Never allow descriptive text to inject ESC/POS control bytes.
        String safe = value.replaceAll("[\\p{Cc}\\p{Cf}]", " ");
        int[] points = safe.codePoints().toArray();
        if (points.length == 0) return;
        for (int start = 0; start < points.length; start += columns)
            lines.add(new String(points, start, Math.min(columns, points.length - start)));
    }
}
