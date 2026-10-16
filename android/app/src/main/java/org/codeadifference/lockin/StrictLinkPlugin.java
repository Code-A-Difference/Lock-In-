package org.codeadifference.lockin;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

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

import org.json.JSONArray;

/**
 * The phone side of "lock my other device too". The web app (which decides when a lock is on, after the
 * student has agreed to the notice) tells this when a lock starts and when it ends; the foreground service
 * does the watching. Nothing here runs unless the student switched the feature on and granted the
 * permissions, and nothing is ever killed or closed: when another app comes to the front, LOCK IN! is
 * brought back. Phone, messages, contacts and emergency apps are always left alone.
 */
@CapacitorPlugin(
    name = "StrictLink",
    permissions = { @Permission(alias = "notify", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class StrictLinkPlugin extends Plugin {
    static final String PREFS = "strictlink";

    private boolean usageAccess() {
        try {
            AppOpsManager ops = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
            int mode = ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), getContext().getPackageName());
            return mode == AppOpsManager.MODE_ALLOWED;
        } catch (Throwable t) { return false; }
    }

    private boolean overlay() {
        try { return Settings.canDrawOverlays(getContext()); } catch (Throwable t) { return false; }
    }

    private boolean notifications() {
        if (Build.VERSION.SDK_INT < 33) return true;
        return getPermissionState("notify") == PermissionState.GRANTED;
    }

    private boolean dnd() {
        try {
            NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            return nm.isNotificationPolicyAccessGranted();
        } catch (Throwable t) { return false; }
    }

    /** Which permissions are granted, and whether a lock is being watched right now. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", true);
        r.put("usageAccess", usageAccess());
        r.put("overlay", overlay());
        r.put("notifications", notifications());
        r.put("dnd", dnd());
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        r.put("watching", p.getLong("endsAt", 0) > System.currentTimeMillis());
        call.resolve(r);
    }

    private void openSettings(PluginCall call, String action, boolean withPackage) {
        try {
            Intent i = new Intent(action);
            if (withPackage) i.setData(Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Throwable t) {
            call.reject("Could not open that settings page.");
        }
    }

    @PluginMethod public void openUsageAccess(PluginCall call) { openSettings(call, Settings.ACTION_USAGE_ACCESS_SETTINGS, false); }
    @PluginMethod public void openOverlay(PluginCall call) { openSettings(call, Settings.ACTION_MANAGE_OVERLAY_PERMISSION, true); }
    @PluginMethod public void openDnd(PluginCall call) { openSettings(call, Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS, false); }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (notifications()) { call.resolve(); return; }
        requestPermissionForAlias("notify", call, "notifyResult");
    }

    @PermissionCallback
    private void notifyResult(PluginCall call) { call.resolve(); }

    /**
     * Start watching until `endsAt` (epoch ms). `allow` is the student's own "never bring me back from these"
     * list of package names; the built-in always-allowed apps are added by the service. The site is also asked
     * about the lock (`api`, `cookieHost`) so a lock started elsewhere can reach a phone whose app is closed.
     */
    @PluginMethod
    public void start(PluginCall call) {
        Long endsAt = call.getLong("endsAt");
        String id = call.getString("id", "");
        if (endsAt == null || endsAt <= System.currentTimeMillis() + 1000) { call.reject("That lock has already ended."); return; }
        if (endsAt > System.currentTimeMillis() + 4L * 3600_000L + 60_000L) { call.reject("A lock can't be longer than four hours."); return; }
        if (!usageAccess() || !overlay()) { call.reject("Usage access and Display over other apps need to be on first."); return; }
        JSONArray allow = new JSONArray();
        try {
            JSArray a = call.getArray("allow");
            if (a != null) for (int i = 0; i < a.length() && i < 100; i++) allow.put(a.getString(i));
        } catch (Throwable ignored) { }
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("id", id).putLong("endsAt", endsAt).putString("allow", allow.toString()).apply();
        StrictLinkService.begin(getContext());
        call.resolve();
    }

    /** The lock is over (its time ran out, or it was ended early after the wait). */
    @PluginMethod
    public void stop(PluginCall call) {
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("id").remove("endsAt").apply();
        StrictLinkService.halt(getContext());
        call.resolve();
    }

    /** Keep the link alive when no lock is on, so a lock started on the computer reaches this phone. */
    @PluginMethod
    public void listen(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        String api = call.getString("api", "");
        // only ever the site this app loads; a page cannot point the watcher at anywhere else
        if (!api.startsWith("https://codeadifference.ct.ws/")) api = "";
        getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("listen", on)
            .putString("api", api).putString("deviceId", call.getString("deviceId", ""))
            .putInt("termsVersion", call.getInt("termsVersion", 1)).apply();
        if (on) {
            if (!usageAccess() || !overlay()) { call.reject("Usage access and Display over other apps need to be on first."); return; }
            StrictLinkService.begin(getContext());
        } else if (getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).getLong("endsAt", 0) <= System.currentTimeMillis()) {
            StrictLinkService.halt(getContext());
        }
        call.resolve();
    }
}
