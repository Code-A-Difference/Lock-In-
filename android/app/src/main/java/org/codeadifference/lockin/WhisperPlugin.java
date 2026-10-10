package org.codeadifference.lockin;

import android.content.SharedPreferences;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Speech to text on the phone, with whisper.cpp (through JNI, ARM NEON).
 *
 * The assistant's commands, push-to-talk and class recordings go through this
 * instead of Android's recogniser, which beeps and usually sends the audio to
 * Google. "Hey Lock In" itself is still heard by the small Vosk model in
 * WakeWordPlugin: running Whisper non-stop would drain the battery and heat the
 * phone.
 *
 * Models are downloaded the first time they're needed (too big for the APK):
 * small (190 MB) by default — accurate and quick enough on a phone — or turbo
 * (547 MB, large-v3 turbo) for the best accuracy on a fast phone.
 *
 * The web app sends a 16 kHz mono 16-bit WAV (base64) and gets the text back.
 * Everything runs on one background thread, one piece at a time.
 */
@CapacitorPlugin(name = "Whisper")
public class WhisperPlugin extends Plugin {
    private static final String HF = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";
    private static final String[][] MODELS = {
        // id, file, label, MB
        { "base",  "ggml-base-q5_1.bin",           "Fast (base)",            "57" },
        { "small", "ggml-small-q5_1.bin",          "Accurate (small)",       "181" },
        { "turbo", "ggml-large-v3-turbo-q5_0.bin", "Best (large-v3 turbo)",  "547" },
    };

    private static boolean loaded;
    static {
        try { System.loadLibrary("lockin_whisper"); loaded = nativeAvailable(); }
        catch (Throwable e) { loaded = false; }
    }
    static native boolean nativeAvailable();
    static native long nativeInit(String path);
    static native void nativeFree(long ctx);
    static native String nativeTranscribe(long ctx, float[] pcm, String language, String prompt, int threads, int audioCtx);
    static native String nativeSystemInfo();

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService fetcher = Executors.newSingleThreadExecutor();
    private long ctx = 0;
    private String ctxModel = null;
    private volatile String downloading = null;
    private volatile double progress = 0;

    private SharedPreferences prefs() { return getContext().getSharedPreferences("whisper", 0); }
    private File dir() { File d = new File(getContext().getFilesDir(), "whisper"); d.mkdirs(); return d; }
    private static String[] model(String id) { for (String[] m : MODELS) if (m[0].equals(id)) return m; return null; }
    private boolean installed(String id) {
        String[] m = model(id);
        if (m == null) return false;
        File f = new File(dir(), m[1]);
        return f.exists() && f.length() > Long.parseLong(m[3]) * 900_000L;
    }
    private String chosen() { return prefs().getString("model", "small"); }
    private boolean enabled() { return prefs().getBoolean("enabled", true); }

    /** The model to use now: the chosen one if it's here, otherwise any that is. */
    private String usable() {
        if (installed(chosen())) return chosen();
        for (String id : new String[] { "small", "base", "turbo" }) if (installed(id)) return id;
        return null;
    }

    private JSObject statusObject() {
        JSObject o = new JSObject();
        o.put("available", loaded);
        o.put("enabled", enabled());
        o.put("model", chosen());
        o.put("using", usable());
        JSObject ms = new JSObject();
        for (String[] m : MODELS) {
            JSObject x = new JSObject();
            x.put("label", m[2]); x.put("mb", Integer.parseInt(m[3])); x.put("installed", installed(m[0]));
            ms.put(m[0], x);
        }
        o.put("models", ms);
        if (downloading != null) { JSObject d = new JSObject(); d.put("id", downloading); d.put("progress", progress); o.put("downloading", d); }
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(statusObject()); }

    @PluginMethod
    public void set(PluginCall call) {
        SharedPreferences.Editor e = prefs().edit();
        if (call.hasOption("enabled")) e.putBoolean("enabled", Boolean.TRUE.equals(call.getBoolean("enabled")));
        String m = call.getString("model");
        if (m != null && model(m) != null) e.putString("model", m);
        e.apply();
        call.resolve(statusObject());
    }

