"""Seed official product catalog and realistic simulated sales history.

Populates products from reception price sheet, registers daily shifts,
inventory stock movements, and customer retail transactions from Oct 16 to Nov 5.
"""
from datetime import date, datetime, time, timedelta, timezone
import hashlib
from pathlib import Path
import random
import sys
from uuid import UUID, uuid4

# Ensure api is in sys.path
api_dir = Path(__file__).resolve().parents[2]
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from sqlalchemy import create_engine, null, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.db.models import (
    Branch,
    CashRegister,
    Member,
    Order,
    OrderItem,
    Payment,
    Product,
    RentalAsset,
    Shift,
    StaffUser,
    StockInitialization,
    StockMovement,
)
from app.settings import get_settings

PRODUCTS_CATALOG = [
    # Bebidas
    {"code": "agua", "name": "Agua 1.5L", "category": "Bebidas", "price_minor": 1500, "cost_minor": 700, "unit": "piece", "stock": 150},
    {"code": "gatorade", "name": "Gatorade", "category": "Bebidas", "price_minor": 2500, "cost_minor": 1300, "unit": "piece", "stock": 100},
    {"code": "raze", "name": "Raze Energy", "category": "Bebidas", "price_minor": 4000, "cost_minor": 2200, "unit": "piece", "stock": 60},
    {"code": "monster", "name": "Monster Energy", "category": "Bebidas", "price_minor": 4000, "cost_minor": 2200, "unit": "piece", "stock": 80},
    {"code": "volt", "name": "Volt", "category": "Bebidas", "price_minor": 2500, "cost_minor": 1200, "unit": "piece", "stock": 80},
    {"code": "pepi", "name": "Pepi", "category": "Bebidas", "price_minor": 1500, "cost_minor": 800, "unit": "piece", "stock": 70},
    {"code": "refresco", "name": "Refresco", "category": "Bebidas", "price_minor": 1000, "cost_minor": 500, "unit": "piece", "stock": 90},
    # Snacks
    {"code": "barras-deli", "name": "Barras Deli", "category": "Snacks", "price_minor": 2500, "cost_minor": 1200, "unit": "piece", "stock": 80},
    # Accesorios
    {"code": "p-bucal", "name": "Protector Bucal", "category": "Accesorios", "price_minor": 13000, "cost_minor": 6000, "unit": "piece", "stock": 30},
    {"code": "vendas", "name": "Vendas Box", "category": "Accesorios", "price_minor": 13000, "cost_minor": 6000, "unit": "piece", "stock": 40},
    {"code": "toalla", "name": "Toalla Facial", "category": "Accesorios", "price_minor": 2500, "cost_minor": 1000, "unit": "piece", "stock": 50},
    # Suplementos
    {"code": "scoop-psychotic", "name": "Scoop Psychotic", "category": "Suplementos", "price_minor": 3000, "cost_minor": 1200, "unit": "piece", "stock": 100},
    {"code": "scoop-c4", "name": "Scoop C4", "category": "Suplementos", "price_minor": 3000, "cost_minor": 1200, "unit": "piece", "stock": 100},
    {"code": "scoop-oxi-bum", "name": "Scoop Oxi Bum", "category": "Suplementos", "price_minor": 3000, "cost_minor": 1200, "unit": "piece", "stock": 80},
    {"code": "scoop-proteina", "name": "Scoop Proteína", "category": "Suplementos", "price_minor": 3500, "cost_minor": 1500, "unit": "piece", "stock": 120},
    {"code": "scoop-creatina", "name": "Scoop Creatina", "category": "Suplementos", "price_minor": 1500, "cost_minor": 600, "unit": "piece", "stock": 150},
    {"code": "scoop-aminos", "name": "Scoop Aminos", "category": "Suplementos", "price_minor": 2500, "cost_minor": 1000, "unit": "piece", "stock": 90},
    {"code": "quemador", "name": "Quemador", "category": "Suplementos", "price_minor": 2000, "cost_minor": 800, "unit": "piece", "stock": 60},
    {"code": "lipodrine", "name": "Lipodrine", "category": "Suplementos", "price_minor": 1500, "cost_minor": 600, "unit": "piece", "stock": 60},
    {"code": "cafeina", "name": "Cafeína", "category": "Suplementos", "price_minor": 1000, "cost_minor": 400, "unit": "piece", "stock": 80},
    {"code": "cafe-mutan", "name": "Café Mutant", "category": "Suplementos", "price_minor": 1000, "cost_minor": 400, "unit": "piece", "stock": 70},
]


def sha256_hex(val: str) -> str:
    return hashlib.sha256(val.encode("utf-8")).hexdigest()


