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
