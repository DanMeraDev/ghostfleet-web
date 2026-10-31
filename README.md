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
  reparte el trabajo en sesiones. El barco navega a la sesión donde está trabajando y, si eliges
  *Seguirlo en vivo*, la pantalla va con él. Responde en voz alta y tiene modo manos libres.

El dictado usa el reconocimiento de voz del navegador: funciona en **Chrome y Edge** (con internet,
porque Chrome lo procesa en sus servidores). Brave y Firefox no lo traen; ahí se le escribe.

## Seguridad

Igual que `fleet-serve`, esto es **ejecución remota de código por diseño**: mandarle una tarea a un
agente es correr comandos en esta máquina. Por eso:

- solo escucha en loopback o en Tailscale, y se niega a abrirse a la red local o a internet;
- todo pide sesión iniciada; las contraseñas se guardan con scrypt y la cookie es `HttpOnly` + `SameSite=Strict`;
- toda escritura queda en la actividad con el nombre de quien la hizo;
- detener o borrar worktrees pide confirmación (y escribir el nombre, si borra);
- un permiso solo se responde si el pedido que viste sigue en pantalla (huella del pedido).

Para usarlo desde fuera de esta máquina: Tailscale y `--bind <ip-de-tailscale>`.
