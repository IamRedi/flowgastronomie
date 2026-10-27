package com.flowgastronomie.hardware;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.widget.TextView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.KeyPairGenerator;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Collections;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private final java.util.concurrent.ExecutorService serial = Executors.newSingleThreadExecutor();
    private final UnavailableAdapter adapter = new UnavailableAdapter();
    private PrivateKey privateKey;
    private PublicKey publicKey;
    private WebView web;
    private static final String ALIAS = "FlowHardwareDeviceV1";
    private static String b64(byte[] bytes) { return Base64.encodeToString(bytes, Base64.NO_WRAP); }
    private static byte[] unb64(String text) { return Base64.decode(text, Base64.DEFAULT); }
    private static String origin(String value) {
        Uri uri = Uri.parse(value); String scheme = uri.getScheme(); String host = uri.getHost();
        if (host == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) throw new IllegalArgumentException("Invalid configured origin");
        boolean localDebug = BuildConfig.DEBUG && "http".equals(scheme) && Set.of("localhost", "127.0.0.1", "10.0.2.2").contains(host);
        if (!"https".equals(scheme) && !localDebug) throw new IllegalArgumentException("HTTPS required");
        if (uri.getPath() != null && !uri.getPath().isEmpty() && !uri.getPath().equals("/")) throw new IllegalArgumentException("Configure an origin, not a URL path");
        int port = uri.getPort(); if (port == -1) port = "https".equals(scheme) ? 443 : 80;
        return scheme + "://" + host + ":" + port;
    }
    private void keys() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
            generator.initialize(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256)
                .setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1).build()); generator.generateKeyPair();
        }
        privateKey = (PrivateKey) store.getKey(ALIAS, null); publicKey = store.getCertificate(ALIAS).getPublicKey();
    }
    private String fingerprint() throws Exception { byte[] hash = MessageDigest.getInstance("SHA-256").digest(publicKey.getEncoded()); StringBuilder out = new StringBuilder(); for (byte v : hash) out.append(String.format(java.util.Locale.ROOT, "%02x", v & 255)); return out.toString(); }
    private JSONObject signed(JSONObject body) throws Exception { byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); Signature signature = Signature.getInstance("SHA256withRSA"); signature.initSign(privateKey); signature.update(bytes); return new JSONObject().put("version", 1).put("bodyBase64", b64(bytes)).put("signatureBase64", b64(signature.sign())); }
    private JSONObject proof() throws Exception { return signed(new JSONObject().put("version", 1).put("purpose", "PAIR").put("publicKeyBase64", b64(publicKey.getEncoded())).put("nonce", UUID.randomUUID().toString()).put("issuedAt", System.currentTimeMillis()).put("capabilities", adapter.capabilities())); }
    private PublicKey serverKey() throws Exception {
        // Fixed APK-configured TLS origin. Never fetch a browser-supplied URL.
        URL url = new URL(origin(BuildConfig.API_BASE_URL) + "/v1/staff/hardware/key");
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(5000); connection.setReadTimeout(5000);
        String cookie = CookieManager.getInstance().getCookie(origin(BuildConfig.API_BASE_URL));
        if (cookie != null) connection.setRequestProperty("Cookie", cookie);
        try { if (connection.getResponseCode() != 200) throw new SecurityException("Signing key unavailable"); byte[] bytes = connection.getInputStream().readNBytes(8193); if (bytes.length > 8192) throw new SecurityException("Key response too large"); JSONObject json = new JSONObject(new String(bytes, StandardCharsets.UTF_8)); return KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(unb64(json.getString("publicKeyBase64")))); } finally { connection.disconnect(); }
    }
    private static void exact(JSONObject object, String... names) {
        java.util.HashSet<String> expected = new java.util.HashSet<>(java.util.Arrays.asList(names));
        java.util.HashSet<String> actual = new java.util.HashSet<>(); object.keys().forEachRemaining(actual::add);
        if (!actual.equals(expected)) throw new SecurityException("Invalid command fields");
    }
    private JSONObject result(JSONObject command, String code) throws Exception { return new JSONObject().put("version", 1).put("commandId", command.getString("commandId")).put("deviceId", command.getString("deviceId")).put("success", code.equals("OK")).put("errorCode", code).put("retryable", code.equals("PAPER_OUT") || code.equals("BRIDGE_UNAVAILABLE")).put("capabilities", adapter.capabilities()); }
    private JSONObject execute(String method, JSONObject envelope) throws Exception {
        exact(envelope, "version", "bodyBase64", "signatureBase64"); if (envelope.getInt("version") != 1) throw new SecurityException("Unsupported version");
        byte[] bytes = unb64(envelope.getString("bodyBase64")); if (bytes.length > 750000) throw new SecurityException("Payload too large");
        Signature verify = Signature.getInstance("SHA256withRSA"); verify.initVerify(serverKey()); verify.update(bytes);
        if (!verify.verify(unb64(envelope.getString("signatureBase64")))) throw new SecurityException("Invalid server signature");
        JSONObject command = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        java.util.ArrayList<String> fields = new java.util.ArrayList<>(java.util.List.of("version", "commandId", "deviceId", "deviceFingerprint", "tenantId", "venueId", "expiresAt", "command"));
        if (method.equals("printReceipt")) fields.add("receipt"); else if (method.equals("openDrawer")) { fields.add("receiptId"); fields.add("reason"); }
        exact(command, fields.toArray(new String[0]));
        if (command.getInt("version") != 1 || !method.equals(command.getString("command")) || !fingerprint().equals(command.getString("deviceFingerprint"))) throw new SecurityException("Wrong command or device");
        UUID.fromString(command.getString("commandId"));
        String commandId = command.getString("commandId"); String hash = b64(MessageDigest.getInstance("SHA-256").digest(bytes));
        android.content.SharedPreferences ledger = getSharedPreferences("commandLedgerV1", MODE_PRIVATE);
        String oldHash = ledger.getString(commandId + ":hash", null); String previous = ledger.getString(commandId, null);
        if (oldHash != null && !hash.equals(oldHash)) throw new SecurityException("Idempotency conflict");
        if (previous != null) return signed(new JSONObject(previous));
        if (oldHash != null) return signed(result(command, "UNKNOWN_RESULT"));
        if (command.getLong("expiresAt") < System.currentTimeMillis()) throw new SecurityException("Expired command");
        if (method.equals("printReceipt")) { JSONObject receipt = command.getJSONObject("receipt"); if (!receipt.getString("status").equals("FINALIZED")) throw new SecurityException("Not finalized"); }
        // Persist before any physical operation. A crash reports UNKNOWN_RESULT,
        // never blindly repeats a drawer pulse or partially printed receipt.
        if (!ledger.edit().putString(commandId + ":hash", hash).commit()) throw new SecurityException("Journal unavailable");
        String code = method.equals("printReceipt") ? adapter.printReceipt(command.getJSONObject("receipt")) : method.equals("printTest") ? adapter.printTest() : adapter.openDrawer();
        JSONObject result = result(command, code); if (!ledger.edit().putString(commandId, result.toString()).commit()) return signed(result(command, "UNKNOWN_RESULT")); return signed(result);
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        try {
            final String allowed = origin(BuildConfig.POS_BASE_URL); origin(BuildConfig.API_BASE_URL); keys();
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) throw new SecurityException("Required secure WebView messaging unavailable");
            web = new WebView(this); setContentView(web); web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(true);
            web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(false); web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
            web.setWebViewClient(new WebViewClient() { @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { try { Uri url = request.getUrl(); String candidate = url.getScheme() + "://" + url.getHost() + ":" + (url.getPort() == -1 ? "https".equals(url.getScheme()) ? 443 : 80 : url.getPort()); return !allowed.equals(candidate); } catch (Exception ignored) { return true; } } });
            WebViewCompat.addWebMessageListener(web, "FlowHardware", Collections.singleton(allowed), (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (!isMainFrame || !allowed.equals(sourceOrigin.toString().replaceAll("/$", "")) && !allowed.equals(sourceOrigin.getScheme() + "://" + sourceOrigin.getHost() + ":" + (sourceOrigin.getPort() == -1 ? "https".equals(sourceOrigin.getScheme()) ? 443 : 80 : sourceOrigin.getPort()))) return;
                String raw = message.getData(); if (raw == null || raw.length() > 1000000) return;
                serial.execute(() -> { JSONObject response = new JSONObject(); try { JSONObject request = new JSONObject(raw); String requestId = request.getString("requestId"); UUID.fromString(requestId); response.put("requestId", requestId); String method = request.getString("method"); if (!Set.of("health", "capabilities", "printReceipt", "printTest", "openDrawer").contains(method)) throw new SecurityException("Invalid method"); exact(request, method.equals("health") || method.equals("capabilities") ? new String[]{"method", "requestId"} : new String[]{"method", "requestId", "envelope"}); JSONObject payload = method.equals("health") || method.equals("capabilities") ? new JSONObject().put("capabilities", adapter.capabilities()).put("fingerprint", fingerprint()).put("proof", proof()) : execute(method, request.getJSONObject("envelope")); response.put("payload", payload); } catch (Exception ignored) { try { response.put("error", "INVALID_COMMAND"); } catch (Exception ignoredAgain) {} } runOnUiThread(() -> reply.postMessage(response.toString())); });
            });
            web.loadUrl(allowed + "/en/staff/pos");
        } catch (Exception ignored) { TextView failure = new TextView(this); failure.setText("Hardware bridge unavailable. Verify HTTPS origins and WebView version."); setContentView(failure); }
    }
    @Override protected void onDestroy() { serial.shutdown(); if (web != null) web.destroy(); super.onDestroy(); }
}
