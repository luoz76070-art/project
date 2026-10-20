package com.mobilecodex.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.ServerPath;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(HotUpdatePlugin.class);
        registerPlugin(SecureCredentialsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        String bundlePath = HotUpdateStore.startupBundlePath(this);
        if (bundlePath != null) {
            bridgeBuilder.setServerPath(new ServerPath(ServerPath.PathType.BASE_PATH, bundlePath));
        }
        super.load();
    }
}
