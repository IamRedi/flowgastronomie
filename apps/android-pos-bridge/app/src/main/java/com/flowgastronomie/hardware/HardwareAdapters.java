package com.flowgastronomie.hardware;

import org.json.JSONObject;

interface PrinterAdapter {
    JSONObject capabilities() throws Exception;
    String printReceipt(JSONObject finalizedSnapshot) throws Exception;
    String printTest() throws Exception;
}
interface DrawerAdapter { String openDrawer() throws Exception; }

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
