from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import Expense, StaffRosterProfile
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings
from test_staff_roster import _setup


def test_weekly_payroll_records_outflows_and_replays(tmp_path):
    url, engine, factory, branch, other, desk_token, _branch_admin = _setup(tmp_path)
    try:
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            token = complete_device_login(client, delivery, 'owner@example.invalid', 'synthetic-admin-password').json()['access_token']
            admin = {'Authorization': f'Bearer {token}'}
            desk = {'Authorization': f'Bearer {desk_token}'}
            profile = client.post(f'/api/v1/staff-roster/branches/{branch}', headers=admin,
                                  json={'full_name': 'Emigdio', 'position': 'Staff'}).json()['id']
            assert client.patch(f'/api/v1/staff-roster/{profile}', headers=admin,
                                json={'monthly_salary_minor': 1400000}).status_code == 200
            week = '2026-10-26'
            advance = {'branch_id': str(branch), 'staff_profile_id': profile, 'week_start': week, 'amount_minor': 50000}
            headers = {**admin, 'Idempotency-Key': 'advance-1'}
            result = client.post('/api/v1/admin/payroll/advances', headers=headers, json=advance)
            assert result.status_code == 201, result.text
            assert client.post('/api/v1/admin/payroll/advances', headers=headers, json=advance).json() == result.json()
            assert client.post('/api/v1/admin/payroll/advances', headers=headers, json={**advance, 'amount_minor': 1}).status_code == 409
            payment = {'branch_id': str(branch), 'staff_profile_id': profile, 'week_start': week, 'payment_method': 'cash'}
            rows = client.get(f'/api/v1/admin/payroll/weeks/{week}?branch_id={branch}', headers=admin).json()['items']
            assert (rows[0]['base_minor'], rows[0]['advances_minor'], rows[0]['net_minor']) == (350000, 50000, 300000)
            assert client.patch(f'/api/v1/staff-roster/{profile}', headers=admin,
                                json={'monthly_salary_minor': 100000}).status_code == 409
            pay_headers = {**admin, 'Idempotency-Key': 'payment-1'}
            paid = client.post('/api/v1/admin/payroll/payments', headers=pay_headers, json=payment)
            assert paid.status_code == 201, paid.text
            assert client.post('/api/v1/admin/payroll/payments', headers=pay_headers, json=payment).json() == paid.json()
            assert client.post('/api/v1/admin/payroll/payments', headers={**admin, 'Idempotency-Key': 'payment-2'}, json=payment).status_code == 409
            assert client.post('/api/v1/admin/payroll/advances', headers={**admin, 'Idempotency-Key': 'advance-2'}, json=advance).status_code == 409
            assert client.patch(f'/api/v1/staff-roster/{profile}', headers=admin,
                                json={'monthly_salary_minor': 2000000}).status_code == 200
            rows = client.get(f'/api/v1/admin/payroll/weeks/{week}?branch_id={branch}', headers=admin).json()['items']
            assert (rows[0]['base_minor'], rows[0]['net_minor']) == (350000, 300000)
            assert client.get(f'/api/v1/admin/payroll/weeks/2026-10-27?branch_id={branch}', headers=admin).status_code == 422
            assert client.get(f'/api/v1/admin/payroll/weeks/{week}?branch_id={other}', headers=desk).status_code == 403
            with factory() as session:
                expenses = session.scalars(select(Expense).where(Expense.branch_id == branch)).all()
                assert [(e.concept, e.amount_minor, e.shift_id) for e in expenses] == [
                    ('Adelanto de nómina', 50000, None), ('Nómina semanal', 300000, None)]

            next_week = '2026-11-02'
            next_advance = {**advance, 'week_start': next_week, 'amount_minor': 500001}
            assert client.post('/api/v1/admin/payroll/advances', headers={**admin, 'Idempotency-Key': 'excess'}, json=next_advance).status_code == 422
            next_advance['amount_minor'] = 500000
            assert client.post('/api/v1/admin/payroll/advances', headers={**admin, 'Idempotency-Key': 'full'}, json=next_advance).status_code == 201
            zero = client.post('/api/v1/admin/payroll/payments', headers={**admin, 'Idempotency-Key': 'zero'},
                               json={**payment, 'week_start': next_week})
            assert zero.status_code == 201 and zero.json()['net_minor'] == 0 and zero.json()['expense_id'] is None
            with factory() as session:
                assert len(session.scalars(select(Expense).where(Expense.branch_id == branch)).all()) == 3
    finally:
        engine.dispose()


def test_nine_profiles_total_and_rounding(tmp_path):
    url, engine, factory, branch, _other, desk_token, _branch_admin = _setup(tmp_path)
    try:
        with factory.begin() as session:
            session.add_all([StaffRosterProfile(branch_id=branch, full_name=f'Employee {n}', position='Staff',
                                               monthly_salary_minor=1400000 if n == 0 else 825000) for n in range(9)])
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            token = complete_device_login(client, delivery, 'owner@example.invalid', 'synthetic-admin-password').json()['access_token']
            admin = {'Authorization': f'Bearer {token}'}
            path = f'/api/v1/admin/payroll/weeks/2026-10-26?branch_id={branch}'
            result = client.get(path, headers=admin)
            assert result.status_code == 200
            assert len(result.json()['items']) == 9
            assert result.json()['base_minor'] == 2000000
            assert client.get(path, headers={'Authorization': f'Bearer {desk_token}'}).status_code == 403
            profile = result.json()['items'][0]['profile_id']
            assert client.patch(f'/api/v1/staff-roster/{profile}', headers=admin, json={'monthly_salary_minor': 102}).status_code == 200
            row = next(row for row in client.get(path, headers=admin).json()['items'] if row['profile_id'] == profile)
            assert (row['base_minor'], row['daily_minor']) == (26, 5)
    finally:
        engine.dispose()
