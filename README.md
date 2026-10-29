# Lumière

Editor de vídeo web (uso personal de Dharmaeterno) pensado para Shorts/Reels, que funciona en el navegador del iPad (Safari) y del ordenador. No necesita servidor: todo se procesa en el propio dispositivo.

## Funciones
- Línea de tiempo táctil con pistas: Superpuesto, Vídeo, Texto, Efectos y Audio. Arrastrar, recortar por los bordes, dividir, duplicar, deshacer/rehacer e imán.
- Formatos 9:16, 4:5, 1:1 y 16:9. Encaje «llenar» o «ajustar» con fondo desenfocado.
- Color: 15 filtros y 13 ajustes (exposición, contraste, temperatura, luces, sombras, viñeta, grano, nitidez…).
- Movimiento (zoom lento, paneo, temblor, latido…), 13 transiciones de entrada/salida, velocidad 0,25×–4×.
- Pantalla verde con cuentagotas, máscaras (círculo, redondeada, degradados), recorte y modos de fusión (pantalla para fuego o chispas sobre negro).
- Texto con 12 fuentes, degradado, borde, sombra o brillo, fondo y animaciones de entrada, salida y bucle (máquina de escribir, letra a letra, pop, arcoíris…).
- 14 efectos de ambiente: fuego, brasas, niebla, humo, nieve, lluvia, destellos, polvo dorado, bokeh, rayos de luz, confeti, corazones, pétalos y hojas.
- 14 efectos de imagen: glitch, RGB, VHS, grano, temblor, flashes, latido, desenfoque, pixelado, espejo, B/N, sepia, viñeta y resplandor.
- Audio: música, voz en off grabada desde la app, volumen, fundidos y mezcla con limitador.
- Exportación MP4 fotograma a fotograma con WebCodecs, con alternativa en tiempo real si el navegador no lo admite.
- Guardado automático del proyecto en el propio dispositivo (IndexedDB).

## Publicación
Es un sitio estático: no hay que compilar nada. Se publica en Cloudflare Pages con la raíz del repositorio como carpeta de salida.

