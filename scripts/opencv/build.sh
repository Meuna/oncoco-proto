#!/usr/bin/env bash
# Custom minimal OpenCV.js build (wasm embedded in a single opencv.js, like the npm package).
# Needs git, cmake, python3 and ~2 GB of disk. Output: vendor/opencv/opencv.js.
# Not run in CI; see README.md next to this script.
set -euo pipefail

OPENCV_VERSION="${OPENCV_VERSION:-4.12.0}"
EMSDK_VERSION="${EMSDK_VERSION:-2.0.10}" # version documented by OpenCV's js_setup tutorial
WORK="${WORK:-$HOME/.cache/oncoco-opencv}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../vendor/opencv"

mkdir -p "$WORK" "$OUT"
cd "$WORK"

[ -d emsdk ] || git clone --depth 1 https://github.com/emscripten-core/emsdk.git
./emsdk/emsdk install "$EMSDK_VERSION"
./emsdk/emsdk activate "$EMSDK_VERSION"
# shellcheck disable=SC1091
source ./emsdk/emsdk_env.sh

[ -d "opencv-$OPENCV_VERSION" ] ||
  git clone --depth 1 --branch "$OPENCV_VERSION" https://github.com/opencv/opencv.git "opencv-$OPENCV_VERSION"
cd "opencv-$OPENCV_VERSION"

python3 platforms/js/build_js.py build_wasm \
  --build_wasm \
  --config "$HERE/opencv_js.config.py" \
  --cmake_option="-DBUILD_opencv_dnn=OFF" \
  --cmake_option="-DBUILD_opencv_objdetect=OFF" \
  --cmake_option="-DBUILD_opencv_photo=OFF" \
  --cmake_option="-DBUILD_opencv_video=OFF" \
  --cmake_option="-DBUILD_opencv_calib3d=OFF" \
  --cmake_option="-DBUILD_opencv_features2d=OFF" \
  --cmake_option="-DBUILD_opencv_flann=OFF"

cp build_wasm/bin/opencv.js "$OUT/opencv.js"
ls -lh "$OUT/opencv.js"
