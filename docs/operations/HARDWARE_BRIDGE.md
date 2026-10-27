# P3 hardware bridge

## Architecture and current support

```text
POS payment commits -> P2 finalized receipt (unchanged)
    -> scoped PrintJob -> version-1 structural command
    -> development simulator OR Android WebView bridge
    -> PrinterAdapter / DrawerAdapter
    -> normalized result -> durable job/audit ledger
```

`packages/domain/src/hardware.ts` owns the versioned contract, immutable receipt
mapping, drawer policy and retry invariants. `hardware-repository.ts` owns device
pairing, scoped job tracking and audits. API orchestration and the simulator are
separate from payment/tax code. A failed print never rolls back payment.

The simulator is functional today. The Android shell builds a debug APK and has
secure messaging, signing, pairing and a persistent execution journal. Its default
adapter advertises **no physical capabilities**. `GeonNb11Adapter` is a skeleton,
not detected hardware or a supported printer. No real device was accepted in P3.

One most-recently paired device is selected by the pilot UI. The schema supports
multiple devices per venue; future register selection can use their existing IDs.
P2's one cash session per venue remains unchanged. Device IDs, display names,
pairing time, active status, lastSeen, capabilities and auto settings are stored.
lastSeen means a confirmed pairing/result, not proof of current connectivity.

## Security

The Android shell uses AndroidX `WebViewCompat.addWebMessageListener` with one
exact configured POS origin and main-frame checks. Navigation cannot leave that
origin; file/content access and mixed content are disabled. Release requires
HTTPS for both APK-configured origins. Debug allows HTTP only for loopback or
the Android emulator host `10.0.2.2`. There is no localhost listener, generic
eval, shell, file API, raw printer command, or browser-supplied destination URL.

Commands are created from scoped, finalized server receipts and signed using
RSA/SHA-256. Native code retrieves the public verifier directly from its fixed
TLS API origin using the existing staff cookie, without redirects. The browser
cannot substitute a signing key or mutate a receipt payload. Commands include
version, unique ID, tenant/venue/device, device public-key fingerprint and expiry.
The private server key never enters frontend code.

Android device private keys live in AndroidKeyStore. Owner/Manager pairing uses
a fresh signed native proof (60-second clock window), verified before enrollment.
Only that paired key can sign accepted native results. Device keys are enrollment
identities, not vendor attestation. Pair only a physically controlled terminal.
Keep device/server clocks synchronized. Production native pairing requires a
persistent server signing key; it fails closed without one. Development uses an
ephemeral key and never represents a production trust setup.

All API bodies use strict schemas; clients cannot supply tenant/venue scope,
receipt money, HTML, arbitrary URLs, SDK bytes, pins, or voltages. `RECEIPT_PRINT`
is available to payment-capable service roles. `HARDWARE_MANAGE` and
`DRAWER_MANUAL` are leadership permissions. Manual opening also needs an active
shift, a reason and an audit event.

An automatic drawer request references a finalized CASH receipt no older than
five minutes. Its idempotency key is server-derived from device and receipt;
changing a client key cannot pulse it twice. CARD never triggers automatic
drawer opening. Older receipts require the explicit audited manual operation.

## Print jobs, failure and recovery

Jobs retain tenant, venue, receipt, device, request key, status, attempts, last
error, timestamps and current command. Normal lifecycle is
`QUEUED -> PRINTING -> PRINTED/FAILED`. Same-key queueing returns the existing
job. Concurrent execution shares one attempt/command. Reprint creates another
job for **the same finalized receipt**, not another receipt or payment.

Paper failure produces `FAILED/PAPER_OUT`; operator Retry increments attempts
on the same job. Physical output cannot be made exactly-once over a printer
connection. The Android journal persists command identity before calling an
adapter and returns a saved result on replay. A process crash after dispatch,
missing acknowledgement, or expired in-flight command means `UNKNOWN_RESULT`.
Check physical output before confirming a new attempt; another copy may print.
Do not blindly retry drawer pulses. Unknown results never claim PRINTED.

Native callbacks are signed. A browser transport failure can mark an attempt
uncertain, but cannot mark it printed. Late valid results reconcile only the
matching current attempt; they cannot overwrite a newer attempt. The fiscal/
business receipt stays finalized throughout. The POS keeps New order available
and shows “Payment recorded. Receipt not printed.” for printing failure.

## Simulator on Windows/Linux

Migrate/generate with the established Prisma scripts. The Playwright API fixture
sets `HARDWARE_SIMULATOR_ENABLED=true`; no production or public frontend flag
enables it. For manual local development set this **server-only** variable in
the ignored local `.env`. It is always rejected with `NODE_ENV=production`.

In Staff POS, open Hardware settings and Pair simulator. Enable auto-print and
auto-drawer, start a shift/open cash session, and confirm CASH. The journal shows
drawer, print, feed and cut. Test printer produces a separate diagnostic command.
Simulate paper out fails the next receipt print once; Retry then succeeds.
Diagnostics are leadership-only and scoped to that simulator. No paper or drawer
is physically actuated, even if a simulated job says PRINTED.

