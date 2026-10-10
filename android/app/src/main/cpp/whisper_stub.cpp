// 32-bit phones: whisper.cpp isn't built for them, so the plugin reports "not
// available" and the app keeps using the phone's own recogniser.
#include <jni.h>

extern "C" JNIEXPORT jboolean JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeAvailable(JNIEnv *, jclass) { return JNI_FALSE; }
extern "C" JNIEXPORT jlong JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeInit(JNIEnv *, jclass, jstring) { return 0; }
extern "C" JNIEXPORT void JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeFree(JNIEnv *, jclass, jlong) {}
extern "C" JNIEXPORT jstring JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeTranscribe(JNIEnv *env, jclass, jlong, jfloatArray, jstring, jstring, jint, jint) {
    return env->NewStringUTF("");
}
extern "C" JNIEXPORT jstring JNICALL
Java_org_codeadifference_lockin_WhisperPlugin_nativeSystemInfo(JNIEnv *env, jclass) { return env->NewStringUTF("not built for this phone"); }
