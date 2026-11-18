#!/bin/sh
# Builds and runs the firmware engine's host tests; writes tests/vectors/vectors.json.
set -e
cd "$(dirname "$0")/../.."
mkdir -p build tests/vectors
g++ -std=c++17 -Wall -Wextra -Werror -O1 -fsanitize=address,undefined \
    tests/host/test_engine.cpp firmware/JamboPad/jp_config.cpp firmware/JamboPad/jp_engine.cpp \
    -o build/test_engine
build/test_engine tests/vectors/vectors.json
