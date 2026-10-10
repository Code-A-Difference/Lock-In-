// The bridge between WhisperPlugin.java and whisper.cpp: load a model, turn
// 16 kHz mono samples into text, free the model. One call at a time (the Java
// side runs everything on a single thread).
#include <jni.h>
#include <string>
#include <android/log.h>
#include "whisper.h"

#define TAG "Whisper"

static std::string str(JNIEnv *env, jstring s) {
    if (!s) return "";
    const char *c = env->GetStringUTFChars(s, nullptr);
    std::string out(c ? c : "");
    if (c) env->ReleaseStringUTFChars(s, c);
    return out;
}

extern "C" JNIEXPORT jboolean JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeAvailable(JNIEnv *, jclass) { return JNI_TRUE; }

extern "C" JNIEXPORT jlong JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeInit(JNIEnv *env, jclass, jstring path) {
    whisper_context_params cp = whisper_context_default_params();
    cp.use_gpu = false;
    whisper_context *ctx = whisper_init_from_file_with_params(str(env, path).c_str(), cp);
    if (!ctx) __android_log_print(ANDROID_LOG_ERROR, TAG, "model failed to load");
    return reinterpret_cast<jlong>(ctx);
}

extern "C" JNIEXPORT void JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeFree(JNIEnv *, jclass, jlong ptr) {
    if (ptr) whisper_free(reinterpret_cast<whisper_context *>(ptr));
}

extern "C" JNIEXPORT jstring JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeTranscribe(JNIEnv *env, jclass, jlong ptr, jfloatArray pcm,
                                                               jstring language, jstring prompt, jint threads, jint audioCtx) {
    auto *ctx = reinterpret_cast<whisper_context *>(ptr);
    if (!ctx) return env->NewStringUTF("");
    std::string lang = str(env, language), hint = str(env, prompt);

    whisper_full_params p = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    p.n_threads        = threads;
    p.language         = lang.empty() ? "en" : lang.c_str();
    p.translate        = false;
    p.no_timestamps    = true;
    p.print_progress   = false;
    p.print_realtime   = false;
    p.print_special    = false;
    p.print_timestamps = false;
    p.suppress_blank   = true;
    p.temperature      = 0.0f;
    p.no_speech_thold  = 0.8f;      // same as the desktop app: a faraway voice still counts
    p.audio_ctx        = audioCtx;  // a short phrase doesn't need the full 30-second window
    if (!hint.empty()) p.initial_prompt = hint.c_str();

    jsize n = env->GetArrayLength(pcm);
    jfloat *data = env->GetFloatArrayElements(pcm, nullptr);
    int rc = whisper_full(ctx, p, data, n);
    env->ReleaseFloatArrayElements(pcm, data, JNI_ABORT);
    if (rc != 0) return env->NewStringUTF("");

    std::string out;
    for (int i = 0, k = whisper_full_n_segments(ctx); i < k; i++) out += whisper_full_get_segment_text(ctx, i);
    return env->NewStringUTF(out.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeSystemInfo(JNIEnv *env, jclass) {
    return env->NewStringUTF(whisper_print_system_info());
}
