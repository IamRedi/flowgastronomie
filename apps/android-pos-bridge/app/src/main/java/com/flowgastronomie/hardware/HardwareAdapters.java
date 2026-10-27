package com.flowgastronomie.hardware;

import org.json.JSONObject;

interface PrinterAdapter {
    JSONObject capabilities() throws Exception;
    String printReceipt(JSONObject finalizedSnapshot) throws Exception;
    String printTest() throws Exception;
}
interface DrawerAdapter { String openDrawer() throws Exception; }

/** SDK/USB/TCP implementations receive text only, after native signature and
 * journal checks. Trusted device configuration chooses width/encoding/transport;
 * no browser command may supply a host, port or raw printer bytes.
 */
abstract class TextPrinterAdapter implements PrinterAdapter {
    protected abstract int columns();
    protected abstract String printLines(java.util.List<String> lines) throws Exception;
    public final String printReceipt(JSONObject snapshot) throws Exception {
        if (!capabilities().getBoolean("printerAvailable")) return "PRINTER_UNAVAILABLE";
        return printLines(ReceiptTextRenderer.render(snapshot, columns()));
    }
    public final String printTest() throws Exception {
        if (!capabilities().getBoolean("printerAvailable")) return "PRINTER_UNAVAILABLE";
        return printLines(java.util.List.of("FlowGastronomie", "TEST / PROVE", "Ä Ö Ü ä ö ü ß €", "Shqip: ë ç Ë Ç"));
    }
}

/** Only a boundary: vendor SDK, service and drawer electrical details unconfirmed. */
final class GeonNb11Adapter implements PrinterAdapter, DrawerAdapter {
    public JSONObject capabilities() throws Exception {
        return new JSONObject().put("printerAvailable", false).put("paperWidth", JSONObject.NULL)
            .put("cutterAvailable", false).put("drawerAvailable", false)
            .put("vendor", "GEON").put("model", "NB11 (unverified)").put("bridgeVersion", "1.0.0");
    }
    public String printReceipt(JSONObject snapshot) { return "PRINTER_UNAVAILABLE"; }
    public String printTest() { return "PRINTER_UNAVAILABLE"; }
    public String openDrawer() { return "DRAWER_UNAVAILABLE"; }
}

/** Default shell has no physical adapter. A candidate is never treated as detected. */
final class UnavailableAdapter implements PrinterAdapter, DrawerAdapter {
    public JSONObject capabilities() throws Exception {
        return new JSONObject().put("printerAvailable", false).put("paperWidth", JSONObject.NULL)
            .put("cutterAvailable", false).put("drawerAvailable", false)
            .put("vendor", "UNCONFIGURED").put("model", "No verified SDK adapter").put("bridgeVersion", "1.0.0");
    }
    public String printReceipt(JSONObject snapshot) { return "PRINTER_UNAVAILABLE"; }
    public String printTest() { return "PRINTER_UNAVAILABLE"; }
    public String openDrawer() { return "DRAWER_UNAVAILABLE"; }
}