## Novedades
- **Selección múltiple**: botón «Seleccionar» en la línea de tiempo (tocar clips, recuadro arrastrando, «Todo», «Desde el cabezal», «Toda la pista»). Mover, duplicar, dividir, borrar y editar ajustes de varios clips a la vez.
- **Luces y estrellas** (Efectos): Brillo radiante, Constelación, Luces de invierno, Estelar, Reflector celestial y Fragmentos de estrella.
- **Subtítulos automáticos** (pestaña Texto): reconocimiento de voz Whisper en el propio navegador (transformers.js desde jsDelivr; la primera vez descarga el modelo), palabras resaltadas tipo karaoke, editor de revisión, importar/guardar .srt.
- **Interfaz gris tipo CapCut/DaVinci**: herramientas en la barra inferior; al tocar un clip, la barra cambia a sus herramientas (Dividir, Velocidad, Volumen, Keyframes, Posición, Opacidad, Filtros, Ajustar…). En iPad vertical el panel sale como hoja desde abajo.
- **Keyframes** (◆): opacidad, escala, posición, rotación, volumen (vídeo y audio), tamaño de texto, intensidad de efectos. Rombos en la línea de tiempo, navegación entre keyframes y movimiento suave.
- **Audio en iPad**: el sonido ya no se apaga con el interruptor de silencio; si el navegador no puede separar el audio de un vídeo, suena directamente desde el vídeo.
- **Efectos recreados de CapCut**: «Callejuela» (haz de luz dorado con polvo de estrellas) y «Perro forma» (bokeh rosado) en Efectos → Luces y estrellas; y las entradas de texto «Callejuela» (máquina de escribir con letra en degradado brillante) y «Perro forma» (llega con estela, cortes glitch, destello y rayo de luz), también como estilos rápidos.
- **V2**: icono propio de Lumière; efectos «Ascuas» (luces rojizas que laten y chispas que giran) y «Luciérnagas» (grandes luces ámbar con reflejos de lente); entradas de texto «Apertura» (se abre desde el centro con bordes suaves) y «Luciérnagas» (letras que se encienden fuera de sitio y caen a la línea, con resplandor detrás); transición «Velo de luz» (bruma luminosa que funde un clip con el siguiente).
- **V3**: efectos «Bokeh violeta», «Pétalos de rosa», «Polvo de luz» y «Atardecer estelar»; entradas de texto «Polvo de letras», «Estela de luz» e «Hilo dorado»; transiciones «Polvo mágico», «Ráfaga de color» y «Fundido a blanco»; 84 fuentes con vista previa (caligráficas, elegantes, modernas…); «Capas» para intercambiar el vídeo de encima con el de debajo (también con el botón ⇅ sobre la imagen) y subir/bajar capas; «Sustituir» para cambiar el vídeo, foto, audio o efecto de un clip sin perder sus ajustes.
- **Botones morado oscuro con relieve 3D**.
- **Gestos tipo CapCut**: con algo seleccionado, arrastrar o pellizcar fuera de la imagen también lo mueve, lo agranda/achica y lo gira (con imán a 0° y 90°).
- **Mis proyectos**: el proyecto se guarda solo en el dispositivo (también al cambiar de app o cerrar), aunque no exportes. Botón del proyecto (arriba) → «Mis proyectos guardados» para abrir, seguir o borrar; «Proyecto nuevo» ya no borra el anterior. Si un vídeo pesa demasiado para guardarlo, el resto del proyecto se conserva y la app avisa.
- **Scroll sobre los clips**: con el dedo, deslizar sobre un clip desplaza la línea de tiempo (útil con muchos subtítulos); para moverlo hay que mantenerlo pulsado un instante. Las asas de recorte salen solo en el clip seleccionado.
- **V4**: efecto «Partículas» (Efectos → Luces y estrellas), recreado fotograma a fotograma a partir de un vídeo de muestra: neblina ciruela con luz cálida en la esquina inferior izquierda (colores medidos en la muestra), discos de luz que flotan hacia la derecha con un leve vaivén y se desenfocan al apagarse, motas lejanas más lentas, algún destello con estelas horizontales y grano de película.
- **V5**: efecto «Partículas 2» (Efectos → Luces y estrellas), recreado del vídeo de muestra con medidas de color y tiempos: fondo ciruela oscuro con textura moteada de película, grandes discos de bokeh transparentes (ámbar, óxido, violeta y rosa) que flotan muy despacio y aparecen y se apagan, y cada unos 3 s una fuga de luz violeta que entra por la derecha y arriba, un resplandor lavanda en el borde superior y otro rosado abajo a la izquierda.
- **V6**: efecto «Partículas 3» (Efectos → Luces y estrellas), recreado del vídeo de muestra: sobre fondo ciruela con textura, cada luz nace abajo como una gota con brillo crema y filo rojizo, sube despacio, se desenfoca en halos con destellos y se convierte en un gran óvalo ámbar que sube rápido y se apaga (perfil de color y velocidad medidos en la muestra).
- **V7**: nuevo **Espectro de audio** (Efectos → 🎵 Espectro). 9 estilos (barras, barras espejo, bloques LED, puntos, línea, montañas, onda simétrica, circular y anillo) que se mueven con el audio del proyecto o con un clip concreto. Editables: colores y degradado, resplandor, nº de barras, separación, puntas redondeadas, grosor, altura, radio, giro, reflejo, rango de frecuencias, sensibilidad, suavidad, opacidad, posición, rotación y fundidos. Se calcula con FFT sobre el audio decodificado, así que la vista previa, el scrub y la exportación salen idénticos.
- **V8**: Lumière funciona **sin conexión**: tras abrirla una vez con internet, se guarda en el dispositivo (app, tipografías y modelo de subtítulos al usarlo) y abre aunque Cloudflare esté caído. Con conexión sigue cargando siempre la última versión.
- **V9**: efecto «Partículas 4» (Efectos → Luces): grandes bokeh rosa, mauve y coral que nacen abajo, suben despacio y se apagan, con resplandor cálido en la base, chispas ámbar y grano; recreado midiendo el vídeo de muestra (bucle de 3 s, brillo por altura, tamaños y velocidad de subida).
- **V10**: (1) nuevo texto animado **«Texto 1»** (Texto → estilos, y en Animación → Aparición «Texto 1 (destello)»), recreado de la muestra: el texto aparece desenfocado y se enfoca mientras un destello de lente naranja y blanco con rayo horizontal cruza su centro; las letras de los extremos salen primero y las del centro, tapadas por el destello, las últimas. En Animación puedes cambiar la **velocidad** (duración de la aparición, de 0,1 a 3 s) y la **intensidad del destello**. (2) El **espectro de audio** ahora se puede **seleccionar tocándolo en la imagen**: aparece su recuadro y se mueve arrastrando, se agranda o encoge pellizcando y se gira con dos dedos.