    @PluginMethod
    public void download(PluginCall call) {
        String id = call.getString("id", chosen());
        String[] m = model(id);
        if (m == null) { call.reject("Unknown model."); return; }
        if (installed(id)) { call.resolve(statusObject()); return; }
        if (downloading != null) { call.reject("Another model is still downloading."); return; }
        downloading = id; progress = 0;
        notifyListeners("status", statusObject());
        fetcher.execute(() -> {
            File part = new File(dir(), m[1] + ".part");
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(HF + m[1]).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                long total = c.getContentLengthLong(), got = 0;
                long last = 0;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                    byte[] b = new byte[256 * 1024];
                    int n;
                    while ((n = in.read(b)) > 0) {
                        out.write(b, 0, n);
                        got += n;
                        progress = total > 0 ? (double) got / total : 0;
                        if (System.currentTimeMillis() - last > 500) { last = System.currentTimeMillis(); notifyListeners("status", statusObject()); }
                    }
                }
                if (total > 0 && got != total) throw new Exception("The download was cut short.");
                if (!part.renameTo(new File(dir(), m[1]))) throw new Exception("Could not save the model.");
                downloading = null;
                notifyListeners("status", statusObject());
                call.resolve(statusObject());
            } catch (Exception e) {
                part.delete();
                downloading = null;
                notifyListeners("status", statusObject());
                call.reject("The download failed: " + e.getMessage() + " Check the connection and try again.");
            }
        });
    }

    /** { wav: base64 16 kHz mono 16-bit, hint, language } -> { text, ms, model } */
    @PluginMethod
    public void transcribe(PluginCall call) {
        if (!loaded) { call.reject("not-available"); return; }
        if (!enabled()) { call.reject("off"); return; }
        String id = usable();
        if (id == null) { call.reject("no-model"); return; }
        String b64 = call.getString("wav", "");
        String hint = call.getString("hint", "");
        String lang = call.getString("language", "en");
        worker.execute(() -> {
            long t0 = System.currentTimeMillis();
            try {
                float[] pcm = samples(Base64.decode(b64, Base64.DEFAULT));
                if (pcm.length < 1600) { JSObject o = new JSObject(); o.put("text", ""); call.resolve(o); return; }
                if (ctx == 0 || !id.equals(ctxModel)) {
                    if (ctx != 0) nativeFree(ctx);
                    ctx = nativeInit(new File(dir(), model(id)[1]).getAbsolutePath());
                    ctxModel = ctx != 0 ? id : null;
                    if (ctx == 0) throw new Exception("The speech model didn't load. Download it again in Settings.");
                }
                // big.LITTLE phones: the fast cores do the work; more threads only add waiting
                int threads = Math.max(2, Math.min(6, Runtime.getRuntime().availableProcessors() - 2));
                // phrases and class pieces are 15 s at most: a 15 s window instead of 30 is about twice as fast
                int audioCtx = pcm.length <= 16000 * 15 ? 768 : 0;
                String text = nativeTranscribe(ctx, pcm, lang, hint, threads, audioCtx);
                JSObject o = new JSObject();
                o.put("text", text == null ? "" : text.trim());
                o.put("ms", System.currentTimeMillis() - t0);
                o.put("model", id);
                call.resolve(o);
            } catch (Throwable e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "On-phone transcription failed.");
            }
        });
    }

    @PluginMethod
    public void info(PluginCall call) {
        JSObject o = new JSObject();
        o.put("system", loaded ? nativeSystemInfo() : "not loaded");
        call.resolve(o);
    }

    /** A 16-bit PCM WAV -> samples in -1..1 (the data chunk, wherever it starts). */
    private static float[] samples(byte[] wav) {
        int at = 12, start = 44, len = wav.length - 44;
        while (at + 8 <= wav.length) {
            String id = new String(wav, at, 4);
            int size = (wav[at + 4] & 0xff) | (wav[at + 5] & 0xff) << 8 | (wav[at + 6] & 0xff) << 16 | (wav[at + 7] & 0xff) << 24;
            if (id.equals("data")) { start = at + 8; len = Math.min(size, wav.length - start); break; }
            at += 8 + size;
        }
        float[] out = new float[Math.max(0, len / 2)];
        for (int i = 0; i < out.length; i++) {
            short s = (short) ((wav[start + 2 * i] & 0xff) | (wav[start + 2 * i + 1] << 8));
            out[i] = s / 32768f;
        }
        return out;
    }

    @Override
    protected void handleOnDestroy() {
        worker.execute(() -> { if (ctx != 0) { nativeFree(ctx); ctx = 0; } });
        worker.shutdown();
        fetcher.shutdownNow();
    }
}
