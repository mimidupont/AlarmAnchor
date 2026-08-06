package com.deschamps.anchoralarm;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Registered before super.onCreate(), which is where BridgeActivity
        // builds the bridge from bridgeBuilder — anything added afterwards
        // is never seen by the webview. bridgeBuilder itself is a field
        // initialiser on the parent, so it already exists at this point.
        registerPlugin(AlarmAudioPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
