"""Expanded seeder: Generates full October + November sales and realistic member check-in visits.

Provides full attendance curves (peak/valley hours, live occupancy) and complete
daily cash register shifts, inventory movements, and retail sales from Oct 1 to Nov 5.
"""
import argparse
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
    MemberCheckIn,
    MembershipPeriod,
    Order,
    OrderItem,
    Payment,
    PlanVersion,
    Product,
    RentalAsset,
    Shift,
    StaffUser,
    StockInitialization,
    StockMovement,
)
from app.db.models.member_check_ins import MemberCheckInVisit
from app.settings import get_settings

PRODUCTS_CATALOG = [
    # Bebidas
    {"code": "agua", "name": "Agua 1.5L", "category": "Bebidas", "price_minor": 1500, "cost_minor": 700, "unit": "piece", "stock": 400},
    {"code": "gatorade", "name": "Gatorade", "category": "Bebidas", "price_minor": 2500, "cost_minor": 1300, "unit": "piece", "stock": 250},
    {"code": "raze", "name": "Raze Energy", "category": "Bebidas", "price_minor": 4000, "cost_minor": 2200, "unit": "piece", "stock": 150},
    {"code": "monster", "name": "Monster Energy", "category": "Bebidas", "price_minor": 4000, "cost_minor": 2200, "unit": "piece", "stock": 200},
    {"code": "volt", "name": "Volt", "category": "Bebidas", "price_minor": 2500, "cost_minor": 1200, "unit": "piece", "stock": 200},
    {"code": "pepi", "name": "Pepi", "category": "Bebidas", "price_minor": 1500, "cost_minor": 800, "unit": "piece", "stock": 180},
    {"code": "refresco", "name": "Refresco", "category": "Bebidas", "price_minor": 1000, "cost_minor": 500, "unit": "piece", "stock": 220},
    # Snacks
    {"code": "barras-deli", "name": "Barras Deli", "category": "Snacks", "price_minor": 2500, "cost_minor": 1200, "unit": "piece", "stock": 200},
    {"code": "galletas", "name": "Galletas de Avena", "category": "Snacks", "price_minor": 2000, "cost_minor": 900, "unit": "piece", "stock": 150},
    # Accesorios
    {"code": "p-bucal", "name": "Protector Bucal", "category": "Accesorios", "price_minor": 13000, "cost_minor": 6000, "unit": "piece", "stock": 60},
    {"code": "vendas", "name": "Vendas Box", "category": "Accesorios", "price_minor": 13000, "cost_minor": 6000, "unit": "piece", "stock": 80},
    {"code": "toalla", "name": "Toalla Facial", "category": "Accesorios", "price_minor": 2500, "cost_minor": 1000, "unit": "piece", "stock": 100},
    # Suplementos
    {"code": "scoop-psychotic", "name": "Scoop Psychotic", "category": "Suplementos", "price_minor": 3000, "cost_minor": 1200, "unit": "piece", "stock": 250},
    {"code": "scoop-c4", "name": "Scoop C4", "category": "Suplementos", "price_minor": 3000, "cost_minor": 1200, "unit": "piece", "stock": 250},
    {"code": "scoop-oxi-bum", "name": "Scoop Oxi Bum", "category": "Suplementos", "price_minor": 3000, "cost_minor": 1200, "unit": "piece", "stock": 200},
    {"code": "scoop-proteina", "name": "Scoop Proteína", "category": "Suplementos", "price_minor": 3500, "cost_minor": 1500, "unit": "piece", "stock": 300},
    {"code": "scoop-creatina", "name": "Scoop Creatina", "category": "Suplementos", "price_minor": 1500, "cost_minor": 600, "unit": "piece", "stock": 350},
    {"code": "scoop-aminos", "name": "Scoop Aminos", "category": "Suplementos", "price_minor": 2500, "cost_minor": 1000, "unit": "piece", "stock": 220},
    {"code": "quemador", "name": "Quemador", "category": "Suplementos", "price_minor": 2000, "cost_minor": 800, "unit": "piece", "stock": 150},
    {"code": "lipodrine", "name": "Lipodrine", "category": "Suplementos", "price_minor": 1500, "cost_minor": 600, "unit": "piece", "stock": 150},
    {"code": "cafeina", "name": "Cafeína", "category": "Suplementos", "price_minor": 1000, "cost_minor": 400, "unit": "piece", "stock": 200},
    {"code": "cafe-mutan", "name": "Café Mutant", "category": "Suplementos", "price_minor": 1000, "cost_minor": 400, "unit": "piece", "stock": 180},
]


