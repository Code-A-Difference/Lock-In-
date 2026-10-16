package org.codeadifference.lockin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.provider.Telephony;
import android.telecom.TelecomManager;
import android.view.inputmethod.InputMethodInfo;
import android.view.inputmethod.InputMethodManager;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Watches the front app while a focus lock is on, and brings LOCK IN! back when a different app comes up.
 * It only runs after the student agreed to the notice and granted Usage access and Display over other apps,
 * it shows a notification the whole time, and it stops by itself at the end of the lock. It never closes or
 * kills anything. Calls, messages, contacts, emergency apps, the home screen, settings and the keyboard
 * are always left alone.
 *
 * It can also ask the site now and then whether a lock was started on the student's other device (so a
 * phone with the app closed still gets locked). That uses the app's own sign-in cookie; if the host's
 * browser check has expired it simply finds nothing until the app is opened again.
 */
public class StrictLinkService extends Service {
    private static final String CHANNEL = "focus_link";
    private static final int NOTE_ID = 4417;
    private static final long TICK_MS = 1000;
    private static final long POLL_MS = 15_000;
    private static final long BACK_COOLDOWN_MS = 2500;
    private static final long MAX_LOCK_MS = 4L * 3600_000L + 60_000L;

    private HandlerThread thread;
    private Handler handler;
    private volatile boolean stopped;
    private String front = "";
    private long lastBack = 0;
    private long lastPoll = 0;
    private long lastRev = -1;
    private String noteText = "";
    private Set<String> builtIn;

    static void begin(Context c) {
        Intent i = new Intent(c, StrictLinkService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Throwable ignored) { /* not allowed to start from here: the next app open tries again */ }
    }

    static void halt(Context c) { try { c.stopService(new Intent(c, StrictLinkService.class)); } catch (Throwable ignored) { } }

    private SharedPreferences prefs() { return getSharedPreferences(StrictLinkPlugin.PREFS, Context.MODE_PRIVATE); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        showNote("Starting");
        if (thread == null) {
            builtIn = alwaysAllowed();
            thread = new HandlerThread("strictlink");
            thread.start();
            handler = new Handler(thread.getLooper());
            handler.post(this::tick);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopped = true;
        if (thread != null) thread.quitSafely();
        super.onDestroy();
    }

    /* --------------------------------------------------------------- the loop */

    private void tick() {
        if (stopped) return;
        try {
            long now = System.currentTimeMillis();
            SharedPreferences p = prefs();
            long endsAt = p.getLong("endsAt", 0);
            boolean listen = p.getBoolean("listen", false);
            boolean locked = endsAt > now && endsAt - now <= MAX_LOCK_MS;
            if (!locked && endsAt != 0) { p.edit().remove("id").remove("endsAt").apply(); endsAt = 0; }
            if (!locked && listen && now - lastPoll >= POLL_MS) { lastPoll = now; pollSite(p); endsAt = p.getLong("endsAt", 0); locked = endsAt > now; }
            if (locked) {
                showNote("Locked in until " + new java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault()).format(new java.util.Date(endsAt)));
                watch(p);
            } else if (listen) {
                showNote("Ready to lock with your other device");
            } else {
                stopSelf();
                return;
            }
        } catch (Throwable ignored) { /* one bad tick must not end the lock */ }
        if (!stopped) handler.postDelayed(this::tick, TICK_MS);
    }

