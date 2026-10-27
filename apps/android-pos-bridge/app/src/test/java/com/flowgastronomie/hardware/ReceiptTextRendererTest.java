package com.flowgastronomie.hardware;
import org.json.JSONObject;
import org.junit.Test;
import java.util.List;
import static org.junit.Assert.*;

public class ReceiptTextRendererTest {
    private JSONObject receipt() throws Exception {
        return new JSONObject("{\"status\":\"FINALIZED\",\"number\":\"R-001\",\"issuedAt\":\"2026-10-14T12:00:00Z\",\"currency\":\"ALL\",\"netMinor\":150000,\"taxMinor\":30000,\"grossMinor\":180000,\"method\":\"CASH\",\"receivedMinor\":200000,\"changeMinor\":20000,\"business\":{\"legalName\":\"Pica ë ç Ä Ö Ü ß €\",\"venueName\":\"Pilot\",\"addressLine1\":\"Test 1\",\"city\":\"Tiranë\",\"postalCode\":\"1001\",\"countryCode\":\"AL\",\"vatId\":null},\"cashier\":{\"displayName\":\"Test\"},\"items\":[{\"quantity\":2,\"productName\":\"Pica\",\"variantName\":\"E madhe\",\"modifiers\":[{\"optionName\":\"Djathë\"}],\"grossMinor\":180000}],\"breakdown\":[{\"taxCode\":\"TEST\",\"rateBasisPoints\":2000,\"netMinor\":150000,\"taxMinor\":30000}]}");
    }
    @Test public void preservesSnapshotAmountsAndUnicodeAtBothWidths() throws Exception {
        for (int width : new int[]{32, 48}) {
            List<String> lines = ReceiptTextRenderer.render(receipt(), width);
            String text = String.join("\n", lines);
            assertTrue(text.contains("Pica ë ç Ä Ö Ü ß €"));
            assertTrue(text.contains("Total: 1800.00 ALL"));
            assertTrue(text.contains("Change: 200.00 ALL"));
            assertTrue(text.contains("E madhe"));
            assertTrue(text.contains("Djathë"));
            for (String line : lines) assertTrue(line.codePointCount(0, line.length()) <= width);
        }
    }
    @Test public void removesPrinterControlCharactersAndPreservesSurrogatePairs() throws Exception {
        JSONObject r = receipt();
        r.getJSONObject("business").put("legalName", "\u001b@" + "🍕".repeat(40));
        for (String line : ReceiptTextRenderer.render(r, 32)) {
            assertFalse(line.contains("\u001b"));
            assertFalse(line.contains("\ufffd"));
            assertTrue(line.codePointCount(0, line.length()) <= 32);
        }
    }
    @Test(expected=IllegalArgumentException.class) public void rejectsDrafts() throws Exception {
        ReceiptTextRenderer.render(receipt().put("status", "DRAFT"), 32);
    }
}
