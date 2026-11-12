from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import Expense, StaffRosterProfile
from app.main import create_app
from test_admin_auth import FakeRecoveryDelivery, complete_device_login, configured_settings
from test_staff_roster import _setup


def test_advance_payment_methods_keep_outflows_outside_shift(tmp_path):
    url, engine, factory, branch, _other, _desk_token, _branch_admin = _setup(tmp_path)
    try:
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            token = complete_device_login(client, delivery, 'owner@example.invalid', 'synthetic-admin-password').json()['access_token']
            admin = {'Authorization': f'Bearer {token}'}
            profile = client.post(f'/api/v1/staff-roster/branches/{branch}', headers=admin,
                                  json={'full_name': 'Employee', 'position': 'Staff'}).json()['id']
            assert client.patch(f'/api/v1/staff-roster/{profile}', headers=admin,
                                json={'monthly_salary_minor': 1400000}).status_code == 200
            body = {'branch_id': str(branch), 'staff_profile_id': profile, 'week_start': '2026-10-26', 'amount_minor': 10000}
            for method in ('cash', 'transfer'):
                headers = {**admin, 'Idempotency-Key': f'advance-{method}'}
                response = client.post('/api/v1/admin/payroll/advances', headers=headers, json={**body, 'payment_method': method})
                assert response.status_code == 201, response.text
                assert client.post('/api/v1/admin/payroll/advances', headers=headers, json={**body, 'payment_method': method}).json() == response.json()
            with factory() as session:
                expenses = session.scalars(select(Expense).where(Expense.branch_id == branch)).all()
                assert [(e.payment_method, e.shift_id) for e in expenses] == [('cash', None), ('transfer', None)]
    finally:
        engine.dispose()


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
            assert client.post('/api/v1/admin/payroll/advances', headers=headers, json={**advance, 'payment_method': 'transfer'}).json() == result.json()
            assert client.post('/api/v1/admin/payroll/advances', headers=headers, json={**advance, 'payment_method': 'cash'}).status_code == 409
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


def test_payroll_history_matches_expenses_without_double_counting(tmp_path):
    url, engine, factory, branch, other, desk_token, _branch_admin = _setup(tmp_path)
    try:
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            token = complete_device_login(client, delivery, 'owner@example.invalid', 'synthetic-admin-password').json()['access_token']
            admin = {'Authorization': f'Bearer {token}'}
            desk = {'Authorization': f'Bearer {desk_token}'}
            profile = client.post(f'/api/v1/staff-roster/branches/{branch}', headers=admin,
                                  json={'full_name': 'Emigdio', 'position': 'Staff'}).json()['id']
            client.patch(f'/api/v1/staff-roster/{profile}', headers=admin, json={'monthly_salary_minor': 1400000})
            body = {'branch_id': str(branch), 'staff_profile_id': profile}
            paid_week, open_week = '2026-10-26', '2026-11-02'
            assert client.post('/api/v1/admin/payroll/advances', headers={**admin, 'Idempotency-Key': 'a1'},
                               json={**body, 'week_start': paid_week, 'amount_minor': 50000}).status_code == 201
            assert client.post('/api/v1/admin/payroll/payments', headers={**admin, 'Idempotency-Key': 'p1'},
                               json={**body, 'week_start': paid_week, 'payment_method': 'cash'}).status_code == 201
            assert client.post('/api/v1/admin/payroll/advances', headers={**admin, 'Idempotency-Key': 'a2'},
                               json={**body, 'week_start': open_week, 'amount_minor': 20000}).status_code == 201
            # Salary change after payment must not rewrite the paid snapshot in the history.
            client.patch(f'/api/v1/staff-roster/{profile}', headers=admin, json={'monthly_salary_minor': 2000000})

            to_date = max(date(2026, 11, 8), date.today())
            query = f'from=2026-10-26&to={to_date}&branch_id={branch}'
            history = client.get(f'/api/v1/admin/payroll/history?{query}', headers=admin)
            assert history.status_code == 200, history.text
            data = history.json()
            assert [w['week_start'] for w in data['weeks']] == [open_week, paid_week]
            newer, older = data['weeks']
            assert older['items'][0]['paid']['payment_method'] == 'cash'
            assert (older['base_minor'], older['advances_minor'], older['net_minor'], older['paid_minor'], older['outflow_minor']) == (350000, 50000, 300000, 300000, 350000)
            assert newer['items'][0]['paid'] is None
            assert (newer['advances_minor'], newer['paid_minor'], newer['outflow_minor']) == (20000, 0, 20000)
            assert data['outflow_minor'] == 370000 and data['advances_minor'] == 70000 and data['paid_minor'] == 300000

            # Outflow in the payroll history equals the Gastos report for the same range: no double counting.
            expenses = client.get(f'/api/v1/admin/expenses?{query}', headers=admin).json()['items']
            assert {e['concept'] for e in expenses} == {'Adelanto de nómina', 'Nómina semanal'}
            assert all(e['shift_id'] is None and e['category'] == 'general' for e in expenses)
            assert sum(e['amount_minor'] for e in expenses) == data['outflow_minor']
            # Paid week: advances + payment expenses add up to exactly the weekly base.
            assert older['advances_minor'] + older['paid_minor'] == older['base_minor']

            # Range outside the activity is empty; invalid ranges and non-admins are rejected.
            empty = client.get(f'/api/v1/admin/payroll/history?from=2026-01-01&to=2026-01-31&branch_id={branch}', headers=admin).json()
            assert empty['weeks'] == [] and empty['outflow_minor'] == 0
            assert client.get(f'/api/v1/admin/payroll/history?from=2026-11-04&to=2026-11-01', headers=admin).status_code == 422
            assert client.get(f'/api/v1/admin/payroll/history?{query}', headers=desk).status_code == 403
            all_branches = client.get('/api/v1/admin/payroll/history?from=2026-10-28&to=2026-11-04', headers=admin)
            assert all_branches.status_code == 200 and all_branches.json()['outflow_minor'] == 370000
    finally:
        engine.dispose()

