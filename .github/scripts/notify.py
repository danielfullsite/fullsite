"""
Aviso que NUNCA puede tumbar un job.

Motivo concreto: el 2026-08-26 el Smoke Test post-deploy se pintó de ROJO con las
seis comprobaciones en OK. La corrida tenía sólo advertencias —iba a terminar
bien— y lo que falló fue el `requests.post` a api.telegram.org, con `ReadTimeout`
a los 10 s. Un aviso que no se pudo mandar reportó un despliegue sano como roto.

Ese patrón estaba en 17 llamadas sin `try/except` repartidas por los agentes.
Cualquiera de ellas podía convertir un hipo de red en un job fallido.

Dos reglas:

  1. El texto SIEMPRE se imprime al log del job, se haya podido enviar o no. El
     log es la fuente que sí sobrevive; Telegram es el extra.
  2. Ningún fallo de envío se propaga. Se anota en stderr y se sigue.

Nota: Daniel dejó de usar Telegram (2026-08-26). Los avisos siguen saliendo si los
secretos están puestos, pero ya no son el canal principal y por eso nunca deben
decidir si un job pasa o falla. Si mañana se retiran los secretos, esto degrada
solo: imprime y devuelve False.
"""

import os
import sys

import requests

TG_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TG_CHAT = os.environ.get("TELEGRAM_CHAT_ID_DANIEL") or os.environ.get("TELEGRAM_CHAT_ID", "")

# Telegram corta los mensajes largos; se parten antes de enviar.
LIMITE = 4000


def notificar(texto, chat_id=None, timeout=10):
    """Manda el aviso y SIEMPRE regresa. Nunca lanza.

    Devuelve True sólo si se enviaron todos los pedazos.
    """
    print(texto)

    chat = chat_id or TG_CHAT
    if not TG_TOKEN or not chat:
        return False

    pedazos = [texto[i:i + LIMITE] for i in range(0, len(texto), LIMITE)] or [""]
    todo_ok = True
    for pedazo in pedazos:
        try:
            requests.post(
                "https://api.telegram.org/bot%s/sendMessage" % TG_TOKEN,
                json={"chat_id": chat, "text": pedazo},
                timeout=timeout,
            )
        except Exception as e:  # red, timeout, DNS, lo que sea
            print("[notify] no se pudo enviar, se ignora: %s" % e, file=sys.stderr)
            todo_ok = False
    return todo_ok