def sha256_hex(val: str) -> str:
    return hashlib.sha256(val.encode("utf-8")).hexdigest()


def seed_products_sales_and_attendance(session: Session, commit: bool = True) -> dict[str, int]:
    now_utc = datetime.now(timezone.utc)
    random.seed(12345)  # Deterministic seed

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

    # 2. Update Locker price to $100.00 MXN
    session.execute(
        update(RentalAsset).where(RentalAsset.kind == "locker").values(price_minor=10000)
    )

    # 3. Seed / Update Products
    products_map: dict[str, Product] = {}
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
                created_at=now_utc - timedelta(days=40),
                updated_at=now_utc - timedelta(days=40),
            )
            session.add(prod)
            session.flush()

            init_stock = StockInitialization(
                branch_id=branch.id,
                product_id=prod.id,
                quantity=item["stock"],
                initialized_by=staff_user.id,
                initialized_at=now_utc - timedelta(days=40),
            )
            session.add(init_stock)
        else:
            prod.price_minor = item["price_minor"]
            prod.cost_minor = item["cost_minor"]
            prod.category = item["category"]

            # Ensure stock initialization exists
            existing_init = session.scalar(select(StockInitialization).where(StockInitialization.product_id == prod.id))
            if not existing_init:
                init_stock = StockInitialization(
                    branch_id=branch.id,
                    product_id=prod.id,
                    quantity=item["stock"],
                    initialized_by=staff_user.id,
                    initialized_at=now_utc - timedelta(days=40),
                )
                session.add(init_stock)
            else:
                existing_init.quantity = item["stock"]

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
            created_at=now_utc - timedelta(days=40),
            updated_at=now_utc - timedelta(days=40),
        )
        session.add(register)
        session.flush()

    # 5. Seed MembershipPeriod for Active Members
    active_members = session.scalars(select(Member).where(Member.status == "active")).all()
    plan_ver = session.scalar(select(PlanVersion).order_by(PlanVersion.id))
    if not plan_ver:
        raise RuntimeError("No plan versions found to link active memberships.")

    existing_period_members = set(
        session.scalars(select(MembershipPeriod.member_id)).all()
    )

    created_periods: list[MembershipPeriod] = []
    # Create base shift for membership activation order
    init_shift = session.scalar(select(Shift).where(Shift.cash_register_id == register.id))
    if not init_shift:
        init_shift = Shift(
            cash_register_id=register.id,
            opened_by=staff_user.id,
            closed_by=staff_user.id,
            opened_at=now_utc - timedelta(days=40),
            closed_at=now_utc - timedelta(days=40),
            status="closed",
            opening_cash_minor=0,
            expected_cash_at_close_minor=0,
            counted_cash_minor=0,
            difference_minor=0,
            closing_notes="Shift inicial de membresías migradas",
            created_at=now_utc - timedelta(days=40),
            updated_at=now_utc - timedelta(days=40),
        )
        session.add(init_shift)
        session.flush()

    for m in active_members:
        if m.id in existing_period_members:
            continue

        ord_id = uuid4()
        m_order = Order(
            id=ord_id,
            branch_id=branch.id,
            register_id=register.id,
            shift_id=init_shift.id,
            is_overtime=False,
            cash_included_in_opening=False,
            member_id=m.id,
            order_kind="membership",
            seller_id=staff_user.id,
            idempotency_key=f"mem_ord_{m.member_number}_{ord_id.hex[:6]}",
            request_fingerprint=sha256_hex(f"mem_ord_{m.id}"),
            currency="MXN",
            total_minor=plan_ver.price_minor,
            origin="online",
            created_at=now_utc - timedelta(days=35),
        )
        session.add(m_order)
        session.flush()

        m_item = OrderItem(
            order_id=m_order.id,
            plan_version_id=plan_ver.id,
            line_number=1,
            item_kind="membership",
            description_snapshot=plan_ver.name,
            duration_value=plan_ver.duration_value or 1,
            duration_unit=plan_ver.duration_unit or "month",
            entitlement_mode="period",
            quantity=1,
            unit_amount_minor=plan_ver.price_minor,
            line_total_minor=plan_ver.price_minor,
        )
        session.add(m_item)
        session.flush()

        m_pay = Payment(
            order_id=m_order.id,
            register_id=register.id,
            shift_id=init_shift.id,
            method="cash",
            status="confirmed",
            amount_minor=plan_ver.price_minor,
            received_by=staff_user.id,
            received_at=now_utc - timedelta(days=35),
            idempotency_key=f"mem_pay_{m.member_number}_{ord_id.hex[:6]}",
            request_fingerprint=sha256_hex(f"mem_pay_{m.id}"),
        )
        session.add(m_pay)

        period = MembershipPeriod(
            member_id=m.id,
            order_item_id=m_item.id,
            plan_version_id=plan_ver.id,
            starts_on=date(2026, 10, 1),
            ends_on=date(2026, 11, 20),
            activated_by=staff_user.id,
            created_at=now_utc - timedelta(days=35),
        )
        session.add(period)
        created_periods.append(period)

    session.flush()

    # Query all active periods available for check-ins
    all_periods = session.scalars(select(MembershipPeriod)).all()
    period_by_member = {p.member_id: p for p in all_periods}

    # 6. Generate Sales & Check-ins for Oct 1 to Nov 5 (36 days)
    start_date = date(2026, 10, 1)
    end_date = date(2026, 11, 5)
    days_count = (end_date - start_date).days + 1

    all_products = list(products_map.values())
    member_ids = list(period_by_member.keys())

    total_orders = 0
    total_sales_minor = 0
    total_checkins = 0

    for day_offset in range(days_count):
        current_date = start_date + timedelta(days=day_offset)
        is_today = (current_date == end_date)
        weekday = current_date.weekday()  # 0=Mon, 6=Sun

        # A. Daily Cash Shift
        shift_open_dt = datetime.combine(current_date, time(6, 30), timezone.utc)
        shift_close_dt = datetime.combine(current_date, time(22, 0), timezone.utc) if not is_today else None

        existing_shift = session.scalar(
            select(Shift).where(
                Shift.cash_register_id == register.id,
                Shift.opened_at >= shift_open_dt - timedelta(hours=3),
                Shift.opened_at <= shift_open_dt + timedelta(hours=3),
            )
        )

        daily_shift = existing_shift
        if not daily_shift:
            daily_shift = Shift(
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
                closing_notes="Corte regular de caja" if not is_today else None,
                created_at=shift_open_dt,
                updated_at=shift_close_dt or shift_open_dt,
            )
            session.add(daily_shift)
            session.flush()

        # B. Product Sales Generation (10 to 18 sales per day for robust volume)
        sales_count = random.randint(10, 18) if not is_today else 15
        cash_accumulated = 0

        for s_idx in range(sales_count):
            hour = random.choices(
                [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
                weights=[8, 10, 9, 5, 4, 3, 4, 5, 6, 8, 12, 14, 10, 6, 3],
            )[0]
            minute = random.randint(0, 59)
            order_dt = datetime.combine(current_date, time(hour, minute), timezone.utc)

            item_count = random.choices([1, 2], weights=[0.7, 0.3])[0]
            chosen_prods = random.sample(all_products, item_count)

            order_total_minor = 0
            order_items_data = []
            for p_idx, prod in enumerate(chosen_prods, start=1):
                qty = 1 if prod.category in ("Accesorios", "Suplementos") else random.choices([1, 2], weights=[0.85, 0.15])[0]
                line_total = prod.price_minor * qty
                order_total_minor += line_total
                order_items_data.append((p_idx, prod, qty, line_total))

            buyer_id = random.choice(member_ids) if member_ids and random.random() < 0.70 else None
            method_choice = random.choices(["cash", "card", "transfer"], weights=[0.55, 0.30, 0.15])[0]

            order_id = uuid4()
            idem_key = f"ord_oct_{current_date.isoformat()}_{s_idx}_{order_id.hex[:6]}"
            req_fp = sha256_hex(f"{branch.id}\n{order_id}\n{order_total_minor}\n{order_dt.isoformat()}")

            order = Order(
                id=order_id,
                branch_id=branch.id,
                register_id=register.id,
                shift_id=daily_shift.id,
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

            for line_no, prod, qty, line_total in order_items_data:
                order_item = OrderItem(
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

                stock_mv = StockMovement(
                    order_item_id=order_item.id,
                    branch_id=branch.id,
                    product_id=prod.id,
                    kind="sale",
                    quantity=qty,
                    reason="Venta mostrador",
                    recorded_by=staff_user.id,
                    idempotency_key=f"sm_oct_{order_item.id.hex[:10]}",
                    recorded_at=order_dt,
                )
                session.add(stock_mv)

            payment = Payment(
                order_id=order.id,
                register_id=register.id,
                shift_id=daily_shift.id,
                method=method_choice,
                status="confirmed",
                amount_minor=order_total_minor,
                received_by=staff_user.id,
                received_at=order_dt,
                card_brand=random.choice(["visa", "mastercard"]) if method_choice == "card" else None,
                card_last_four="4242" if method_choice == "card" else None,
                authorization_code=f"AUTH{random.randint(100000, 999999)}" if method_choice == "card" else None,
                idempotency_key=f"pay_oct_{order.id.hex[:10]}",
                request_fingerprint=sha256_hex(f"{order.id}\n{order_total_minor}\n{method_choice}"),
            )
            session.add(payment)

            total_orders += 1
            total_sales_minor += order_total_minor
            if method_choice == "cash":
                cash_accumulated += order_total_minor

        if not is_today and daily_shift.counted_cash_minor is not None:
            daily_shift.expected_cash_at_close_minor = (daily_shift.expected_cash_at_close_minor or 100000) + cash_accumulated
            daily_shift.counted_cash_minor = (daily_shift.counted_cash_minor or 100000) + cash_accumulated

        # C. Member Attendance / Check-In Generation
        if weekday < 5:
            checkin_count = random.randint(45, 65) if not is_today else 24
        elif weekday == 5:
            checkin_count = random.randint(25, 40)
        else:
            checkin_count = random.randint(12, 22)

        selected_attendees = random.sample(member_ids, min(checkin_count, len(member_ids)))
        for mem_id in selected_attendees:
            period = period_by_member.get(mem_id)
            if not period:
                continue

            if is_today:
                checkin_dt = now_utc - timedelta(minutes=random.randint(5, 75))
            else:
                hour = random.choices(
                    [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
                    weights=[4, 14, 16, 10, 6, 4, 3, 3, 4, 6, 10, 16, 18, 14, 8, 3]
                )[0]
                minute = random.randint(0, 59)
                checkin_dt = datetime.combine(current_date, time(hour, minute), timezone.utc)

            visit = MemberCheckInVisit(
                id=uuid4(),
                member_id=mem_id,
                started_at=checkin_dt,
            )
            session.add(visit)
            session.flush()

            checkin = MemberCheckIn(
                id=uuid4(),
                visit_id=visit.id,
                member_id=mem_id,
                period_id=period.id,
                branch_id=branch.id,
                recorded_by=staff_user.id,
                idempotency_key=f"ci_oct_{current_date.isoformat()}_{mem_id.hex[:6]}_{visit.id.hex[:4]}",
                request_fingerprint=sha256_hex(f"{branch.id}\n{period.id}\n{mem_id}\n{checkin_dt.isoformat()}"),
                access_reason="membership_active",
                access_warnings=[],
                occurred_at=checkin_dt,
            )
            session.add(checkin)
            total_checkins += 1

    session.flush()

    if commit:
        session.commit()
    else:
        session.rollback()

    return {
        "periods_created": len(created_periods),
        "total_orders": total_orders,
        "total_sales_minor": total_sales_minor,
        "total_checkins": total_checkins,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", type=str, default=None)
    args = parser.parse_args()

    print("=" * 72)
    print("   SEEDING FULL OCTOBER + NOVEMBER RETAIL SALES AND ATTENDANCE    ")
    print("=" * 72)

    if args.database_url:
        engine = create_engine(args.database_url)
    else:
        settings = get_settings()
        engine = create_engine(settings.require_database_url())
    factory = sessionmaker(engine)

    with factory() as session:
        res = seed_products_sales_and_attendance(session, commit=True)

    print(f" Active Membership Periods Created: {res['periods_created']}")
    print(f" Total Retail Orders Generated:     {res['total_orders']}")
    print(f" Total Member Check-Ins Generated:  {res['total_checkins']}")
    print(f" Total Retail Revenue Generated:    ${res['total_sales_minor'] / 100:,.2f} MXN")
    print("=" * 72)
    print(" SUCCESS -> Full historical operational dataset committed!")


if __name__ == "__main__":
    main()