def test_payroll_writes_reject_non_admins_missing_keys_and_ineligible_profiles(tmp_path):
    url, engine, factory, branch, other, desk_token, branch_admin_token = _setup(tmp_path)
    try:
        delivery = FakeRecoveryDelivery()
        with TestClient(create_app(configured_settings(url), recovery_delivery=delivery)) as client:
            token = complete_device_login(client, delivery, 'owner@example.invalid', 'synthetic-admin-password').json()['access_token']
            admin = {'Authorization': f'Bearer {token}'}
            profile = client.post(f'/api/v1/staff-roster/branches/{branch}', headers=admin,
                                  json={'full_name': 'Emigdio', 'position': 'Staff'}).json()['id']
            client.patch(f'/api/v1/staff-roster/{profile}', headers=admin, json={'monthly_salary_minor': 1400000})
            advance = {'branch_id': str(branch), 'staff_profile_id': profile, 'week_start': '2026-10-26', 'amount_minor': 1000}
            payment = {k: v for k, v in advance.items() if k != 'amount_minor'} | {'payment_method': 'cash'}
            for name, bearer in (('desk', desk_token), ('branch admin', branch_admin_token)):
                headers = {'Authorization': f'Bearer {bearer}', 'Idempotency-Key': f'{name}-key'}
                assert client.post('/api/v1/admin/payroll/advances', headers=headers, json=advance).status_code in (401, 403), name
                assert client.post('/api/v1/admin/payroll/payments', headers=headers, json=payment).status_code in (401, 403), name
            assert client.post('/api/v1/admin/payroll/advances', headers=admin, json=advance).status_code == 422
            assert client.post('/api/v1/admin/payroll/payments', headers=admin, json=payment).status_code == 422
            keyed = {**admin, 'Idempotency-Key': 'k1'}
            assert client.post('/api/v1/admin/payroll/advances', headers=keyed, json={**advance, 'week_start': '2026-10-27'}).status_code == 422
            assert client.post('/api/v1/admin/payroll/advances', headers=keyed, json={**advance, 'amount_minor': 0}).status_code == 422
            assert client.post('/api/v1/admin/payroll/advances', headers=keyed, json={**advance, 'branch_id': str(other)}).status_code in (403, 422)
            assert client.patch(f'/api/v1/staff-roster/{profile}', headers=admin, json={'is_active': False}).status_code == 200
            assert client.post('/api/v1/admin/payroll/advances', headers=keyed, json=advance).status_code == 422
            assert client.post('/api/v1/admin/payroll/payments', headers=keyed, json=payment).status_code == 422
            with factory() as session:
                assert session.scalars(select(Expense).where(Expense.branch_id == branch)).all() == []
    finally:
        engine.dispose()