    /** Which app is in front now; if it is not allowed, bring LOCK IN! back. */
    private void watch(SharedPreferences p) {
        UsageStatsManager usm = (UsageStatsManager) getSystemService(Context.USAGE_STATS_SERVICE);
        if (usm == null) return;
        long now = System.currentTimeMillis();
        UsageEvents events = usm.queryEvents(now - 5000, now);
        UsageEvents.Event e = new UsageEvents.Event();
        String latest = null;
        while (events != null && events.hasNextEvent()) {
            events.getNextEvent(e);
            if (e.getEventType() == UsageEvents.Event.MOVE_TO_FOREGROUND) latest = e.getPackageName();
        }
        if (latest != null) front = latest;
        if (front.isEmpty() || isAllowed(front, p)) return;
        if (now - lastBack < BACK_COOLDOWN_MS) return;
        lastBack = now;
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i != null) {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            try { startActivity(i); } catch (Throwable ignored) { }
        }
    }

    private boolean isAllowed(String pkg, SharedPreferences p) {
        if (pkg.equals(getPackageName()) || builtIn.contains(pkg)) return true;
        try {
            JSONArray mine = new JSONArray(p.getString("allow", "[]"));
            for (int i = 0; i < mine.length(); i++) if (pkg.equals(mine.getString(i))) return true;
        } catch (Throwable ignored) { }
        return false;
    }

    /** Phone, messages, contacts, emergency, home screen, settings, keyboards: never brought back from. */
    private Set<String> alwaysAllowed() {
        Set<String> s = new HashSet<>();
        String[] fixed = {
            "android", "com.android.systemui", "com.android.settings", "com.android.phone", "com.android.server.telecom", "com.android.incallui",
            "com.android.dialer", "com.google.android.dialer", "com.samsung.android.dialer", "com.samsung.android.incallui",
            "com.android.mms", "com.google.android.apps.messaging", "com.samsung.android.messaging",
            "com.android.contacts", "com.google.android.contacts", "com.samsung.android.app.contacts",
            "com.android.emergency", "com.google.android.apps.safetyhub", "com.samsung.android.emergencymode",
            "com.android.permissioncontroller", "com.google.android.permissioncontroller", "com.google.android.packageinstaller",
        };
        for (String f : fixed) s.add(f);
        try { TelecomManager tm = (TelecomManager) getSystemService(Context.TELECOM_SERVICE); if (tm != null && tm.getDefaultDialerPackage() != null) s.add(tm.getDefaultDialerPackage()); } catch (Throwable ignored) { }
        try { String sms = Telephony.Sms.getDefaultSmsPackage(this); if (sms != null) s.add(sms); } catch (Throwable ignored) { }
        try {
            PackageManager pm = getPackageManager();
            Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            for (ResolveInfo r : pm.queryIntentActivities(home, 0)) s.add(r.activityInfo.packageName);
            Intent dial = new Intent(Intent.ACTION_DIAL);
            for (ResolveInfo r : pm.queryIntentActivities(dial, 0)) s.add(r.activityInfo.packageName);
            Intent sms = new Intent(Intent.ACTION_SENDTO, android.net.Uri.parse("smsto:"));
            for (ResolveInfo r : pm.queryIntentActivities(sms, 0)) s.add(r.activityInfo.packageName);
        } catch (Throwable ignored) { }
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
            List<InputMethodInfo> ims = imm.getEnabledInputMethodList();
            for (InputMethodInfo i : ims) s.add(i.getPackageName());
        } catch (Throwable ignored) { }
        return s;
    }

    /* ------------------------------------------------- a lock from the other device */

    /** Ask the site (with the app's own sign-in cookie) whether the student's other device started a lock. */
    private void pollSite(SharedPreferences p) {
        String api = p.getString("api", "");
        String deviceId = p.getString("deviceId", "");
        if (api.isEmpty() || deviceId.isEmpty()) return;
        try {
            String cookie = CookieManager.getInstance().getCookie(api);
            if (cookie == null || cookie.isEmpty()) return;
            JSONObject rev = post(api, cookie, "{\"action\":\"rev\"}");
            if (rev == null || !rev.optBoolean("ok")) return;
            long r = rev.optLong("rev", -2);
            if (r == lastRev) return;
            JSONObject me = post(api, cookie, "{\"action\":\"me\"}");
            if (me == null || !me.optBoolean("ok")) return;
            lastRev = r;
            JSONObject profile = me.getJSONObject("data").getJSONObject("profile");
            JSONObject terms = profile.optJSONObject("strictTerms");
            boolean lockOthers = profile.optJSONObject("focus") != null && profile.getJSONObject("focus").optJSONObject("strict") != null
                && profile.getJSONObject("focus").getJSONObject("strict").optBoolean("lockOthers", false);
            if (!lockOthers || terms == null || terms.optInt("v", -1) != p.getInt("termsVersion", 1)) return;
            if (terms.optBoolean("under18", false) && !terms.optBoolean("guardianOk", false)) return;
            JSONObject s = profile.optJSONObject("strictSession");
            if (s == null || s.optLong("endedAt", 0) != 0 || s.optString("deviceId").equals(deviceId)) return;
            long endsAt = s.optLong("endsAt", 0);
            long startedAt = s.optLong("startedAt", 0);
            long now = System.currentTimeMillis();
            if (endsAt <= now || endsAt - startedAt > MAX_LOCK_MS) return;
            p.edit().putString("id", s.optString("id")).putLong("endsAt", endsAt).apply();
        } catch (Throwable ignored) { /* the host's check page, no network, bad JSON: try again next time */ }
    }

    private JSONObject post(String api, String cookie, String body) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(api).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("X-LockIn", "1");
            c.setRequestProperty("Cookie", cookie);
            try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
            if (c.getResponseCode() != 200) return null;
            try (InputStream in = c.getInputStream()) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192]; int n;
                while ((n = in.read(buf)) > 0 && out.size() < 4_000_000) out.write(buf, 0, n);
                String text = out.toString("UTF-8").trim();
                if (!text.startsWith("{")) return null;      // the host's browser-check page, not our answer
                return new JSONObject(text);
            }
        } finally {
            c.disconnect();
        }
    }

    /* ------------------------------------------------------------ notification */

    private void showNote(String text) {
        if (text.equals(noteText)) { if (noteText.length() > 0) return; }
        noteText = text;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Focus link", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows while LOCK IN! is keeping you on task with your other device.");
            nm.createNotificationChannel(ch);
        }
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open == null ? new Intent() : open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setContentTitle("LOCK IN! focus link").setContentText(text).setSmallIcon(getApplicationInfo().icon)
            .setOngoing(true).setContentIntent(pi);
        Notification n = b.build();
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else startForeground(NOTE_ID, n);
        } catch (Throwable t) {
            stopSelf();
        }
    }
}
