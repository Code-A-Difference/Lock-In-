# whisper.cpp on the phone: speech to text with nothing sent anywhere.
#
# The engine is fetched at a pinned release when the app is built, so the repo
# carries only this bridge. It is built optimised even in debug builds: an
# unoptimised whisper takes minutes for a sentence.
#
# arm64 phones get ARM NEON (and the dot-product / fp16 instructions most
# phones since 2018 have, picked at run time by ggml). 32-bit phones get a
# stand-in library that just says "not available", so the app still runs.
cmake_minimum_required(VERSION 3.22)
project(lockin_whisper C CXX)

set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
set(CMAKE_CXX_STANDARD 17)

if (ANDROID_ABI STREQUAL "armeabi-v7a")
  add_library(lockin_whisper SHARED whisper_stub.cpp)
  target_link_libraries(lockin_whisper log)
  return()
endif()

include(FetchContent)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS      OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE            OFF CACHE BOOL "" FORCE)   # build for phones, not for this computer
set(GGML_OPENMP            OFF CACHE BOOL "" FORCE)   # ggml's own threads; avoids shipping libomp
if (ANDROID_ABI STREQUAL "arm64-v8a")
  set(GGML_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
  set(GGML_CPU_ARM_ARCH "armv8.2-a+fp16+dotprod" CACHE STRING "" FORCE)
endif()
FetchContent_Declare(whisper
  URL https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v1.9.5.tar.gz
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(whisper)

add_library(lockin_whisper SHARED whisper_jni.cpp)
target_link_libraries(lockin_whisper whisper log)
target_compile_options(lockin_whisper PRIVATE -O3)
