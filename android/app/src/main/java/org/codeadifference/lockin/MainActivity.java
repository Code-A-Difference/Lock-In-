package org.codeadifference.lockin;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WakeWordPlugin.class);   // "Hey Lock In", listened for on the phone itself
        super.onCreate(savedInstanceState);
    }
}
