import type { LegalContent } from "./types";

const es: LegalContent = {
  updated: "Última actualización: {updated}",
  contents: "En esta página",
  docs: {
    about: {
      title: "Sobre EndzoneIQ y cómo funciona el modelo",
      description:
        "Qué es EndzoneIQ, de dónde salen sus datos y cómo se elabora, publica y evalúa cada pronóstico.",
      sections: [
        {
          heading: "Qué es EndzoneIQ",
          body: [
            "EndzoneIQ ayuda a los aficionados de la NFL a entender cada partido en unos 60 segundos: un pronóstico, una probabilidad de victoria, un nivel de confianza y tres razones claras. Es análisis para aficionados, **no un servicio de apuestas**, y no está afiliado a la NFL ni a ningún equipo.",
            "Cada pronóstico que publicamos queda en el [historial](/record), tanto los aciertos como los fallos.",
          ],
        },
        {
          heading: "El modelo, en pocas palabras",
          body: [
            "El punto de partida es un rating Elo para cada equipo: un número que sube cuando el equipo gana y baja cuando pierde, más cuanto más inesperado fue el resultado. El Elo por sí solo ya da pronósticos razonables.",
            "Encima del Elo, un modelo de aprendizaje automático (LightGBM) aprende pequeñas correcciones a partir de lo que el Elo no ve:",
            [
              "la eficiencia de cada ataque y cada defensa, jugada a jugada (EPA y tasa de éxito), incluidos el pase, la carrera, las jugadas explosivas y las pérdidas de balón;",
              "un cambio de quarterback y los titulares lesionados descartados o dudosos;",
              "los días de descanso, las semanas cortas, las semanas libres, la distancia del viaje y los husos horarios cruzados;",
              "los campos neutrales, los partidos de división y los playoffs;",
              "el clima de los partidos al aire libre: viento y temperatura.",
            ],
            "El modelo nunca usa las líneas de apuestas, así que es independiente del mercado. Sus probabilidades están calibradas: cuando dice 70 %, el equipo elegido debería ganar unas 7 de cada 10 veces a lo largo de muchos partidos.",
            "Antes del lanzamiento, el modelo se probó temporada a temporada con partidos que nunca había visto. Su ventaja sobre el Elo solo es pequeña y no es estadísticamente segura, y lo decimos. Todas las cifras, fallos incluidos, están en la [ficha del modelo]({modelCard}) (en inglés).",
          ],
        },
        {
          heading: "Niveles de confianza",
          body: [
            "El nivel depende de la probabilidad del equipo elegido: **Ligero** del 50 % al 58 %, **Sólido** del 58 % al 68 %, **Fuerte** por encima del 68 %. Un Ligero está cerca de una moneda al aire, y hay sorpresas en todos los niveles.",
          ],
        },
        {
          heading: "De dónde salen las tres razones",
          body: [
            "Cada razón se basa en los factores que más movieron la probabilidad de ese partido (medidos con valores SHAP). Un modelo de IA convierte esos factores en frases cortas en inglés, francés y español, y cada frase se comprueba: ninguna cifra que no esté en los datos del modelo y ningún lenguaje de apuestas. Si una comprobación falla, se usa una plantilla fija.",
          ],
        },
        {
          heading: "Cuándo se publican y actualizan los pronósticos",
          body: [
            "Los pronósticos de la semana siguiente se publican el martes. Si llega una noticia importante antes del inicio (un quarterback descartado, un cambio de clima), el partido se vuelve a calcular. Solo aparece una nueva versión si cambia el pronóstico o la probabilidad se mueve al menos 5 puntos, y todas las versiones siguen visibles en la página del partido.",
            "Al inicio del partido el pronóstico queda bloqueado. Después del partido se evalúa con el marcador final.",
          ],
        },
        {
          heading: "Por qué puedes confiar en el historial",
          body: [
            "Los pronósticos solo se añaden: una vez publicado, un pronóstico no se puede editar ni borrar, solo sustituir por una versión nueva antes del inicio. Cada pronóstico está enlazado con el anterior mediante un hash criptográfico, así que cualquier cambio en uno antiguo rompería la cadena. El último hash se muestra en el [historial](/record) y la cadena se verifica cada día.",
          ],
        },
        {
          heading: "Fuentes de datos",
          body: [
            "Calendarios, resultados, jugadas, plantillas, jerarquías y partes de lesiones: [nflverse](https://nflverse.com). Clima: [Open-Meteo](https://open-meteo.com) (CC BY 4.0). Los datos de los estadios son nuestra propia referencia. Los nombres y abreviaturas de los equipos se usan solo como texto; no usamos logotipos ni imágenes oficiales.",
          ],
        },
        {
          heading: "Contacto",
          body: ["Preguntas, correcciones o prensa: [{email}](mailto:{email})."],
        },
      ],
    },

    terms: {
      title: "Condiciones de uso",
      description: "Las reglas para usar EndzoneIQ, sus funciones gratuitas y el plan Pro.",
      sections: [
        {
          heading: "Quiénes somos",
          body: [
            "EndzoneIQ (endzoneiq.com, el «Servicio») está gestionado por {operator}, {address} («nosotros»). Contacto: [{email}](mailto:{email}). Al usar el Servicio aceptas estas condiciones. Si no las aceptas, no lo uses.",
          ],
        },
        {
          heading: "Qué es el Servicio y qué no es",
          body: [
            "EndzoneIQ publica análisis estadísticos de partidos de la NFL con fines de **entretenimiento e información**. Los pronósticos y las probabilidades son estimaciones de un modelo. Pueden fallar, y fallan a menudo. **Nada en el Servicio es asesoramiento de apuestas, financiero ni profesional**, y nada está garantizado. Si decides apostar, lo haces bajo tu responsabilidad y según las leyes que te apliquen. Consulta [Juego responsable](/responsible-gaming).",
            "EndzoneIQ es independiente y no está afiliado, respaldado ni patrocinado por la NFL ni por ningún equipo.",
          ],
        },
        {
          heading: "Quién puede usarlo",
          body: [
            "Debes tener al menos 18 años para crear una cuenta. Eres responsable de tu cuenta y de mantener segura tu contraseña. Avísanos enseguida si crees que otra persona la ha usado.",
          ],
        },
        {
          heading: "Plan gratuito, plan Pro y pagos",
          body: [
            "El plan gratuito incluye todos los pronósticos, su probabilidad de victoria y su razón principal, el historial completo y un número limitado de preguntas al asistente al día. El plan Pro añade más, como se describe en la [página de precios](/pricing).",
            "Cuando Pro esté disponible, se cobrará por adelantado a través de nuestro proveedor de pagos, se renovará automáticamente hasta que lo canceles y podrá cancelarse en cualquier momento desde tu cuenta; el acceso sigue hasta el final del periodo pagado. Una prueba gratuita, si se ofrece, solo se concede una vez por cuenta. Los precios y funciones pueden cambiar; un cambio de precio nunca se aplica a un periodo ya pagado, y te avisaremos antes de que se aplique al siguiente. Tus derechos legales como consumidor, incluido un posible derecho de desistimiento, no se ven afectados.",
          ],
        },
        {
          heading: "El asistente de IA",
          body: [
            "El asistente responde con los datos de EndzoneIQ, pero sus respuestas se generan automáticamente y pueden contener errores. Comprueba lo que sea importante. No incluyas información personal sensible en tus preguntas. Hay límites diarios de preguntas.",
          ],
        },
        {
          heading: "Uso aceptable",
          body: [
            "Por favor, no:",
            [
              "extraigas, copies o revendas en masa el contenido del Servicio, ni uses herramientas automáticas que lo sobrecarguen;",
              "intentes saltarte los límites de los planes, los controles de acceso o las medidas de seguridad;",
              "uses el Servicio para infringir la ley o perjudicar a otros;",
              "te hagas pasar por otra persona ni crees cuentas para otras personas sin su consentimiento.",
            ],
            "Podemos suspender o cerrar una cuenta que incumpla estas reglas.",
          ],
        },
        {
          heading: "Contenido y propiedad intelectual",
          body: [
            "Los textos, el diseño, los resultados del modelo y el software del Servicio son nuestros o de nuestros licenciantes. Puedes compartir enlaces y citar pronósticos concretos mencionando a EndzoneIQ. Los datos de terceros (como nflverse y Open-Meteo) siguen sujetos a su propia licencia. Los nombres de los equipos pertenecen a sus titulares y solo se usan para identificar a los equipos.",
          ],
        },
        {
          heading: "Disponibilidad y cambios",
          body: [
            "Intentamos que el Servicio esté disponible y sea exacto, pero se ofrece «tal cual», sin garantías de ningún tipo en la medida en que lo permita la ley. Los datos pueden llegar tarde o ser erróneos, y las funciones pueden cambiar o desaparecer. Podemos actualizar estas condiciones; si un cambio es importante lo anunciaremos en el sitio o por correo, y seguir usando el Servicio supone aceptar las nuevas condiciones.",
          ],
        },
        {
          heading: "Responsabilidad",
          body: [
            "En la medida en que lo permita la ley, no somos responsables de las pérdidas derivadas de decisiones que tomes basándote en el Servicio, incluidas las pérdidas en apuestas, ni de pérdidas indirectas. Nuestra responsabilidad total contigo se limita a lo que nos hayas pagado en los 12 meses anteriores a la reclamación. Nada en estas condiciones limita una responsabilidad que la ley no permita limitar.",
          ],
        },
        {
          heading: "Dejar de usar el Servicio",
          body: [
            "Puedes dejar de usar el Servicio y eliminar tu cuenta en cualquier momento desde tu [página de cuenta](/account). Eliminarla pone fin al acceso de una suscripción y borra los datos de tu cuenta, como se describe en la [política de privacidad](/privacy).",
          ],
        },
        {
          heading: "Ley aplicable y conflictos",
          body: [
            "Estas condiciones se rigen por {law}. Si eres consumidor, conservas la protección de las leyes imperativas de tu país de residencia y puedes acudir a sus tribunales. Escríbenos primero: la mayoría de los problemas se resuelven por correo.",
          ],
        },
      ],
    },

    privacy: {
      title: "Política de privacidad",
      description:
        "Qué datos personales recoge EndzoneIQ, para qué, quién los trata y cuáles son tus derechos.",
      sections: [
        {
          heading: "Quién es el responsable",
          body: [
            "El responsable del tratamiento es {operator}, {address}. Para cualquier pregunta o solicitud sobre privacidad, escribe a [{email}](mailto:{email}).",
            "Recogemos lo mínimo posible. Puedes ver todos los pronósticos y el historial completo sin cuenta.",
          ],
        },
        {
          heading: "Qué recogemos",
          body: [
            [
              "**Cuenta:** tu correo electrónico, un hash de tu contraseña (nunca la contraseña) o tu inicio de sesión con Google, y tu nombre si Google lo facilita.",
              "**Sesiones:** un token de sesión, más la dirección IP y el tipo de navegador de cada sesión, para mantenerte conectado y proteger las cuentas.",
              "**Preferencias:** idioma, equipo favorito, equipos seguidos y ajustes de alertas.",
              "**Asistente:** las preguntas que haces y las respuestas dadas, y cuántos tokens usó cada respuesta.",
              "**Notificaciones push:** si las activas, la dirección push que nos da tu navegador.",
              "**Facturación (cuando Pro esté disponible):** tu plan, el estado de la suscripción y la referencia de cliente del proveedor de pagos. Los datos de la tarjeta los gestiona el proveedor y nunca nos llegan.",
              "**Analítica, solo si la aceptas:** las páginas vistas y algunas acciones (como hacer una pregunta al asistente), vinculadas a un identificador aleatorio guardado en tu navegador. Nunca tu correo ni tu nombre.",
              "**Informes de errores:** cuando algo falla, datos técnicos como la dirección de la página, el tipo de navegador y el mensaje de error.",
              "**Registros del servidor:** nuestro proveedor de alojamiento registra la dirección IP y la página solicitada en cada visita, por seguridad y para resolver problemas.",
            ],
          ],
        },
        {
          heading: "Para qué los usamos (y con qué base legal)",
          body: [
            [
              "Prestar el Servicio que pediste: tu cuenta, el asistente, las alertas y Pro (ejecución del contrato).",
              "Mantener el Servicio seguro y en funcionamiento: sesiones, límites de uso, informes de errores y registros (nuestro interés legítimo).",
              "Saber qué páginas son útiles, mediante la analítica (tu consentimiento, que puedes retirar cuando quieras).",
              "Enviar el correo semanal o las alertas de cambio de pronóstico, solo si los activaste (tu consentimiento).",
              "Conservar los registros de facturación que exige la ley (obligación legal).",
            ],
            "No vendemos tus datos, no mostramos publicidad y no usamos tus datos para entrenar modelos de IA.",
          ],
        },
        {
          heading: "Quién los trata por nosotros",
          body: [
            "Usamos pocos proveedores, cada uno solo para su tarea:",
            [
              "**Hostinger** (alojamiento y base de datos);",
              "**Resend** (envío de correos);",
              "**Google** (solo si eliges entrar con Google);",
              "**Anthropic** (la IA del asistente: tu pregunta y los datos necesarios para responderla se envían a la API de Anthropic para generar la respuesta);",
              "**PostHog**, región UE (analítica, solo con tu consentimiento);",
              "**Sentry** (seguimiento de errores);",
              "**el servicio push de tu navegador**, como Google, Mozilla o Apple (solo si activas las notificaciones push);",
              "**nuestro proveedor de pagos** (solo para las suscripciones Pro, cuando estén disponibles).",
            ],
            "Algunos de estos proveedores están fuera del Espacio Económico Europeo, sobre todo en Estados Unidos. En ese caso, la transferencia está protegida por garantías como las cláusulas contractuales tipo de la Comisión Europea o una decisión de adecuación.",
          ],
        },
        {
          heading: "Cuánto tiempo los conservamos",
          body: [
            [
              "Datos de la cuenta, preferencias e historial del asistente: hasta que elimines tu cuenta.",
              "Sesiones: hasta 30 días, se borran al caducar. Enlaces de acceso y de restablecimiento: hasta que caducan (24 horas como máximo).",
              "Notificaciones enviadas: 30 días.",
              "Analítica: hasta 12 meses.",
              "Informes de errores: hasta 90 días.",
              "Registros de facturación: el tiempo que exija la ley fiscal.",
            ],
          ],
        },
        {
          heading: "Tus derechos",
          body: [
            "Puedes acceder a tus datos, corregirlos, exportarlos o eliminarlos, oponerte a algunos usos o limitarlos, y retirar tu consentimiento en cualquier momento.",
            [
              "**Exportar:** descarga todo lo que tenemos sobre tu cuenta desde tu [página de cuenta](/account).",
              "**Eliminar:** elimina tu cuenta desde la misma página. Se borran al instante tu cuenta, tus preferencias, el historial del asistente y tus direcciones push; antes se cancela cualquier suscripción.",
              "**Cookies y analítica:** cambia tu elección con «Configuración de cookies» al pie de cada página.",
            ],
            "Para cualquier otra cosa, escribe a [{email}](mailto:{email}); respondemos en el plazo de un mes. También puedes reclamar ante la autoridad de protección de datos de tu país (en España, la AEPD).",
          ],
        },
        {
          heading: "Menores",
          body: [
            "El Servicio está pensado para adultos. Las cuentas son para mayores de 18 años y no recogemos a sabiendas datos de menores.",
          ],
        },
        {
          heading: "Seguridad",
          body: [
            "Las conexiones están cifradas (HTTPS), las contraseñas se guardan con hash, la base de datos no es accesible desde internet y el acceso a los sistemas de producción está limitado. Ningún sistema es perfectamente seguro; si una brecha te afecta, te lo comunicaremos como exige la ley.",
          ],
        },
        {
          heading: "Cambios",
          body: [
            "Actualizaremos esta página cuando cambien nuestras prácticas, con la fecha arriba. Los cambios importantes se anunciarán en el sitio o por correo.",
          ],
        },
      ],
    },

    cookies: {
      title: "Política de cookies",
      description:
        "Las cookies y el almacenamiento del navegador que usa EndzoneIQ, y cómo cambiar tu elección.",
      sections: [
        {
          heading: "Nuestro enfoque",
          body: [
            "EndzoneIQ solo usa lo que necesita para funcionar, más una analítica opcional que queda desactivada hasta que la aceptes. Sin cookies publicitarias ni rastreadores de terceros. Puedes cambiar tu elección cuando quieras con «Configuración de cookies» al pie de cada página.",
          ],
        },
        {
          heading: "Estrictamente necesarias (siempre activas)",
          body: [
            [
              "**better-auth.session_token** (cookie, 30 días): te mantiene conectado. Solo se crea al iniciar sesión. Entrar con Google también crea una cookie de corta duración que protege el inicio de sesión contra falsificaciones.",
              "**NEXT_LOCALE** (cookie, 1 año): recuerda el idioma que elegiste.",
              "**theme** (almacenamiento del navegador): recuerda el modo oscuro o claro.",
              "**ez-consent** (almacenamiento del navegador): recuerda tu elección sobre las cookies.",
            ],
            "No necesitan consentimiento porque el sitio no puede funcionar bien sin ellas.",
          ],
        },
        {
          heading: "Analítica (solo con tu consentimiento)",
          body: [
            [
              "**ez-aid** (almacenamiento del navegador, hasta que lo borres o rechaces la analítica): un identificador aleatorio para que PostHog (región UE) cuente las visitas y vea qué páginas son útiles. Nunca se vincula a tu correo ni a tu nombre.",
            ],
            "Si la rechazas o retiras tu consentimiento, no se envía ninguna analítica y el identificador se borra.",
          ],
        },
        {
          heading: "Notificaciones push",
          body: [
            "Si activas las notificaciones push, tu navegador registra un service worker y nos da una dirección push. Puedes desactivarlas desde tu [página de cuenta](/account) o en los ajustes del navegador.",
          ],
        },
        {
          heading: "Gestionar las cookies en tu navegador",
          body: [
            "También puedes bloquear o borrar las cookies y los datos del sitio en los ajustes de tu navegador. Si bloqueas las necesarias, se cerrará tu sesión y se restablecerán tu idioma y tu tema.",
            "Más sobre cómo usamos los datos: [política de privacidad](/privacy).",
          ],
        },
      ],
    },

    "responsible-gaming": {
      title: "Juego responsable",
      description:
        "EndzoneIQ no es asesoramiento de apuestas. Si apuestas, que siga siendo un juego, y sabe dónde pedir ayuda.",
      sections: [
        {
          heading: "Nuestra postura",
          body: [
            "EndzoneIQ está hecho para aficionados que quieren entender los partidos. **No es asesoramiento de apuestas**, y ningún pronóstico es seguro: incluso los «Fuerte» fallan con regularidad. El modelo no tiene ninguna ventaja demostrada sobre los mercados de apuestas.",
            "Las apuestas son solo para adultos (18 o 21 años según dónde vivas) y solo donde son legales.",
          ],
        },
        {
          heading: "Si apuestas, que siga siendo un juego",
          body: [
            [
              "Fija un presupuesto que puedas permitirte perder y respétalo.",
              "No intentes nunca recuperar lo perdido, ni apuestes para ganar dinero o pagar facturas.",
              "No apuestes si estás alterado, estresado o has bebido.",
              "Haz pausas y guarda tiempo para otras cosas que te gusten.",
              "Usa los límites y la autoexclusión que ofrece tu operador.",
            ],
          ],
        },
        {
          heading: "Señales de alerta",
          body: [
            "Apostar más de lo previsto, pedir dinero para apostar, ocultarlo a tus allegados o sentir ansiedad cuando no puedes apostar son señales de que quizá sea momento de parar y hablar con alguien.",
          ],
        },
        {
          heading: "Dónde pedir ayuda",
          body: [
            "Ayuda gratuita y confidencial:",
            [
              "**España:** [jugarbien.es](https://www.jugarbien.es), el portal de juego responsable del Gobierno",
              "**Estados Unidos:** National Problem Gambling Helpline, 1-800-GAMBLER, [ncpgambling.org](https://www.ncpgambling.org)",
              "**Canadá:** [ConnexOntario](https://www.connexontario.ca), 1-866-531-2600, o la línea de ayuda de tu provincia",
              "**Reino Unido:** National Gambling Helpline, 0808 8020 133, [gamcare.org.uk](https://www.gamcare.org.uk)",
              "**Francia:** Joueurs Info Service, 09 74 75 13 13, [joueurs-info-service.fr](https://www.joueurs-info-service.fr)",
              "**En cualquier lugar:** [Jugadores Anónimos / Gamblers Anonymous](https://www.gamblersanonymous.org)",
            ],
          ],
        },
      ],
    },
  },
};

export default es;
