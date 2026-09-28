#!/usr/bin/env bash
# Сборка wasm-парсера демок CS2 из исходников demoparser2.
# Требуется: rustup (target wasm32-unknown-unknown), protoc, wasm-bindgen-cli 0.2.100, git.
# Результат: public/vendor/cs2demo/cs2_demo_wasm.js + cs2_demo_wasm_bg.wasm
set -euo pipefail
cd "$(dirname "$0")"

DEMOPARSER_REV="9ddb3739c65664392df6120337374f94511f8ea5"   # LaihoE/demoparser, 2026-09-21
PROTOS_REV="3fc98e763328f7d1627405b389d1b6b69c5b0e38"       # SteamDatabase/GameTracking-CS2, 2026-09-25
OUT="../public/vendor/cs2demo"

mkdir -p .vendor
if [ ! -d .vendor/demoparser/.git ]; then
  git clone --quiet https://github.com/LaihoE/demoparser.git .vendor/demoparser
fi
(
  cd .vendor/demoparser
  git fetch --quiet origin "$DEMOPARSER_REV" 2>/dev/null || true
  git checkout --quiet --force "$DEMOPARSER_REV"
  git apply ../../patches/demoparser-wasm.patch
)
# csgoproto/build.rs клонирует GameTracking-CS2 сам; клонируем заранее на закреплённом коммите.
P=.vendor/demoparser/src/csgoproto/GameTracking-CS2
if [ ! -d "$P/.git" ]; then
  git clone --quiet --filter=blob:none https://github.com/SteamDatabase/GameTracking-CS2.git "$P"
fi
git -C "$P" checkout --quiet "$PROTOS_REV"
# checkout выше возвращает старый сгенерированный protobuf.rs — заставляем build.rs пересобрать его.
touch "$P/Protobufs/demo.proto"

export PROTOC="${PROTOC:-$(command -v protoc)}"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --no-typescript --out-dir "$OUT" \
  target/wasm32-unknown-unknown/release/cs2_demo_wasm.wasm
if command -v wasm-opt >/dev/null; then
  wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int --enable-sign-ext \
    "$OUT/cs2_demo_wasm_bg.wasm" -o "$OUT/cs2_demo_wasm_bg.wasm"
fi
ls -la "$OUT"
