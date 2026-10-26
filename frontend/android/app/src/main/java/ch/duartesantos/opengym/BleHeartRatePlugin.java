package ch.duartesantos.opengym;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * A band's live heart rate during a workout, over Bluetooth LE: the standard Heart Rate Service
 * (0x180D) a Mi Band exposes once "activity heart rate sharing" (and "discoverable") is on in
 * its app and a workout mode runs on the band, which any chest strap or watch with the service
 * speaks too. Find the band, connect, subscribe to the measurement characteristic (0x2A37), and
 * hand every reading to the page as an event. Plain android.bluetooth, no library.
 *
 * Finding the band: a Mi Band does not put the Heart Rate Service in its advertisement (some
 * firmware barely advertises at all while its app holds the link), so a scan filtered on 0x180D
 * finds nothing. `scan` therefore lists first the devices the phone already holds a GATT link to
 * (the band Zepp is connected to — a second app may open its own client on that link) and the
 * bonded ones, then scans unfiltered and ranks: advertises 0x180D, then a band-like name, then
 * other named devices. Whether the service is really there is settled on connect.
 *
 * Nothing here is remembered across runs: the page keeps the chosen device's address in its
 * own file (lib/live-hr.js) and asks to connect again at the next workout.
 *
 * Usage from JS (lib/live-hr.js):
 *   const BLE = registerPlugin('BleHeartRate');
 *   await BLE.status();                        // { supported, enabled, granted }
 *   await BLE.requestPermissions();            // { granted }
 *   const { devices } = await BLE.scan({ ms }); // [{ address, name, connected, bonded, hrs, band }], best first
 *   await BLE.connect({ address });            // resolves once notifications are on
 *   BLE.addListener('hr', ({ bpm, at }) => …);
 *   BLE.addListener('state', ({ connected }) => …);
 *   await BLE.disconnect();
 */
