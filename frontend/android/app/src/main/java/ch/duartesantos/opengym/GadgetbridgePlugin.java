package ch.duartesantos.opengym;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * A Mi Band (or any band Gadgetbridge speaks to) as a recovery signal: sleep, resting heart rate
 * and steps, read from Gadgetbridge's own database export. Two halves, both deliberately dumb:
 *
 *   sync()          asks Gadgetbridge to fetch the band's new data now, by broadcast. Gadgetbridge
 *                   may or may not be installed, may or may not be listening; the answer says
 *                   whether it was there and whether the broadcast went, and nothing crashes.
 *   pickDatabase()  the Storage Access Framework picker for the file Gadgetbridge exports
 *                   (Settings → Data management → Export, or its periodic auto-export). The read
 *                   right is kept for later reads; the address is a fact of this phone, kept in
 *                   SharedPreferences and never in the synced state.
 *   read({ days })  copies the export to the cache (SQLite needs a file, a content:// URI is not
 *                   one), opens it read-only and returns the raw minute samples of the last
 *                   `days` days — timestamp, steps, heart rate, raw kind — as rows. Everything
 *                   that turns rows into sleep, a resting heart rate and a score is JavaScript
 *                   (lib/biometrics.js), pure and unit-tested; nothing is computed here.
 *
 * Usage from JS (lib/gadgetbridge.js):
 *   const GB = registerPlugin('Gadgetbridge');
 *   await GB.status();                 // { installed, hasDatabase, uri?, name? }
 *   await GB.sync();                   // { installed, sent }
 *   await GB.pickDatabase();           // { uri, name } or {} when cancelled
 *   await GB.read({ days: 3 });        // { table, rows: [[t, steps, hr, kind], …], count }
 *   await GB.forget();
 */
@CapacitorPlugin(name = "Gadgetbridge")
public class GadgetbridgePlugin extends Plugin {

