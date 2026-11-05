"""Simulador interactivo de WhatsApp para EvoGym y Gimi AI.

Permite simular mensajes entrantes de socios o clientes anónimos
sin necesidad de contar con credenciales de Meta Cloud API ni webhooks activos.
"""
import argparse
import sys
from uuid import uuid4

# Ensure api directory is in sys.path
sys.path.insert(0, "api")
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import create_engine, select
from app.db.models import Member
from app.db.models.notifications import NotificationOutbox, WhatsappInboxMessage
from app.db.session import create_session_factory
from app.gimi import whatsapp
from app.settings import Settings


def main():
    parser = argparse.ArgumentParser(description="Simulador de WhatsApp para EvoGym")
    parser.add_argument("--phone", "-p", help="Teléfono E.164 del remitente (ej. +525500005606)")
    parser.add_argument("--message", "-m", help="Mensaje de WhatsApp a enviar")
    args = parser.parse_args()

    settings = Settings()
    engine = create_engine(settings.database_url.get_secret_value())
    factory = create_session_factory(engine)

    phone = args.phone
    message_text = args.message

    with factory() as session:
        if not phone:
            print("=" * 65)
            print("🏋️  EVOGYM · SIMULADOR DE MENSAJES DE WHATSAPP (GIMI AI)")
            print("=" * 65)
            print("Socios de muestra encontrados en el sistema:")
            sample_members = session.scalars(select(Member).where(Member.phone.is_not(None)).limit(4)).all()
            for idx, m in enumerate(sample_members, 1):
                print(f"  [{idx}] {m.full_name} ({m.member_number}) -> {m.phone}")
            print("  [5] Remitente no registrado / Prospecto (+525599998888)")
            print("-" * 65)
            
            choice = input("Selecciona un número [1-5] o escribe un teléfono E.164: ").strip()
            if choice in ("1", "2", "3", "4") and int(choice) <= len(sample_members):
                phone = sample_members[int(choice) - 1].phone
            elif choice == "5":
                phone = "+525599998888"
            elif choice.startswith("+") or choice.isdigit():
                phone = choice
            else:
                phone = sample_members[0].phone if sample_members else "+525500005606"

        if not message_text:
            print("\nConsultas sugeridas:")
            print("  - ¿Cuánto debo de mi mensualidad?")
            print("  - ¿Cuándo vence mi membresía?")
            print("  - ¿Cuál es el casillero que tengo rentado?")
            print("  - ¿Cuáles son los horarios y precios del gimnasio?")
            print("  - ¿Puedo entrar a entrenar sin toalla?")
            message_text = input("\nEscribe el mensaje de WhatsApp a simular: ").strip()
            if not message_text:
                message_text = "¿Cuándo vence mi membresía?"

    clean_phone = whatsapp.normalize_e164(phone)
    if not clean_phone:
        print(f"❌ Error: El teléfono '{phone}' no es un formato E.164 válido.")
        sys.exit(1)

    sim_id = f"wamid.sim_{uuid4().hex[:12]}"
    raw_phone_digits = clean_phone.replace("+", "")

    message_payload = {
        "id": sim_id,
        "from": raw_phone_digits,
        "type": "text",
        "text": {"body": message_text},
    }

    print("\n" + "=" * 65)
    print("🚀  PROCESANDO MENSAJE ENTRANTE EN EL PIPELINE DE WHATSAPP...")
    print("=" * 65)
    print(f"📱 Remitente:    {clean_phone}")
    print(f"💬 Mensaje:      \"{message_text}\"")
    print(f"🆔 ID Mensaje:   {sim_id}")

    # Process through WhatsApp pipeline with GimiOrchestrator
    whatsapp._process(factory, message_payload, settings=settings)

    # Inspect the results in PostgreSQL
    with factory() as session:
        inbox = session.scalar(
            select(WhatsappInboxMessage).where(WhatsappInboxMessage.provider_message_id == sim_id)
        )
        outbox = session.scalar(
            select(NotificationOutbox).where(NotificationOutbox.idempotency_key == f"wa-reply:{sim_id}")
        )
        member = session.get(Member, inbox.member_id) if inbox and inbox.member_id else None

    print("\n" + "─" * 65)
    print("📊  RESULTADO DE LA EJECUCIÓN (JEV + GIMI ORCHESTRATOR)")
    print("─" * 65)
    print(f"👤 Socio identificado:  {member.full_name + ' (#' + member.member_number + ')' if member else 'No identificado / Prospecto'}")
    print(f"🎯 Clasificación (Jev): {inbox.tool if inbox else 'N/A'}")
    print(f"📌 Resultado operativo:  {inbox.outcome if inbox else 'N/A'}")
    print("\n🤖 RESPUESTA ENVIADA A WHATSAPP:")
    print("┌" + "─" * 63 + "┐")
    if outbox:
        for line in outbox.body.split("\n"):
            print(f"│  {line:<60} │")
    else:
        print("│  [Sin respuesta en outbox]                                    │")
    print("└" + "─" * 63 + "┘")
    print(f"\n📦 Estado en cola Outbox: {outbox.status if outbox else 'N/A'} (ID: {outbox.id if outbox else 'N/A'})")
    print("=" * 65 + "\n")


if __name__ == "__main__":
    main()
