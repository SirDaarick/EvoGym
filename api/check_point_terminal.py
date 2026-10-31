#!/usr/bin/env python3
"""Pre-flight diagnostic CLI for Mercado Pago Point terminal integration.

Run this script to verify your Mercado Pago credentials, list connected
Point hardware devices, and optionally trigger a safe pre-flight test intent.

Usage:
    python check_point_terminal.py
    python check_point_terminal.py --test-intent
    python check_point_terminal.py --device-id <DEVICE_ID> --test-intent
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Ensure api directory is on sys.path
api_dir = Path(__file__).resolve().parent
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from app.settings import get_settings
from app.sales.point import get_point_client, MercadoPagoPointHttpClient, MockPointTerminalClient


def print_banner() -> None:
    print("=" * 65)
    print("  EvoGym · Diagnóstico Pre-Vuelo: Terminal Mercado Pago Point")
    print("=" * 65)


def run_diagnostic(test_intent: bool = False, device_id: str | None = None, wait_seconds: int = 5) -> int:
    print_banner()

    settings = get_settings()
    is_live = settings.mercado_pago_configured
    client = get_point_client(settings)

    if not is_live:
        print("\n[MODO ACTUAL: SIMULADOR / DEV]")
        print("  • La variable EVOGYM_MERCADO_PAGO_ACCESS_TOKEN no está configurada.")
        print("  • El backend está operando con el MockPointTerminalClient (emulador local).")
        print("\nPara conectar tu terminal física real cuando llegues al gimnasio:")
        print("  1. Abre tu archivo 'api/.env'")
        print("  2. Agrega tu Access Token de producción:")
        print("     EVOGYM_MERCADO_PAGO_ACCESS_TOKEN=APP_USR-xxxx-xxxx-xxxx")
        print("  3. Vuelve a ejecutar este script: python check_point_terminal.py")
        print("\n[EMULADOR LOCAL]")
        account = client.get_account_info()
        print(f"  ✓ Cuenta simulada: {account.get('nickname')} ({account.get('email')})")
        devices = client.list_devices()
        print(f"  ✓ Terminales detectadas: {len(devices)}")
        for d in devices:
            print(f"    - ID: {d.get('id')} | Modo: {d.get('operating_mode')} | Caja: {d.get('external_pos_id')}")

        if test_intent:
            print("\n[PRUEBA DE INTENCIÓN DE PAGO SIMULADA]")
            target_device = device_id or (devices[0]["id"] if devices else "MOCK-POINT-DEVICE-01")
            print(f"  Enviando cobro de $1.00 MXN a dispositivo {target_device}...")
            intent = client.create_payment_intent(target_device, 100, "evogym-preflight-mock")
            print(f"  ✓ Intención creada: {intent.id} | Estado: {intent.status}")
            status = client.get_payment_intent_status(target_device, intent.id)
            print(f"  ✓ Estado verificado: {status.status} (Auth: {status.authorization_code})")
        print("\n" + "=" * 65)
        print("RESULTADO: Emulador listo y verificado correctamente.")
        print("=" * 65)
        return 0

    print("\n[MODO: PRODUCCIÓN / MERCADO PAGO EN VIVO]")
    print("  • EVOGYM_MERCADO_PAGO_ACCESS_TOKEN detectado.")

    # 1. Test credentials and account
    print("\n1. Verificando credenciales de Mercado Pago...")
    try:
        account = client.get_account_info()
        user_id = account.get("id")
        nickname = account.get("nickname", "Desconocido")
        email = account.get("email", "Desconocido")
        country = account.get("site_id", "MX")
        print(f"  ✓ Autenticación exitosa.")
        print(f"    - Titular: {nickname} (ID: {user_id})")
        print(f"    - Correo: {email}")
        print(f"    - País: {country}")
    except Exception as exc:
        print(f"  ✗ ERROR de autenticación con Mercado Pago: {exc}")
        print("  Verifica que tu token comience con 'APP_USR-' y esté activo.")
        return 1

    # 2. List registered Point devices
    print("\n2. Consultando terminales Point vinculadas a tu cuenta...")
    try:
        devices = client.list_devices()
        if not devices:
            print("  ⚠ No se encontraron terminales Point vinculadas a esta cuenta de Mercado Pago.")
            print("    Asegúrate de haber encendido y vinculado la terminal Point a tu cuenta de Mercado Pago.")
            return 1

        print(f"  ✓ Se encontraron {len(devices)} terminal(es):")
        for i, dev in enumerate(devices, 1):
            dev_id = dev.get("id")
            op_mode = dev.get("operating_mode", "Desconocido")
            pos_id = dev.get("pos_id", "N/A")
            store_id = dev.get("store_id", "N/A")
            print(f"    [{i}] Dispositivo ID: {dev_id}")
            print(f"        Modo operativo: {op_mode} (debe ser PDV para integraciones)")
            print(f"        Tienda / Caja MP: {store_id} / {pos_id}")
    except Exception as exc:
        print(f"  ✗ ERROR al consultar terminales: {exc}")
        return 1

    # 3. Optional pre-flight payment intent test
    if test_intent:
        target_device = device_id or devices[0].get("id")
        print(f"\n3. Ejecutando prueba de comunicación con terminal '{target_device}'...")
        print("   Enviando intención de cobro de $1.00 MXN (se cancelará automáticamente)...")
        try:
            intent = client.create_payment_intent(target_device, 100, f"evogym-test-{int(time.time())}")
            print(f"   ✓ Intención enviada exitosamente a la terminal!")
            print(f"     ID de intento: {intent.id}")
            print(f"     Estado: {intent.status}")
            print(f"     ¡La terminal física debería encender su pantalla y mostrar $1.00 MXN!")

            if wait_seconds > 0:
                print(f"   Esperando {wait_seconds} segundos para visualización...")
                time.sleep(wait_seconds)

            print("   Cancelando la intención de prueba en la terminal para dejarla libre...")
            cancelled = client.cancel_payment_intent(target_device, intent.id)
            if cancelled:
                print("   ✓ Intención cancelada. La terminal regresó a estado de espera.")
            else:
                print("   ℹ La intención ya fue procesada o cancelada.")
        except Exception as exc:
            print(f"   ✗ ERROR en la comunicación con la terminal: {exc}")
            return 1
    else:
        print("\nPara enviar un cobro de prueba de $1.00 MXN a la terminal y cancelarlo automáticamente, ejecuta:")
        print("  python check_point_terminal.py --test-intent")

    print("\n" + "=" * 65)
    print("RESULTADO: Conexión con Mercado Pago Point 100% OPERATIVA.")
    print("=" * 65)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="EvoGym Mercado Pago Point Terminal Pre-Flight Diagnostic")
    parser.add_argument("--test-intent", action="store_true", help="Enviar una intención de prueba de $1.00 MXN a la terminal y cancelarla.")
    parser.add_argument("--device-id", type=str, default=None, help="ID específico del dispositivo Point a probar.")
    parser.add_argument("--wait", type=int, default=5, help="Segundos a mantener encendida la pantalla de la terminal antes de cancelar.")
    args = parser.parse_args()

    sys.exit(run_diagnostic(test_intent=args.test_intent, device_id=args.device_id, wait_seconds=args.wait))


if __name__ == "__main__":
    main()