Simulator commands/results are stored in PostgreSQL. The development adapter's
operation preview and next-failure switch are in memory; restarting clears those
diagnostic controls, not print jobs, receipts or recorded outcomes. Re-seeding
replaces only the existing demo fixture, including its hardware records.

## Reproducible Android build

Pinned toolchain: AGP 8.7.3, Gradle wrapper 8.10.2 with distribution SHA-256,
AndroidX WebKit 1.12.1, Java 17+, Android SDK platform 35. Minimum Android is 13
(API 33). Existing Android Studio JBR can be used without upgrading system Java.
`JAVA_HOME` and `ANDROID_HOME` are process/local machine configuration; do not
commit `local.properties`, signing stores or build outputs.

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
.\apps\android-pos-bridge\gradlew.bat -p apps/android-pos-bridge --no-daemon assembleDebug `
  -PposBaseUrl=http://10.0.2.2:3300 -PapiBaseUrl=http://10.0.2.2:4100
```

```sh
bash apps/android-pos-bridge/gradlew -p apps/android-pos-bridge --no-daemon assembleDebug \
  -PposBaseUrl=https://your-pos-host -PapiBaseUrl=https://your-api-host
```

APK: `apps/android-pos-bridge/app/build/outputs/apk/debug/app-debug.apk`.
Configure the API's allowed web origin to match the POS origin. Use the app's
normal staff login, then Pair Android bridge as Owner/Manager. Third-party
cookies are enabled for the configured web/API deployment; test staff login
and cookie handling on the actual WebView/Android version during acceptance.
Default `.invalid` build URLs intentionally provide no live destination.

Production commands require `HARDWARE_COMMAND_PRIVATE_KEY_BASE64`: base64 DER
PKCS8 RSA private key, at least 2048 bits, stored only in the server secret
environment. Provision it through your deployment's secret workflow. Never use
a committed fixture key. `assembleRelease` produces an unsigned release for the
later controlled signing process; release rejects non-HTTPS origins at runtime.
CI builds the debug shell separately and runs the existing nine release gates.

## Add a vendor adapter

Implement the native PrinterAdapter and DrawerAdapter behind capability detection
using confirmed SDK/service metadata. Keep hardware selection in the adapter
boundary, not the POS, domain or payment repository. Do not recalculate money/tax.
Render structural finalized snapshots as text, with tested Unicode/charset
handling. No image receipt is selected by default.

Generic ESC/POS is deliberately not encoded yet: there is no confirmed printer
dialect, code page, transport, cutter or drawer electrical specification. Once
confirmed, keep EscPosEncoder separate from USB/TCP/vendor transports. Restrict
transport destinations to trusted device configuration, never command input.
Validate the encoder against official protocol documentation and the actual
device, including German umlauts, euro, Albanian ë/ç and Italian text.

## GEON NB11 information still required

- Freedom to install/update our signed APK and run it in the foreground/kiosk.
- Official printer SDK/API: ESC/POS support, AIDL/service interface, or equivalent.
- SDK artifact coordinates or vendor-provided Maven/AAR/JAR plus licensing.
- Official sample code and supported firmware/API versions.
- Print completion/error/paper-out semantics, 80mm width, charset and cutter.
- Drawer API and documented connector, voltage, pin and timing specification.
- Device access/permissions, Android WebView support and update policy.

GEON is **not supported** until documentation and physical acceptance confirm it.

## Real-device acceptance checklist

- Verify APK installation, origin lock, blocked external navigation/iframes and
  no generic JS interface. Reject tampered/expired commands and wrong keys/devices.
- Pair the correct tenant/venue; reject cross-venue enrollment and command access.
- Print test and actual P2 receipts; compare number, legal snapshot, lines,
  gross/net/tax, currency, cash received/change and Unicode with the web receipt.
- Confirm 80mm layout, bold/alignment/separators, feed and cutter capabilities.
- Confirm CASH drawer timing/electrical specification and no automatic CARD pulse.
- Test paper-out, offline printer, unplug/reconnect, restart during print,
  duplicate delivery, unknown-result acknowledgement and audited manual opening.
- Confirm reprint keeps the same receipt, pending jobs recover, payments remain
  successful and staff retain usable 44px+ targets on the real touch display.
- Verify persistent keys, signing/release origins, clock sync, cookie login and
  foreground/lifecycle behavior. Record actual device, firmware and adapter version.

Hardware acceptance must precede P4. No TSE, DSFinV-K, terminal integration,
Stripe or production deployment is included here.

References: [Android secure web messaging](https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge),
[AndroidKeyStore](https://developer.android.com/privacy-and-security/keystore),
[AndroidX WebKit releases](https://developer.android.com/jetpack/androidx/releases/webkit),
[Gradle 8.10.2](https://docs.gradle.org/8.10.2/release-notes.html).