## V11
- Texto 2–9: ocho nuevas animaciones de aparición de texto (zoom suave, barrido con brillo, apertura desde el centro, cintas naranjas, barrido duro, glitch, letras al azar, centro nítido). La duración se ajusta con el control de velocidad.
- Se quitan los iconos/emoticonos de los botones de efectos.

## V12
- Texto 10 y Texto 11 (nuevas apariciones de texto).
- Toque con 2 dedos = deshacer, con 3 dedos = rehacer.
- Todos los efectos (luces, imagen, filtros, transiciones, animaciones) sin iconos y con botones más compactos.

## V13
- Botón «Proyectos» en la barra superior con galería de proyectos guardados (vista previa, abrir, renombrar, duplicar, borrar, proyecto nuevo) e indicador de guardado automático.

## V14
- Botón «Media»: biblioteca propia de recursos (Vídeos, Audios, Imágenes) que sirve para cualquier proyecto; Usar, Superponer (pantallas verdes), renombrar y quitar.

## V15 (revisión adversarial)
- Audio: micro-fundidos anti-chasquido en cada corte y limitador de techo en lugar del compresor fijo.
- Exportar: presets (Reel, YouTube 1080, 4K, 60 fps, 720p) con nivel H.264 calculado; ya no se bloquea si falta MediaRecorder.
- Guías de zonas seguras (Instagram, TikTok, Shorts) e imán al centro al arrastrar; subtítulos por defecto fuera de la zona de la interfaz.
- Texto: emoji, acentos del sánscrito (IAST) y devanagari ya no se rompen.
- Edición: Recortar ◀ ▶ al cabezal, Separar audio, Borrar y cerrar hueco.
- Croma: quitar reflejo del borde y afinar borde.
- Subtítulos: glosario de nombres (Shiva, Ganesha, Lakshmi…), borrado en bloque, ajuste de posición.
- Rendimiento: los clips lejanos del cabezal liberan su decodificador de vídeo, no se resube el mismo fotograma, onda de audio corregida en clips largos, service worker con límite de 3 s.
- El texto nuevo se ve al añadirlo; Media pasa a llamarse Biblioteca.
- Audio: ducking automático (marcar la narración como «Es voz» y activar «Bajar cuando hay voz» en la música).

## V16 (segunda tanda de la revisión)
- La vista previa ya no se congela si un clip tiene datos dañados.
- Al reabrir no se guarda un proyecto vacío encima del bueno, y los clips cuyo archivo falta se conservan para poder sustituirlos.
- Atajos de teclado bloqueados mientras se exporta o hay una ventana abierta.
- Espectro: la caché se invalida al editar. Dividir un clip ya no deja un fundido en el corte. Separar audio conserva los keyframes de volumen.
- Exportar: soporta vídeos largos (sin límite de pila en el MP4), espera a las tipografías, keyframes a 1/120 s, tiempo 59,96 ya no sale como 0:60.0.

## V17
- Vista previa más grande (iPad horizontal y vertical).
- Tira de fotogramas en los clips de vídeo de la línea de tiempo.
- Miniaturas reales en Efectos (Luces/Imagen) y Filtros.
- La línea de tiempo se desplaza al clip seleccionado.
