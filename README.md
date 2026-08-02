# Mesa · GM con IA

App web de rol (roleplay) con una IA como Game Master. Sin backend: es HTML/CSS/JS puro,
pensada para alojarse gratis en **GitHub Pages**. Todo tu progreso (campañas, sesiones,
memoria, documentos) se guarda en el `localStorage` de tu propio navegador — nada sale
hacia un servidor tuyo, solo hacia el modelo que elijas.

## Qué incluye

- **Campañas y sesiones**: una campaña = un mundo/partida. Cada sesión = un chat. Puedes
  abrir sesiones nuevas sin perder el hilo: al crear una sesión nueva se te ofrece resumir
  la anterior y fundirla en la **memoria persistente** de la campaña.
- **Memoria persistente por campaña**: un resumen editable a mano que se envía en cada
  turno para que el GM recuerde lo importante sin tener que reenviar el historial entero
  (ahorra tokens y dinero/tiempo de cómputo).
- **Documentos de contexto**: sube `.txt`/`.md` (lore, fichas de personaje, reglas de la
  casa...) y marca cuáles están "activos" para esa campaña. Solo los activos se envían.
- **Instrucciones del GM por campaña**: el "system prompt" que define cómo se comporta
  la IA. Viene con una plantilla de ejemplo — bórrala, edítala o sustitúyela por la tuya.
- **Dos formas de conectar el modelo**:
  - **API de Google (nube)**: usa tu propia API key gratuita de Google AI Studio con los
    modelos Gemma 4 (`gemma-4-31b-it` o `gemma-4-26b-a4b-it`).
  - **Modelo local (tu PC)**: se conecta a un servidor [Ollama](https://ollama.com) que
    corre en tu propia máquina, sin depender de internet ni de cuotas.

## Poner en marcha (GitHub Pages)

1. Crea un repositorio nuevo en GitHub y sube estos tres archivos (`index.html`,
   `style.css`, `app.js`) a la raíz (o a una carpeta `docs/`, como prefieras).
2. En el repo: **Settings → Pages → Deploy from a branch**, elige la rama y la carpeta
   donde están los archivos, guarda.
3. En un par de minutos tu app estará en `https://tu-usuario.github.io/tu-repo/`.

No hace falta `npm install` ni build: es HTML/CSS/JS plano.

## Conectar la IA — opción A: API de Google (recomendada para empezar)

1. Ve a [aistudio.google.com/apikey](https://aistudio.google.com/apikey) y genera una
   API key gratuita.
2. En la app, abre **⚙ Ajustes del modelo → Google AI (API)**, pega la key y elige modelo:
   - `gemma-4-31b-it`: modelo denso, más calidad, algo más lento.
   - `gemma-4-26b-a4b-it`: mixture-of-experts, más rápido/económico, calidad muy cercana.
3. La key se queda solo en tu navegador. Si compartes el enlace de tu GitHub Pages con
   otra persona, cada una necesita poner su propia key (no se comparte).

## Conectar la IA — opción B: modelo local en tu PC (RTX 3060, 12 GB VRAM)

Con 12 GB de VRAM dedicada, el punto dulce para tu tarjeta es **Gemma 4 12B** en
cuantización de 4 bits (~8 GB de descarga/VRAM): entra entera en la GPU, deja margen y
da bastante más calidad narrativa que las variantes más pequeñas (E2B/E4B), sin llegar
a necesitar los 16-24 GB que piden el 26B (MoE) o el 31B.

1. Instala [Ollama](https://ollama.com) (Windows/Mac/Linux).
2. Descarga el modelo:
   ```
   ollama pull gemma4:12b
   ```
3. Arranca el servidor permitiendo que tu página de GitHub Pages le hable por CORS
   (por defecto Ollama solo acepta peticiones locales):

   **Windows (PowerShell)**
   ```
   $env:OLLAMA_ORIGINS="*"
   ollama serve
   ```
   **macOS / Linux**
   ```
   OLLAMA_ORIGINS="*" ollama serve
   ```
   Si prefieres restringirlo a tu dominio en vez de `*`, usa
   `OLLAMA_ORIGINS="https://tu-usuario.github.io"`.
4. En la app: **⚙ Ajustes del modelo → Local (tu PC)**, deja la URL en
   `http://localhost:11434` y el modelo en `gemma4:12b`, guarda, y cambia el modo activo
   a "Usar modelo local".
5. Mientras `ollama serve` esté corriendo en tu PC, la app hablará con tu GPU. Si cierras
   la terminal, se corta.

Si tu PC tiene margen y quieres más calidad, el 26B (MoE, `gemma4:26b`) rinde muy bien
pero necesita bastante más RAM/VRAM libre; no es el recomendado por defecto para 12 GB.

## Cómo funciona el ahorro de tokens

- Cada turno solo se envían: las instrucciones del GM + la memoria resumida de la
  campaña + los documentos marcados como activos + los últimos N mensajes de la sesión
  actual (configurable en **Ajustes → Memoria y tokens**, por defecto 20).
- El historial completo se sigue guardando siempre en tu navegador (no se pierde nada
  al verlo en pantalla), el límite solo afecta a lo que viaja al modelo en cada turno.
- Cuando una sesión crece mucho, la app te avisa y te ofrece **resumirla y abrir una
  sesión nueva**: el resumen se funde en la memoria persistente, así el GM sigue
  recordando lo importante pero cada turno vuelve a ser barato.
- El resumen usa el mismo modelo que tengas activo (Google o local) con un prompt
  específico para comprimir en viñetas, no en prosa.

## Límites conocidos (versión inicial)

- Solo admite documentos de texto plano (`.txt`, `.md`). PDFs/DOCX se pueden añadir
  más adelante extrayendo el texto antes de subirlo.
- No hay backend ni cuentas de usuario: si cambias de navegador o borras datos del
  sitio, pierdes las campañas guardadas en ese navegador. Puedes hacer copia de
  seguridad exportando el `localStorage` si lo necesitas (o pídele a Claude que te
  añada un botón de exportar/importar JSON).
- La API de Gemma en Google AI Studio tiene límites de uso gratuito que pueden cambiar;
  revisa [ai.google.dev](https://ai.google.dev) si te da errores de cuota.