    private static final String TAG = "openGym/Gadgetbridge";
    static final String GB_PACKAGE = "nodomain.freeyourgadget.gadgetbridge";
    static final String GB_SYNC_ACTION = "nodomain.freeyourgadget.gadgetbridge.command.ACTIVITY_SYNC";
    private static final String PREFS = "gadgetbridge";
    private static final String KEY_URI = "db";
    private static final String KEY_NAME = "name";
    // The minute-sample table differs by band family; the first that exists is read.
    private static final String[] SAMPLE_TABLES = {
        "MI_BAND_ACTIVITY_SAMPLE", "HUAMI_EXTENDED_ACTIVITY_SAMPLE", "XIAOMI_ACTIVITY_SAMPLE",
        "ZEPP_OS_ACTIVITY_SAMPLE", "FITPRO_ACTIVITY_SAMPLE", "COLMI_ACTIVITY_SAMPLE"
    };
    private static final int MAX_DAYS = 14;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean installed(Context ctx) {
        try {
            ctx.getPackageManager().getPackageInfo(GB_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("installed", installed(getContext()));
        String uri = prefs().getString(KEY_URI, null);
        ret.put("hasDatabase", uri != null && readable(uri));
        if (uri != null) {
            ret.put("uri", uri);
            ret.put("name", prefs().getString(KEY_NAME, ""));
        }
        call.resolve(ret);
    }

    /** Asks Gadgetbridge to pull the band's data now. A missing Gadgetbridge is an answer, not a crash. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSObject ret = new JSObject();
        boolean there = installed(getContext());
        ret.put("installed", there);
        boolean sent = false;
        if (there) {
            try {
                Intent intent = new Intent(GB_SYNC_ACTION);
                intent.setPackage(GB_PACKAGE);
                getContext().sendBroadcast(intent);
                sent = true;
                Log.d(TAG, "sync broadcast sent to " + GB_PACKAGE);
            } catch (Exception e) {
                Log.d(TAG, "sync broadcast failed: " + e.getMessage());
            }
        } else {
            Log.d(TAG, "Gadgetbridge is not installed; no sync broadcast");
        }
        ret.put("sent", sent);
        call.resolve(ret);
    }

    @PluginMethod
    public void pickDatabase(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        Uri uri = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            Log.d(TAG, "no persistable read permission for " + uri + ": " + e.getMessage());
        }
        String name = nameOf(uri);
        prefs().edit().putString(KEY_URI, uri.toString()).putString(KEY_NAME, name).apply();
        JSObject ret = new JSObject();
        ret.put("uri", uri.toString());
        ret.put("name", name);
        call.resolve(ret);
    }

    @PluginMethod
    public void forget(PluginCall call) {
        String uri = prefs().getString(KEY_URI, null);
        if (uri != null) {
            try { getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION); }
            catch (Exception e) { /* not held any more */ }
        }
        prefs().edit().clear().apply();
        new File(getContext().getCacheDir(), "gadgetbridge.db").delete();
        call.resolve(new JSObject());
    }

    /** The raw minute samples of the last `days` days, newest last. */
    @PluginMethod
    public void read(PluginCall call) {
        final int days = Math.max(1, Math.min(MAX_DAYS, call.getInt("days", 3)));
        final String uri = prefs().getString(KEY_URI, null);
        if (uri == null) {
            call.reject("no Gadgetbridge database chosen", "nodb");
            return;
        }
        io.execute(() -> {
            SQLiteDatabase db = null;
            try {
                File copy = copyToCache(Uri.parse(uri));
                db = SQLiteDatabase.openDatabase(copy.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
                String table = firstTable(db);
                if (table == null) {
                    call.reject("no activity-sample table in this database (is it a Gadgetbridge export?)", "notable");
                    return;
                }
                long since = System.currentTimeMillis() / 1000L - (long) days * 86400L;
                JSArray rows = new JSArray();
                int n = 0;
                int bad = 0;
                try (Cursor c = db.rawQuery(
                        "SELECT TIMESTAMP, STEPS, HEART_RATE, RAW_KIND FROM " + table + " WHERE TIMESTAMP >= ? ORDER BY TIMESTAMP ASC",
                        new String[]{ String.valueOf(since) })) {
                    while (c.moveToNext()) {
                        JSArray row = new JSArray();
                        row.put(c.getLong(0));
                        row.put(c.isNull(1) ? 0 : c.getInt(1));
                        int hr = c.isNull(2) ? 0 : c.getInt(2);
                        if (hr == 255 || hr <= 0) bad++;
                        row.put(hr);
                        row.put(c.isNull(3) ? -1 : c.getInt(3));
                        rows.put(row);
                        n++;
                    }
                }
                Log.d(TAG, "read " + n + " samples from " + table + " (last " + days + " days, " + bad + " without a valid heart rate)");
                JSObject ret = new JSObject();
                ret.put("table", table);
                ret.put("rows", rows);
                ret.put("count", n);
                ret.put("since", since);
                call.resolve(ret);
            } catch (Exception e) {
                Log.d(TAG, "read failed: " + e.getMessage());
                call.reject("could not read the Gadgetbridge database: " + e.getMessage(), "read", e);
            } finally {
                if (db != null) db.close();
            }
        });
    }

    private File copyToCache(Uri uri) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        File copy = new File(getContext().getCacheDir(), "gadgetbridge.db");
        try (InputStream in = cr.openInputStream(uri); OutputStream out = new FileOutputStream(copy, false)) {
            if (in == null) throw new IllegalStateException("the file cannot be opened");
            byte[] buf = new byte[1 << 16];
            int r;
            while ((r = in.read(buf)) > 0) out.write(buf, 0, r);
        }
        // An export written while the WAL was open leaves -wal/-shm siblings behind; a copy has none.
        new File(copy.getAbsolutePath() + "-wal").delete();
        new File(copy.getAbsolutePath() + "-shm").delete();
        return copy;
    }

    private static String firstTable(SQLiteDatabase db) {
        for (String t : SAMPLE_TABLES) {
            try (Cursor c = db.rawQuery("SELECT name FROM sqlite_master WHERE type='table' AND name=?", new String[]{ t })) {
                if (c.moveToFirst()) return t;
            }
        }
        return null;
    }

    private boolean readable(String uri) {
        try (InputStream in = getContext().getContentResolver().openInputStream(Uri.parse(uri))) {
            return in != null;
        } catch (Exception e) {
            return false;
        }
    }

    private String nameOf(Uri uri) {
        try (Cursor c = getContext().getContentResolver().query(uri, new String[]{ "_display_name" }, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception e) { /* fall through */ }
        String s = uri.getLastPathSegment();
        return s == null ? "" : s;
    }
}