def seed_products_and_sales(session: Session, commit: bool = True) -> dict[str, int]:
    now_utc = datetime.now(timezone.utc)
    random.seed(42)  # Deterministic generation

    # 1. Resolve Branch and Staff
    branch = session.scalar(select(Branch).where(Branch.code == "central"))
    if not branch:
        branch = Branch(code="central", name="Sucursal Centro", timezone="America/Mexico_City", is_active=True)
        session.add(branch)
        session.flush()

    staff_user = session.scalar(select(StaffUser).where(StaffUser.login_identifier == "recepcion"))
    if not staff_user:
        staff_user = session.scalar(select(StaffUser).where(StaffUser.is_active == True))
    if not staff_user:
        staff_user = StaffUser(login_identifier="recepcion", is_active=True)
        session.add(staff_user)
        session.flush()

    # 2. Update Locker price to $100.00 MXN (10000 minor)
    session.execute(
        update(RentalAsset).where(RentalAsset.kind == "locker").values(price_minor=10000)
    )

    # 3. Seed / Update Products and Stock Initializations
    products_map: dict[str, Product] = {}
    products_created = 0

    for item in PRODUCTS_CATALOG:
        prod = session.scalar(select(Product).where(Product.code == item["code"]))
        if not prod:
            prod = Product(
                code=item["code"],
                name=item["name"],
                category=item["category"],
                price_minor=item["price_minor"],
                cost_minor=item["cost_minor"],
                unit=item["unit"],
                is_active=True,
                created_by=staff_user.id,
                created_at=now_utc - timedelta(days=25),
                updated_at=now_utc - timedelta(days=25),
            )
            session.add(prod)
            session.flush()
            products_created += 1

            # Initial stock
            init_stock = StockInitialization(
                branch_id=branch.id,
                product_id=prod.id,
                quantity=item["stock"],
                initialized_by=staff_user.id,
                initialized_at=now_utc - timedelta(days=25),
            )
            session.add(init_stock)
        else:
            prod.price_minor = item["price_minor"]
            prod.cost_minor = item["cost_minor"]
            prod.category = item["category"]

        products_map[item["code"]] = prod

    session.flush()

    # 4. Cash Register
    register = session.scalar(select(CashRegister).where(CashRegister.branch_id == branch.id, CashRegister.code == "caja-1"))
    if not register:
        register = CashRegister(
            branch_id=branch.id,
            code="caja-1",
            name="Caja Mostrador",
            status="active",
            created_at=now_utc - timedelta(days=25),
            updated_at=now_utc - timedelta(days=25),
        )
        session.add(register)
        session.flush()

    # 5. Get active members for customer assignments
    active_members = session.scalars(
        select(Member).where(Member.status == "active").limit(100)
    ).all()
    member_ids = [m.id for m in active_members] if active_members else []

    # 6. Generate Shifts and Sales from Oct 16 to Nov 5 (21 days)
    start_date = date(2026, 10, 16)
    end_date = date(2026, 11, 5)
    days_span = (end_date - start_date).days + 1

    total_orders = 0
    total_items = 0
    total_sales_minor = 0

    all_products = list(products_map.values())

    for day_offset in range(days_span):
        current_date = start_date + timedelta(days=day_offset)
        is_today = (current_date == end_date)

        # Shift setup: Morning Shift (07:00 to 15:00)
        shift_open_dt = datetime.combine(current_date, time(7, 0), timezone.utc)
        shift_close_dt = datetime.combine(current_date, time(15, 0), timezone.utc) if not is_today else None

        morning_shift = Shift(
            cash_register_id=register.id,
            opened_by=staff_user.id,
            closed_by=staff_user.id if not is_today else None,
            opened_at=shift_open_dt,
            closed_at=shift_close_dt,
            status="closed" if not is_today else "open",
            opening_cash_minor=100000,  # $1,000.00 MXN base
            expected_cash_at_close_minor=100000,
            counted_cash_minor=100000 if not is_today else None,
            difference_minor=0 if not is_today else None,
            closing_notes="Corte regular matutino sin diferencias" if not is_today else None,
            created_at=shift_open_dt,
            updated_at=shift_close_dt or shift_open_dt,
        )
        session.add(morning_shift)
        session.flush()

        # Sales count per day: 6 to 12 sales
        daily_sales_count = random.randint(7, 12) if not is_today else 8
        cash_accumulated = 0

        for s_idx in range(daily_sales_count):
            order_hour = random.randint(7, 14)
            order_minute = random.randint(0, 59)
            order_dt = datetime.combine(current_date, time(order_hour, order_minute), timezone.utc)

            # Pick 1 or 2 items
            item_count = random.choices([1, 2], weights=[0.75, 0.25])[0]
            chosen_products = random.sample(all_products, item_count)

            order_items_data = []
            order_total_minor = 0

            for p_idx, prod in enumerate(chosen_products, start=1):
                qty = 1 if prod.category in ("Accesorios", "Suplementos") else random.choices([1, 2], weights=[0.8, 0.2])[0]
                line_total = prod.price_minor * qty
                order_total_minor += line_total
                order_items_data.append((p_idx, prod, qty, line_total))

            # Customer: 70% member, 30% walk-in
            buyer_id = random.choice(member_ids) if member_ids and random.random() < 0.70 else None

            # Payment method: 60% cash, 25% card, 15% transfer
            method_choice = random.choices(["cash", "card", "transfer"], weights=[0.60, 0.25, 0.15])[0]
            payment_status = "confirmed"

            order_id = uuid4()
            idem_key = f"order_{current_date.isoformat()}_{s_idx}_{order_id.hex[:8]}"
            req_fp = sha256_hex(f"{branch.id}\n{order_id}\n{order_total_minor}\n{order_dt.isoformat()}")

            order = Order(
                id=order_id,
                branch_id=branch.id,
                register_id=register.id,
                shift_id=morning_shift.id,
                is_overtime=False,
                cash_included_in_opening=False,
                member_id=buyer_id,
                order_kind="product",
                seller_id=staff_user.id,
                idempotency_key=idem_key,
                request_fingerprint=req_fp,
                currency="MXN",
                total_minor=order_total_minor,
                origin="online",
                created_at=order_dt,
            )
            session.add(order)
            session.flush()

            # Add OrderItems and StockMovements
            for line_no, prod, qty, line_total in order_items_data:
                item_id = uuid4()
                order_item = OrderItem(
                    id=item_id,
                    order_id=order.id,
                    product_id=prod.id,
                    line_number=line_no,
                    item_kind="product",
                    description_snapshot=prod.name,
                    quantity=qty,
                    unit_amount_minor=prod.price_minor,
                    line_total_minor=line_total,
                    entitlement_mode=null(),
                    duration_value=None,
                    duration_unit=None,
                )
                session.add(order_item)
                session.flush()

                # Stock movement
                sm_key = f"sm_{order_item.id.hex[:12]}"
                stock_mv = StockMovement(
                    order_item_id=order_item.id,
                    branch_id=branch.id,
                    product_id=prod.id,
                    kind="sale",
                    quantity=qty,
                    reason="Venta mostrador",
                    recorded_by=staff_user.id,
                    idempotency_key=sm_key,
                    recorded_at=order_dt,
                )
                session.add(stock_mv)
                total_items += qty

            # Add Payment
            pay_key = f"pay_{order.id.hex[:12]}"
            pay_fp = sha256_hex(f"{order.id}\n{order_total_minor}\n{method_choice}")
            card_brand = random.choice(["visa", "mastercard"]) if method_choice == "card" else None
            card_last4 = "4242" if method_choice == "card" else None
            auth_code = f"AUTH{random.randint(100000, 999999)}" if method_choice == "card" else None

            payment = Payment(
                order_id=order.id,
                register_id=register.id,
                shift_id=morning_shift.id,
                method=method_choice,
                status=payment_status,
                amount_minor=order_total_minor,
                received_by=staff_user.id,
                received_at=order_dt,
                card_brand=card_brand,
                card_last_four=card_last4,
                authorization_code=auth_code,
                idempotency_key=pay_key,
                request_fingerprint=pay_fp,
            )
            session.add(payment)

            total_orders += 1
            total_sales_minor += order_total_minor
            if method_choice == "cash":
                cash_accumulated += order_total_minor

        # Update closed shift expected/counted cash
        if not is_today:
            morning_shift.expected_cash_at_close_minor = 100000 + cash_accumulated
            morning_shift.counted_cash_minor = 100000 + cash_accumulated
            morning_shift.difference_minor = 0

    session.flush()

    if commit:
        session.commit()
    else:
        session.rollback()

    return {
        "products_created": products_created,
        "total_orders": total_orders,
        "total_items": total_items,
        "total_sales_minor": total_sales_minor,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", type=str, default=None)
    args = parser.parse_args()

    print("=" * 70)
    print("      SEEDING PRODUCT CATALOG & HISTORICAL RETAIL SALES       ")
    print("=" * 70)

    if args.database_url:
        engine = create_engine(args.database_url)
    else:
        settings = get_settings()
        engine = create_engine(settings.require_database_url())
    factory = sessionmaker(engine)

    with factory() as session:
        res = seed_products_and_sales(session, commit=True)

    print(f" Products Created: {res['products_created']}")
    print(f" Orders Created:   {res['total_orders']}")
    print(f" Items Sold:       {res['total_items']}")
    print(f" Total Revenue:    ${res['total_sales_minor'] / 100:,.2f} MXN")
    print("=" * 70)
    print(" SUCCESS -> Database updated with products and realistic sales!")


if __name__ == "__main__":
    main()
