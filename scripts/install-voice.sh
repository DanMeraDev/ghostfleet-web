#!/usr/bin/env bash
# Local voice for ghostfleet web: whisper.cpp (hearing) + Kokoro (speaking), both in $HOME.
set -u
log() { echo "[$(date +%H:%M:%S)] $*"; }
W=~/.local/src/whisper.cpp
if [ ! -x ~/.local/share/whisper/whisper-cli ]; then
  log "whisper: clonando"
  [ -d "$W" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$W" || { log "whisper: clone falló"; }
  log "whisper: compilando"
  cmake -S "$W" -B "$W/build" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null \
    && cmake --build "$W/build" -j"$(nproc)" --target whisper-cli >/dev/null \
    && cp "$W/build/bin/whisper-cli" ~/.local/share/whisper/whisper-cli && log "whisper: binario listo" || log "whisper: compilación falló"
fi
if ! ls ~/.local/share/whisper/ggml-*.bin >/dev/null 2>&1; then
  log "whisper: bajando modelo small (multilingüe)"
  curl -fL --retry 3 -o ~/.local/share/whisper/ggml-small.bin.part \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin \
    && mv ~/.local/share/whisper/ggml-small.bin.part ~/.local/share/whisper/ggml-small.bin && log "whisper: modelo listo" || log "whisper: modelo falló"
fi
log "kokoro: instalando con el instalador de ghostfleet"
node --input-type=module -e "import('${GHOSTFLEET_HOME:-$HOME/.local/libexec/ghostfleet}/lib/kokoro-setup.mjs').then(K => K.install()).then(r => console.log('kokoro: resultado', JSON.stringify(r))).catch(e => console.log('kokoro: falló', e.message))"
log "listo"
