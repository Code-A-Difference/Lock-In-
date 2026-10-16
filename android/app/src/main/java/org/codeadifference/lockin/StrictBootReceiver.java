package org.codeadifference.lockin;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/** After a restart, pick up a lock that has not ended yet (or the "ready to lock" link, if the student left it on). */
public class StrictBootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        SharedPreferences p = context.getSharedPreferences(StrictLinkPlugin.PREFS, Context.MODE_PRIVATE);
        if (p.getLong("endsAt", 0) > System.currentTimeMillis() || p.getBoolean("listen", false)) StrictLinkService.begin(context);
    }
}
