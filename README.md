# ghostfleet web

La flota de Claude Code de [ghostfleet](https://github.com/PabloG55/ghostfleet), desde el navegador y
para un equipo chico: con clics en vez de comandos, con un responsable por sesión y con un asistente
de voz que reparte el trabajo.

No reemplaza a ghostfleet: lo usa. Lee la flota con las mismas piezas que `fleet-serve`
(`fleet-grid.mjs --json`, `fleet-read --json`, `tmux capture-pane`) y actúa con el despachador de
ghostfleet (`mcp/fleet-dispatch.mjs`), con sus mismas validaciones.

## Arrancar

```bash
pnpm install
pnpm build

pnpm demo     # datos de ejemplo en memoria, para mostrarlo sin tocar nada real
pnpm start    # tu flota real (necesita ghostfleet instalado)
```

Abre <http://127.0.0.1:8790>. La primera vez pide crear las cuentas del equipo, una por persona.

Para desarrollo con recarga en caliente: `pnpm dev:demo` o `pnpm dev`, y abre <http://127.0.0.1:5190>.

| Variable | Para qué | Por defecto |
|---|---|---|
| `GHOSTFLEET_HOME` | dónde está instalado ghostfleet | `~/.local/libexec/ghostfleet` |
| `GFW_PORT` / `--port` | puerto | `8790` |
| `GFW_BIND` / `--bind` | interfaz: solo `127.0.0.1` o una IP de Tailscale | `127.0.0.1` |
| `GFW_DATA` | cuentas, responsables y actividad | `~/.config/ghostfleet-web/<modo>` |

## Qué tiene

- **Inicio**: lo que necesita atención en todos los proyectos, primero lo tuyo.
- **Proyecto**: las sesiones agrupadas en *Te necesitan / Trabajando / Listas para revisar / En pausa*,
  filtros por persona, worktrees libres y el asistente *Nueva sesión*.
- **Sesión**: la conversación como chat (con quién mandó cada instrucción), la terminal en vivo,
  los permisos como botones (*Sí, permitir / No*), y pausar, interrumpir, renombrar y detener.
- **Adjuntar archivos o imágenes** en el chat de cualquier sesión: 📎, arrastrar o pegar (hasta 10 por
  mensaje, 25 MB cada uno). Se guardan donde ghostfleet guarda las fotos del celular
  (`$CLAUDE_FLEET_DIR/attach/<socket>.<sesión>/`, con cuota por sesión) y el mensaje le pasa las rutas.
- **Automatizaciones** (estilo n8n, en el menú): un disparador y acciones en orden, armadas arrastrando
  bloques (o tocándolos, en el celular) o pidiéndoselas en una frase a la pestaña de IA, que llena los
  mismos bloques para que los revises antes de guardar.
  - *Disparadores*: a una hora (ciertos días, una vez, o cada N minutos/horas) o un evento de una
    sesión (termina, te necesita, empieza, se queda sin cupo, se cae), con un tiempo mínimo entre
    disparos para la misma sesión.
  - *Acciones*: mandar un prompt, crear una sesión, pausar, reanudar, despertar, interrumpir, reabrir,
    detener (pide confirmación al guardar), *seguir solo si…* la sesión está en cierto estado, avisarme y
    esperar. En prompts y nombres: `{fecha}` `{hora}` `{proyecto}` `{sesion}`.
  - Corren con el nombre de quien las creó y por las mismas verificaciones que un clic (quedan en
    *Actividad* con ⚡). Cada una es *personal* o *de equipo*.
  - **Si el servidor estaba apagado a la hora**, no se corre tarde: queda como *se saltó* y te avisa.
    Una que se dispara 30 veces en una hora se apaga sola (un bucle) y avisa.
  - La IA es un `claude -p` de una sola vuelta, sin herramientas ni MCP, que solo escribe el borrador;
    no queda abierto gastando memoria.
- **Responsable y presencia**: cada sesión tiene un dueño, y se ve cuando el otro está mirando o escribiendo.
- **Actividad**: todo lo que se hizo, con nombre y hora.
- **Asistente de voz**: todo lo que le dices pasa primero por un despachador (`server/router.mjs`, un
  `claude -p` de una sola vuelta que ve la conversación reciente y la flota), que separa lo dicho en tareas
  y le da a cada una **un solo destino**: el líder de un proyecto o una sesión nombrada. Si no está seguro,
  o si algo falla, la tarea queda anotada preguntando a dónde va, sin mandarse. Cada decisión queda en
  *Actividad* con su motivo. Lo que no sale de los nombres
  se le explica en `<datos>/router-notes.md` (qué proyecto lleva qué). El barco navega a la sesión donde está trabajando y, con
  *Seguirlo en vivo*, la pantalla va con él. Responde en voz alta y tiene modo manos libres.
  Órdenes que solo mueven la página no pasan por Claude: “muéstrame el mapa”, “abre la sesión stripe”.
- **Pedidos** (la lista al costado, en cualquier página): cada tarea pedida al asistente con su proyecto y
  su estado (*¿a dónde?, enviada, trabajando, te necesita, respondió*) y lo que le contestaron. Se guarda
  en el servidor, por persona (`tasks.json`), y sigue las respuestas de todos los proyectos a la vez; cada
  respuesta se lee diciendo de dónde viene, una después de otra. Una tarea sale de la lista cuando la
  marcas con ✓. Los comentarios sueltos (“perfecto”) se mandan pero no ocupan lugar.
- **Mapa en vivo**: todos los proyectos como islas y sus sesiones como barcos del color de su estado;
  el barco fantasma vuela a donde acaba de pasar algo, en cualquier proyecto, con un registro en vivo.
- **Etiquetas y mensajes programados**: “🏷 urgente cliente”, o “escríbele *continúa* mañana a las 9”.
  Cuando una sesión llega al límite de uso, un botón la deja programada para retomar sola al volver
  el cupo. Se guardan en los mismos marcadores que la grilla de ghostfleet, así que también se ven
  en la terminal.

## Voz

**Local primero.** Si la máquina tiene whisper.cpp y Kokoro (los mismos que usa el Jarvis de
ghostfleet), se transcribe y se habla aquí: el audio no sale de la máquina y funciona en cualquier
navegador. Se detectan solos:

| | dónde | cómo se instala |
|---|---|---|
| whisper.cpp (oír) | `~/.local/share/whisper/whisper-cli` + un `ggml-*.bin` | compilar [whisper.cpp](https://github.com/ggml-org/whisper.cpp) y bajar `ggml-small.bin` (multilingüe) |
| Kokoro (hablar) | `~/.local/share/kokoro` | `fleet-jarvis voice --kokoro --install`, o `lib/kokoro-setup.mjs` de ghostfleet |

Las dos cosas de una vez, en el home y sin `sudo` (necesita git, cmake, un compilador de C++ y `uv`):
`bash scripts/install-voice.sh`.

El idioma de whisper es español (`GFW_VOICE_LANG` para cambiarlo).

**Cuándo terminaste de hablar** lo decide [Silero VAD](https://github.com/snakers4/silero-vad) en el
navegador (vía [`@ricky0123/vad-web`](https://github.com/ricky0123/vad), el mismo detector que usa
[Handy](https://github.com/cjpais/Handy)): reconoce voz humana en vez de medir volumen, así que una
respiración, el teclado o un ventilador no cuentan como hablar, y una pausa para pensar no corta.
Cada persona elige en el asistente *Cuando hago una pausa*: 2,5 s, 4,5 s, o no cortar nunca y esperar
a *✓ Ya terminé*. Sus archivos (modelo, worklet y el wasm de onnxruntime, ~17 MB, se bajan una vez)
los sirve este mismo servidor: `pnpm build` los copia con `scripts/copy-vad.mjs`. Si no cargan, queda
un medidor de volumen como respaldo.

**Voces para elegir**, en *⚙ Voz* del asistente: las tres en español de Kokoro y, de internet, las de
[Piper](https://huggingface.co/rhasspy/piper-voices). Esas se escuchan antes y se bajan con un clic
(~60 MB cada una; la primera también instala `piper-tts` en `~/.local/share/piper` con `uv`, y cada
archivo se verifica contra el catálogo). Quedan para todos; cada navegador recuerda la suya. Solo cambian
las frases en español: las que están en inglés las sigue leyendo Kokoro.

**Si no hay voz local**, se usa la del navegador: el dictado funciona en Chrome y Edge (con internet,
porque Chrome lo procesa en sus servidores) y la lectura con `speechSynthesis`.

## Para proponer a ghostfleet

Las etiquetas y la programación las escribe hoy ghostfleet-web imitando a `fleet-grid.mjs`, que es su
único dueño (por eso `fleet-serve` las rechaza). Lo correcto es un comando en ghostfleet que sea dueño
de esos marcadores (`<sock>.<sesión>.label` y `.sched`) y herramientas MCP `fleet_label` /
`fleet_schedule` encima; entonces este servidor las llama como a las demás. De paso: `bin/fleet-schedule`
borra `<sesión>.sched` sin el socket delante, que no es el marcador que escribe la grilla (inofensivo,
porque la grilla ignora horas pasadas, pero deja el archivo).

## Seguridad

Igual que `fleet-serve`, esto es **ejecución remota de código por diseño**: mandarle una tarea a un
agente es correr comandos en esta máquina. Por eso:

- solo escucha en loopback o en Tailscale, y se niega a abrirse a la red local o a internet;
- solo responde a los nombres por los que se le llega (`127.0.0.1`, `localhost`, la IP de `--bind` y los de
  `GFW_HOSTS`, p. ej. un nombre MagicDNS): una página ajena que apunte su dominio a esta máquina (DNS rebinding)
  recibe 403;
- la primera vez, crear las cuentas pide el código de instalación que imprime la terminal (o el link
  `#codigo=…` que lo trae): llegar al puerto no alcanza para adueñarse de la flota;
- todo pide sesión iniciada; las contraseñas se guardan con scrypt y la cookie es `HttpOnly` + `SameSite=Strict`;
- toda escritura queda en la actividad con el nombre de quien la hizo;
- detener o borrar worktrees pide confirmación (y escribir el nombre, si borra);
- un permiso solo se responde si el pedido que viste sigue en pantalla (huella del pedido).

Para usarlo desde fuera de esta máquina: Tailscale y `--bind <ip-de-tailscale>`.
