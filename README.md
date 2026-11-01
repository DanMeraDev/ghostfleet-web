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
- **Responsable y presencia**: cada sesión tiene un dueño, y se ve cuando el otro está mirando o escribiendo.
- **Actividad**: todo lo que se hizo, con nombre y hora.
- **Asistente de voz**: le hablas al líder (`master`) del proyecto, o a Jarvis si está activado, y él
  reparte el trabajo en sesiones. El barco navega a la sesión donde está trabajando y, con
  *Seguirlo en vivo*, la pantalla va con él. Responde en voz alta y tiene modo manos libres.
  Además entiende órdenes para moverse, sin gastar Claude: “ve a vault-invers”, “abre la sesión
  stripe”, “muéstrame el mapa”, “habla con el líder de cotizador” (tolera errores de transcripción).
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

El idioma de whisper es español (`GFW_VOICE_LANG` para cambiarlo). Grabar se corta solo tras 1,2 s
de silencio.

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
