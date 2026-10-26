package ch.duartesantos.opengym;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.contract.ActivityResultContract;
import androidx.health.connect.client.HealthConnectClient;
import androidx.health.connect.client.PermissionController;
import androidx.health.connect.client.records.ExerciseSessionRecord;
import androidx.health.connect.client.records.HeartRateRecord;
import androidx.health.connect.client.records.HeartRateVariabilityRmssdRecord;
import androidx.health.connect.client.records.Record;
import androidx.health.connect.client.records.RestingHeartRateRecord;
import androidx.health.connect.client.records.SleepSessionRecord;
import androidx.health.connect.client.records.StepsRecord;
import androidx.health.connect.client.records.WeightRecord;
import androidx.health.connect.client.records.metadata.Metadata;
import androidx.health.connect.client.request.ReadRecordsRequest;
import androidx.health.connect.client.response.ReadRecordsResponse;
import androidx.health.connect.client.time.TimeRangeFilter;
import androidx.health.connect.client.units.Mass;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import kotlin.coroutines.EmptyCoroutineContext;
import kotlin.jvm.JvmClassMappingKt;
import kotlinx.coroutines.BuildersKt;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Writes finished workouts and weigh-ins to Health Connect (#200), the phone's own store for
 * health data, so other apps can read them. Write-only and off until the user turns it on in
 * Settings: no permission is asked for before that. What to write is worked out in JS
 * (lib/health-connect.js); this side only turns those plain objects into records.
 *
 * Every record carries openGym's own id as its clientRecordId, so writing it again replaces it,
 * and "remove" finds exactly the records openGym wrote. The version is the time of the write:
 * Health Connect keeps a rewritten record only when its version is higher than the stored one.
 *
 * The client's API is Kotlin suspend functions. They are called from a worker thread through
 * runBlocking, which keeps the Android project Java-only.
 *
 * The client library needs Android 8 (API 26) and Health Connect itself Android 9 (API 28); the
 * app supports Android 6, so every entry point checks the version before a Health Connect class
 * is touched, and answers "unsupported" below 9.
 *
 * Usage from JS (lib/health-sync.js):
 *   const HC = registerPlugin('HealthConnect');
 *   await HC.status();              // { status: 'available' | 'update' | 'missing' | 'unsupported', granted }
 *   await HC.requestPermissions();  // { granted }
 *   await HC.write({ sessions: [...], weights: [...] });
 *   await HC.remove({ sessions: [ids], weights: [ids] });
 *   await HC.openSettings();        // Health Connect's data screen, or its store page
 */
@CapacitorPlugin(name = "HealthConnect")
public class HealthConnectPlugin extends Plugin {

    private static final String PROVIDER = "com.google.android.apps.healthdata";
    // The literal permission names, as declared in AndroidManifest.xml.
    private static final String WRITE_EXERCISE = "android.permission.health.WRITE_EXERCISE";
    private static final String WRITE_WEIGHT = "android.permission.health.WRITE_WEIGHT";
    // Reading the band's night and day for the recovery engine (lib/biometrics.js): a separate
    // set, asked for only when the person turns the Recovery card on. Everything a band app
    // writes to Health Connect — sleep with its stages, the heart rate and the resting heart rate,
    // steps, heart-rate variability — and nothing else.
    private static final String READ_SLEEP = "android.permission.health.READ_SLEEP";
    private static final String READ_HEART_RATE = "android.permission.health.READ_HEART_RATE";
    private static final String READ_RESTING_HEART_RATE = "android.permission.health.READ_RESTING_HEART_RATE";
    private static final String READ_STEPS = "android.permission.health.READ_STEPS";
    private static final String READ_HRV = "android.permission.health.READ_HEART_RATE_VARIABILITY";
    private static final String TAG = "openGym/HealthConnect";
    // Health Connect takes at most this many records in one insert.
    private static final int CHUNK = 500;
    private static final int PAGE = 1000;
    private static final int MAX_READ_DAYS = 14;
    private static final int MAX_SAMPLES = 40000;

    // One at a time, in order: a remove queued behind a write must not overtake it.
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private static boolean supported() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P;
    }

    private static Set<String> permissions() {
        Set<String> p = new HashSet<>();
        p.add(WRITE_EXERCISE);
        p.add(WRITE_WEIGHT);
        return p;
    }

    private static Set<String> readPermissions() {
        Set<String> p = new HashSet<>();
        p.add(READ_SLEEP);
        p.add(READ_HEART_RATE);
        p.add(READ_RESTING_HEART_RATE);
        p.add(READ_STEPS);
        p.add(READ_HRV);
        return p;
    }
    // The optional one: a band without HRV must not block the rest.
    private static Set<String> requiredReadPermissions() {
        Set<String> p = readPermissions();
        p.remove(READ_HRV);
        return p;
    }

    private String sdkStatus() {
        if (!supported()) return "unsupported";
        int s = HealthConnectClient.Companion.getSdkStatus(getContext(), PROVIDER);
        if (s == HealthConnectClient.SDK_AVAILABLE) return "available";
        if (s == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return "update";
        // Android 13 and lower need the Health Connect app; 14 and up have it built in, so
        // "missing" there means the phone has no Health Connect at all (some Android Go builds).
        return Build.VERSION.SDK_INT >= 34 ? "unsupported" : "missing";
    }

    private HealthConnectClient client() {
        return HealthConnectClient.Companion.getOrCreate(getContext(), PROVIDER);
    }

    @SuppressWarnings("unchecked")
    private Set<String> granted() throws InterruptedException {
        PermissionController pc = client().getPermissionController();
        return (Set<String>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> pc.getGrantedPermissions(cont));
    }

    @PluginMethod
    public void status(PluginCall call) {
        String status = sdkStatus();
        if (!"available".equals(status)) {
            JSObject r = new JSObject();
            r.put("status", status);
            r.put("granted", false);
            call.resolve(r);
            return;
        }
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                Set<String> g = granted();
                r.put("status", status);
                r.put("granted", g.containsAll(permissions()));
                r.put("readGranted", g.containsAll(requiredReadPermissions()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), permissions());
        startActivityForResult(call, intent, "permissionsResult");
    }

    @ActivityCallback
    private void permissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Set<String> got = contract.parseResult(result.getResultCode(), result.getData());
        // The dialog answers only for this time; ask Health Connect what stands now, since the
        // user may also have granted one of the two and not the other.
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("granted", (got != null && got.containsAll(permissions())) || granted().containsAll(permissions()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                long version = System.currentTimeMillis();
                List<Record> records = new ArrayList<>();
                for (int i = 0; i < sessions.length(); i++) records.add(session(sessions.getJSONObject(i), version));
                for (int i = 0; i < weights.length(); i++) records.add(weight(weights.getJSONObject(i), version));
                for (int from = 0; from < records.size(); from += CHUNK) {
                    List<Record> part = records.subList(from, Math.min(records.size(), from + CHUNK));
                    BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().insertRecords(part, cont));
                }
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    @PluginMethod
    public void remove(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        JSArray sessions = call.getArray("sessions", new JSArray());
        JSArray weights = call.getArray("weights", new JSArray());
        worker.execute(() -> {
            try {
                delete(ExerciseSessionRecord.class, ids(sessions));
                delete(WeightRecord.class, ids(weights));
                call.resolve();
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    /* ---------- reading the band's night and day (the recovery engine) ---------- */

    @PluginMethod
    public void requestReadPermissions(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        ActivityResultContract<Set<String>, Set<String>> contract = PermissionController.createRequestPermissionResultContract(PROVIDER);
        Intent intent = contract.createIntent(getContext(), readPermissions());
        startActivityForResult(call, intent, "readPermissionsResult");
    }

    @ActivityCallback
    private void readPermissionsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        worker.execute(() -> {
            try {
                JSObject r = new JSObject();
                r.put("readGranted", granted().containsAll(requiredReadPermissions()));
                call.resolve(r);
            } catch (Exception e) {
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    /**
     * Everything the recovery engine reads, for the last `days` days, as plain rows; what they
     * mean (the night, the resting heart rate, the score) is worked out in lib/biometrics.js.
     *   sleep:     [{ start, end, stages: [[start, end, stage], …] }]   stage: Health Connect's own code
     *   restingHr: [[time, bpm]]
     *   hr:        [[time, bpm]]                                        every sample, bounded
     *   steps:     [[start, end, count]]
     *   hrv:       [[time, rmssdMs]]
     * Times are epoch milliseconds.
     */
    @PluginMethod
    public void readRecovery(PluginCall call) {
        if (!"available".equals(sdkStatus())) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        final int days = Math.max(1, Math.min(MAX_READ_DAYS, call.getInt("days", 3)));
        worker.execute(() -> {
            try {
                Instant end = Instant.now();
                Instant start = end.minusSeconds((long) days * 86400L);
                TimeRangeFilter range = TimeRangeFilter.Companion.between(start, end);
                JSObject out = new JSObject();

                JSArray sleep = new JSArray();
                for (Record rec : readAll(SleepSessionRecord.class, range)) {
                    SleepSessionRecord s = (SleepSessionRecord) rec;
                    JSObject o = new JSObject();
                    o.put("start", s.getStartTime().toEpochMilli());
                    o.put("end", s.getEndTime().toEpochMilli());
                    JSArray stages = new JSArray();
                    for (SleepSessionRecord.Stage st : s.getStages()) {
                        JSArray row = new JSArray();
                        row.put(st.getStartTime().toEpochMilli());
                        row.put(st.getEndTime().toEpochMilli());
                        row.put(st.getStage());
                        stages.put(row);
                    }
                    o.put("stages", stages);
                    sleep.put(o);
                }
                out.put("sleep", sleep);

                JSArray resting = new JSArray();
                for (Record rec : readAll(RestingHeartRateRecord.class, range)) {
                    RestingHeartRateRecord r = (RestingHeartRateRecord) rec;
                    JSArray row = new JSArray();
                    row.put(r.getTime().toEpochMilli());
                    row.put(r.getBeatsPerMinute());
                    resting.put(row);
                }
                out.put("restingHr", resting);

                JSArray hr = new JSArray();
                int n = 0;
                for (Record rec : readAll(HeartRateRecord.class, range)) {
                    for (HeartRateRecord.Sample smp : ((HeartRateRecord) rec).getSamples()) {
                        if (n++ >= MAX_SAMPLES) break;
                        JSArray row = new JSArray();
                        row.put(smp.getTime().toEpochMilli());
                        row.put(smp.getBeatsPerMinute());
                        hr.put(row);
                    }
                }
                out.put("hr", hr);

                JSArray steps = new JSArray();
                for (Record rec : readAll(StepsRecord.class, range)) {
                    StepsRecord s = (StepsRecord) rec;
                    JSArray row = new JSArray();
                    row.put(s.getStartTime().toEpochMilli());
                    row.put(s.getEndTime().toEpochMilli());
                    row.put(s.getCount());
                    steps.put(row);
                }
                out.put("steps", steps);

                JSArray hrv = new JSArray();
                try {
                    for (Record rec : readAll(HeartRateVariabilityRmssdRecord.class, range)) {
                        HeartRateVariabilityRmssdRecord h = (HeartRateVariabilityRmssdRecord) rec;
                        JSArray row = new JSArray();
                        row.put(h.getTime().toEpochMilli());
                        row.put(h.getHeartRateVariabilityMillis());
                        hrv.put(row);
                    }
                } catch (SecurityException e) {
                    // HRV is optional: a phone that did not grant it still gets the rest.
                }
                out.put("hrv", hrv);
                out.put("days", days);
                Log.d(TAG, "readRecovery: " + sleep.length() + " sleep sessions, " + resting.length() + " resting HR, " + hr.length() + " HR samples, " + steps.length() + " step records, " + hrv.length() + " HRV in " + days + " days");
                call.resolve(out);
            } catch (SecurityException e) {
                call.reject(e.getMessage(), "permission");
            } catch (Exception e) {
                Log.d(TAG, "readRecovery failed: " + e.getMessage());
                call.reject(e.getMessage(), "failed");
            }
        });
    }

    /** Every record of a type in the range, page after page. */
    @SuppressWarnings("unchecked")
    private <T extends Record> List<Record> readAll(Class<T> type, TimeRangeFilter range) throws InterruptedException {
        List<Record> out = new ArrayList<>();
        String token = null;
        do {
            final String page = token;
            ReadRecordsRequest<T> req = new ReadRecordsRequest<>(JvmClassMappingKt.getKotlinClass(type), range, Collections.emptySet(), true, PAGE, page);
            ReadRecordsResponse<T> res = (ReadRecordsResponse<T>) BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) -> client().readRecords(req, cont));
            out.addAll(res.getRecords());
            token = res.getPageToken();
        } while (token != null && out.size() < MAX_SAMPLES);
        return out;
    }

    // Health Connect's own screen for the data apps wrote, where the user can look at and delete
    // what openGym wrote. Without Health Connect (Android 13 and lower), its store page instead.
    @PluginMethod
    public void openSettings(PluginCall call) {
        String status = sdkStatus();
        if ("unsupported".equals(status)) {
            call.reject("Health Connect is not available", "unavailable");
            return;
        }
        try {
            Intent intent = "available".equals(status)
                    ? HealthConnectClient.Companion.getHealthConnectManageDataIntent(getContext(), PROVIDER)
                    : new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + PROVIDER + "&url=healthconnect%3A%2F%2Fonboarding"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage(), "failed");
        }
    }

    private void delete(Class<? extends Record> type, List<String> clientIds) throws InterruptedException {
        for (int from = 0; from < clientIds.size(); from += CHUNK) {
            List<String> part = clientIds.subList(from, Math.min(clientIds.size(), from + CHUNK));
            BuildersKt.runBlocking(EmptyCoroutineContext.INSTANCE, (scope, cont) ->
                    client().deleteRecords(JvmClassMappingKt.getKotlinClass(type), Collections.emptyList(), part, cont));
        }
    }

    private static List<String> ids(JSArray array) throws JSONException {
        List<String> out = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) out.add(array.getString(i));
        return out;
    }

    // The offset in force at that moment where the phone is now: what Health Connect shows the
    // session's local time with.
    private static ZoneOffset offsetAt(Instant at) {
        return ZoneId.systemDefault().getRules().getOffset(at);
    }

    private static ExerciseSessionRecord session(JSONObject s, long version) throws JSONException {
        Instant start = Instant.ofEpochMilli(s.getLong("start"));
        Instant end = Instant.ofEpochMilli(s.getLong("end"));
        String title = s.optString("title", "");
        String notes = s.optString("notes", "");
        return new ExerciseSessionRecord(
                start, offsetAt(start), end, offsetAt(end),
                Metadata.manualEntry(s.getString("id"), version),
                exerciseType(s.optString("type")),
                title.isEmpty() ? null : title,
                notes.isEmpty() ? null : notes);
    }

    private static WeightRecord weight(JSONObject w, long version) throws JSONException {
        Instant time = Instant.ofEpochMilli(w.getLong("time"));
        return new WeightRecord(time, offsetAt(time), Mass.kilograms(w.getDouble("kg")),
                Metadata.manualEntry(w.getString("id"), version));
    }

    // The names lib/health-connect.js uses (SESSION_TYPES); anything else is "other".
    private static int exerciseType(String name) {
        switch (name) {
            case "strength_training": return ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING;
            case "walking": return ExerciseSessionRecord.EXERCISE_TYPE_WALKING;
            case "running": return ExerciseSessionRecord.EXERCISE_TYPE_RUNNING;
            case "biking_stationary": return ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY;
            case "elliptical": return ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL;
            case "stair_climbing_machine": return ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE;
            default: return ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT;
        }
    }
}