@CapacitorPlugin(
    name = "BleHeartRate",
    permissions = {
        @Permission(alias = "ble", strings = { Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class BleHeartRatePlugin extends Plugin {

    private static final String TAG = "openGym/BleHeartRate";
    private static final UUID HRS = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb");
    private static final UUID HRM = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private static final int SCAN_MAX_MS = 15000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private BluetoothGatt gatt;
    private String connectedAddress;
    private PluginCall pendingConnect;
    private ScanCallback scanCallback;
    private boolean retried;

    private static boolean modern() { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S; }
    private String alias() { return modern() ? "ble" : "location"; }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }
    private boolean granted() { return getPermissionState(alias()) == PermissionState.GRANTED; }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        BluetoothAdapter a = adapter();
        boolean supported = a != null && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE);
        r.put("supported", supported);
        r.put("enabled", supported && a.isEnabled());
        r.put("granted", granted());
        r.put("connected", gatt != null && connectedAddress != null);
        r.put("address", connectedAddress);
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (granted()) { JSObject r = new JSObject(); r.put("granted", true); call.resolve(r); return; }
        requestPermissionForAlias(alias(), call, "permissionsResult");
    }

    @PermissionCallback
    private void permissionsResult(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", granted());
        call.resolve(r);
    }

    private static final String[] BAND_NAMES = { "mi band", "mi smart band", "xiaomi", "amazfit", "zepp", "smart band", "huami", "redmi" };
    private static boolean bandName(String name) {
        if (name == null) return false;
        String n = name.toLowerCase();
        for (String b : BAND_NAMES) if (n.contains(b)) return true;
        return false;
    }

    /** One row per device: address, name, and how it was found. */
    private static final class Found {
        String address, name = "";
        boolean connected, bonded, hrs, band;
        int rank() {
            if (connected) return 0;
            if (hrs) return 1;
            if (band) return 2;
            if (bonded) return 3;
            return name.isEmpty() ? 5 : 4;
        }
        JSObject json() {
            JSObject o = new JSObject();
            o.put("address", address); o.put("name", name);
            o.put("connected", connected); o.put("bonded", bonded); o.put("hrs", hrs); o.put("band", band);
            return o;
        }
    }

    private static String nameOf(BluetoothDevice d) {
        try { String n = d.getName(); return n == null ? "" : n; } catch (SecurityException e) { return ""; }
    }

    /** The devices the phone already holds — a GATT link (the band its app is connected to) or a bond. */
    private void known(Map<String, Found> found) {
        try {
            BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            if (m != null) for (BluetoothDevice d : m.getConnectedDevices(BluetoothProfile.GATT)) {
                Found f = new Found(); f.address = d.getAddress(); f.name = nameOf(d); f.connected = true; f.band = bandName(f.name);
                found.put(f.address, f);
            }
            BluetoothAdapter a = adapter();
            if (a != null) for (BluetoothDevice d : a.getBondedDevices()) {
                if (d.getType() == BluetoothDevice.DEVICE_TYPE_CLASSIC) continue;   // headphones, cars
                Found f = found.get(d.getAddress());
                if (f == null) { f = new Found(); f.address = d.getAddress(); f.name = nameOf(d); found.put(f.address, f); }
                f.bonded = true; f.band = f.band || bandName(f.name);
            }
        } catch (SecurityException e) { /* no connect permission: nothing known */ }
    }

    /** The heart-rate devices around, after `ms` of scanning: known links and bonds first, then the air. */
    @PluginMethod
    public void scan(PluginCall call) {
        BluetoothAdapter a = adapter();
        if (a == null || !a.isEnabled()) { call.reject("Bluetooth is off", "off"); return; }
        if (!granted()) { call.reject("Bluetooth permission not granted", "permission"); return; }
        BluetoothLeScanner scanner = a.getBluetoothLeScanner();
        if (scanner == null) { call.reject("no scanner", "off"); return; }
        final int ms = Math.max(2000, Math.min(SCAN_MAX_MS, call.getInt("ms", 8000)));
        final Map<String, Found> found = Collections.synchronizedMap(new LinkedHashMap<>());
        known(found);
        stopScan(a);
        scanCallback = new ScanCallback() {
            @Override public void onScanResult(int type, ScanResult result) { seen(result); }
            @Override public void onBatchScanResults(List<ScanResult> results) { for (ScanResult r : results) seen(r); }
            private void seen(ScanResult result) {
                try {
                    BluetoothDevice d = result.getDevice();
                    String name = result.getScanRecord() != null && result.getScanRecord().getDeviceName() != null ? result.getScanRecord().getDeviceName() : nameOf(d);
                    boolean hrs = false;
                    if (result.getScanRecord() != null && result.getScanRecord().getServiceUuids() != null)
                        for (ParcelUuid u : result.getScanRecord().getServiceUuids()) if (HRS.equals(u.getUuid())) hrs = true;
                    synchronized (found) {
                        Found f = found.get(d.getAddress());
                        if (f == null) { f = new Found(); f.address = d.getAddress(); found.put(f.address, f); }
                        if (f.name.isEmpty() && name != null) f.name = name;
                        f.hrs = f.hrs || hrs; f.band = f.band || bandName(f.name);
                    }
                } catch (SecurityException e) { /* no connect permission for the name */ }
            }
            @Override public void onScanFailed(int code) { Log.d(TAG, "scan failed " + code); }
        };
        // No service filter: a Mi Band does not advertise 0x180D, it only answers for it once connected.
        ScanSettings settings = new ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build();
        try {
            scanner.startScan(new ArrayList<>(), settings, scanCallback);
        } catch (SecurityException e) { call.reject("Bluetooth permission not granted", "permission"); return; }
        main.postDelayed(() -> {
            stopScan(a);
            List<Found> rows;
            synchronized (found) { rows = new ArrayList<>(found.values()); }
            Collections.sort(rows, (x, y) -> x.rank() - y.rank());
            JSArray devices = new JSArray();
            int n = 0;
            for (Found f : rows) {
                if (f.rank() == 5 && n >= 8) continue;      // the air is full of nameless beacons
                if (n++ >= 30) break;
                devices.put(f.json());
            }
            Log.d(TAG, "scan: " + devices.length() + " devices (" + rows.size() + " seen)");
            JSObject r = new JSObject(); r.put("devices", devices); call.resolve(r);
        }, ms);
    }

    private void stopScan(BluetoothAdapter a) {
        if (scanCallback == null) return;
        try { BluetoothLeScanner s = a.getBluetoothLeScanner(); if (s != null) s.stopScan(scanCallback); } catch (Exception e) { /* already stopped */ }
        scanCallback = null;
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        BluetoothAdapter a = adapter();
        if (address == null) { call.reject("address is required", "args"); return; }
        if (a == null || !a.isEnabled()) { call.reject("Bluetooth is off", "off"); return; }
        if (!granted()) { call.reject("Bluetooth permission not granted", "permission"); return; }
        closeGatt();
        BluetoothDevice device;
        try { device = a.getRemoteDevice(address); } catch (IllegalArgumentException e) { call.reject("bad address", "args"); return; }
        call.setKeepAlive(true);
        pendingConnect = call;
        retried = false;
        try {
            gatt = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? device.connectGatt(getContext(), false, callback, BluetoothDevice.TRANSPORT_LE)
                : device.connectGatt(getContext(), false, callback);
        } catch (SecurityException e) { pendingConnect = null; call.reject("Bluetooth permission not granted", "permission"); }
        // A band that never answers must not leave the page waiting for ever.
        main.postDelayed(() -> { if (pendingConnect == call) { pendingConnect = null; closeGatt(); call.reject("the band did not answer", "timeout"); } }, 30000);
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        closeGatt();
        emitState(false);
        call.resolve();
    }

    private void closeGatt() {
        if (gatt != null) {
            try { gatt.disconnect(); gatt.close(); } catch (Exception e) { /* gone */ }
        }
        gatt = null;
        connectedAddress = null;
    }

    private void emitState(boolean connected) {
        JSObject s = new JSObject();
        s.put("connected", connected);
        s.put("address", connectedAddress);
        notifyListeners("state", s);
    }

    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override public void onConnectionStateChange(BluetoothGatt g, int status, int newState) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                try { g.discoverServices(); } catch (SecurityException e) { fail("permission"); }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                Log.d(TAG, "disconnected, status " + status);
                connectedAddress = null;
                if (pendingConnect != null && status != BluetoothGatt.GATT_SUCCESS && !retried) {
                    // 133 and friends: the stack's first try at a device another app holds often fails; once more, queued.
                    retried = true;
                    try { g.close(); } catch (Exception e) { /* gone */ }
                    BluetoothDevice dev = g.getDevice();
                    main.postDelayed(() -> {
                        if (pendingConnect == null) return;
                        try { gatt = dev.connectGatt(getContext(), true, callback, BluetoothDevice.TRANSPORT_LE); }
                        catch (SecurityException e) { fail("permission"); }
                    }, 600);
                    return;
                }
                if (pendingConnect != null) fail("the band disconnected");
                emitState(false);
            }
        }
        @Override public void onServicesDiscovered(BluetoothGatt g, int status) {
            try {
                BluetoothGattCharacteristic c = g.getService(HRS) == null ? null : g.getService(HRS).getCharacteristic(HRM);
                if (c == null) { fail("no heart rate service: on a Mi Band, turn on activity heart rate sharing and discoverable in its app, then start a workout mode on the band"); return; }
                g.setCharacteristicNotification(c, true);
                BluetoothGattDescriptor d = c.getDescriptor(CCCD);
                if (d == null) { fail("no notification descriptor"); return; }
                if (Build.VERSION.SDK_INT >= 33) g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                else { d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE); g.writeDescriptor(d); }
            } catch (SecurityException e) { fail("permission"); }
        }
        @Override public void onDescriptorWrite(BluetoothGatt g, BluetoothGattDescriptor d, int status) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "descriptor write status " + status);
                fail(status == 5 || status == 8 || status == 15 ? "the band wants to be paired with this phone first (Bluetooth settings)" : "the band refused the subscription (" + status + ")");
                return;
            }
            connectedAddress = g.getDevice().getAddress();
            Log.d(TAG, "subscribed to heart rate on " + connectedAddress);
            PluginCall c = pendingConnect;
            pendingConnect = null;
            if (c != null) { JSObject r = new JSObject(); r.put("connected", true); r.put("address", connectedAddress); c.resolve(r); }
            emitState(true);
        }
        @Override public void onCharacteristicChanged(BluetoothGatt g, BluetoothGattCharacteristic c) {
            byte[] v = c.getValue();
            if (v == null || v.length < 2) return;
            // Heart Rate Measurement: flags byte, then the rate as uint8 or (flag bit 0) uint16 LE.
            int bpm = (v[0] & 0x01) != 0 ? ((v[1] & 0xff) | ((v[2] & 0xff) << 8)) : (v[1] & 0xff);
            if (bpm <= 0 || bpm > 250) return;
            JSObject o = new JSObject();
            o.put("bpm", bpm);
            o.put("at", System.currentTimeMillis());
            notifyListeners("hr", o);
        }
        private void fail(String why) {
            PluginCall c = pendingConnect;
            pendingConnect = null;
            closeGatt();
            if (c != null) c.reject(why, "failed");
        }
    };

    @Override
    protected void handleOnDestroy() {
        closeGatt();
    }
}
