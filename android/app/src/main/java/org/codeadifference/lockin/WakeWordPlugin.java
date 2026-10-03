package org.codeadifference.lockin;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Process;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;
import org.vosk.Model;
import org.vosk.Recognizer;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * "Hey Lock In", heard on the phone.
 *
 * Android's own speech recogniser beeps every time it starts, so listening for
 * a wake phrase with it means a beep every few seconds. This listens with
 * Vosk instead: a small speech model that runs entirely on the phone, silent,
 * with nothing sent anywhere, and that only knows the wake phrases. When it
 * hears one it fires a "wake" event and stops; the web app then listens to the
 * command with the normal recogniser, answers, and starts this again.
 *
 * The 40 MB model is downloaded once, the first time hands-free is switched
 * on, rather than being baked into the app.
 */
@CapacitorPlugin(
    name = "WakeWord",
    permissions = { @Permission(alias = "mic", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class WakeWordPlugin extends Plugin {
    private static final String MODEL_NAME = "vosk-model-small-en-us-0.15";
    private static final String MODEL_URL = "https://alphacephei.com/vosk/models/" + MODEL_NAME + ".zip";
    private static final int RATE = 16000;
    // What people say, and how recognisers hear "lock in". Anything else is [unk].
    private static final String GRAMMAR = "[\"hey lock in\", \"hey locking\", \"hey look in\", \"hey log in\", \"hey luck in\", "
        + "\"hay lock in\", \"hi lock in\", \"okay lock in\", \"ok lock in\", \"okay locking\", \"hello lock in\", \"[unk]\"]";
    private static final double MIN_CONF = 0.6;

    private volatile Thread worker;
    private volatile boolean running;
    private Model model;

    @PluginMethod
    public void start(PluginCall call) {
        android.util.Log.d("WakeWord", "start requested");
        if (getPermissionState("mic") != PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micResult");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void micResult(PluginCall call) {
        if (getPermissionState("mic") == PermissionState.GRANTED) begin(call);
        else call.reject("Microphone access is blocked. Allow it for LOCK IN! in Settings.");
    }

    @PluginMethod
    public void stop(PluginCall call) {
        halt();
        call.resolve();
    }

    private synchronized void begin(PluginCall call) {
        if (running) { call.resolve(); return; }
        running = true;
        android.util.Log.d("WakeWord", "starting worker");
        worker = new Thread(this::loop, "wake-word");
        worker.start();
        call.resolve();   // progress and failures arrive as events
    }

    private void halt() {
        running = false;
        Thread t = worker;
        worker = null;
        if (t != null && t != Thread.currentThread()) {
            try { t.join(1500); } catch (InterruptedException ignored) { }
        }
    }

    @Override
    protected void handleOnDestroy() {
        halt();
        if (model != null) { model.close(); model = null; }
    }

    private void state(String s, double progress) {
        JSObject o = new JSObject();
        o.put("state", s);
        o.put("progress", progress);
        notifyListeners("state", o);
    }

    private void fail(String message) {
        running = false;
        JSObject o = new JSObject();
        o.put("message", message);
        notifyListeners("error", o);
    }

    private void loop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        try {
            File dir = new File(getContext().getFilesDir(), MODEL_NAME);
            if (!new File(dir, ".ok").exists()) download(dir);
            if (!running) return;
            if (model == null) { state("loading", 0); model = new Model(dir.getAbsolutePath()); }
        } catch (Throwable e) {
            fail("I couldn't get the wake-word model: " + e.getMessage() + " Check the connection and try again.");
            return;
        }

        int min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord rec = null;
        Recognizer recognizer = null;
        boolean woke = false;
        try {
            rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, Math.max(min, RATE));
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) { fail("The microphone couldn't be opened. Another app may be using it."); return; }
            recognizer = new Recognizer(model, (float) RATE, GRAMMAR);
            recognizer.setWords(true);
            rec.startRecording();
            state("listening", 1);
            short[] buf = new short[RATE / 4];
            while (running) {
                int n = rec.read(buf, 0, buf.length);
                if (n < 0) { fail("The microphone stopped."); return; }
                if (n == 0) continue;
                if (recognizer.acceptWaveForm(buf, n) && heardWake(recognizer.getResult())) { woke = true; running = false; }
            }
        } catch (Throwable e) {
            fail("Wake-word listening failed: " + e.getMessage());
        } finally {
            try { if (rec != null) { rec.stop(); rec.release(); } } catch (Throwable ignored) { }   // free the mic before the web app opens it
            if (recognizer != null) recognizer.close();
            state("stopped", 0);
            if (woke) {
                JSObject o = new JSObject();
                o.put("text", "hey lock in");
                notifyListeners("wake", o);
            }
        }
    }

    /** True if the result is one of the wake phrases, heard clearly enough. */
    private boolean heardWake(String json) {
        try {
            JSONObject r = new JSONObject(json);
            String text = r.optString("text", "").replace("[unk]", "").trim();
            // a greeting, then the name: "the lock is in the door" is not a wake phrase
            if (!text.matches("^(hey|hay|hi|hello|okay|ok)\\s+(lock in|locking|look in|log in|luck in)\\b.*")) return false;
            JSONArray words = r.optJSONArray("result");
            if (words == null || words.length() == 0) return false;
            double sum = 0;
            int n = 0;
            for (int i = 0; i < words.length(); i++) {
                JSONObject w = words.getJSONObject(i);
                if ("[unk]".equals(w.optString("word"))) continue;
                sum += w.optDouble("conf", 0);
                n++;
            }
            return n >= 2 && sum / n >= MIN_CONF;
        } catch (Exception e) {
            return false;
        }
    }

    private void download(File dir) throws Exception {
        File zip = new File(getContext().getCacheDir(), MODEL_NAME + ".zip");
        state("downloading", 0);
        HttpURLConnection c = (HttpURLConnection) new URL(MODEL_URL).openConnection();
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        long total = c.getContentLengthLong();
        try (InputStream in = new BufferedInputStream(c.getInputStream()); OutputStream out = new FileOutputStream(zip)) {
            byte[] b = new byte[64 * 1024];
            long got = 0;
            int last = -1;
            int n;
            while (running && (n = in.read(b)) > 0) {
                out.write(b, 0, n);
                got += n;
                int pct = total > 0 ? (int) (got * 100 / total) : 0;
                if (pct != last && pct % 5 == 0) { last = pct; state("downloading", pct / 100.0); }
            }
        }
        if (!running) { zip.delete(); return; }
        state("unpacking", 0);
        File parent = getContext().getFilesDir();
        try (ZipInputStream z = new ZipInputStream(new BufferedInputStream(new FileInputStream(zip)))) {
            ZipEntry e;
            byte[] b = new byte[64 * 1024];
            while ((e = z.getNextEntry()) != null) {
                File f = new File(parent, e.getName());
                if (!f.getCanonicalPath().startsWith(parent.getCanonicalPath())) continue;   // no path tricks
                if (e.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = z.read(b)) > 0) out.write(b, 0, n);
                }
            }
        }
        zip.delete();
        if (!new File(dir, "am").exists()) throw new Exception("the download was incomplete.");
        new File(dir, ".ok").createNewFile();
    }
}
