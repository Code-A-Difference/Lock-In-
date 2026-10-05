package org.codeadifference.lockin;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // "Hey Lock In", listened for on the phone itself. If the speech engine can't load on
        // some device, the app must still open — it just won't offer hands-free.
        try { registerPlugin(WakeWordPlugin.class); } catch (Throwable ignored) { }
        super.onCreate(savedInstanceState);
    }
}
