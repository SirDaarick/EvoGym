from test_admin_auth import complete_device_login


def approved_admin_session(client, delivery, login="owner@example.invalid", password="synthetic-admin-password",
                           category="computer"):
    response = complete_device_login(client, delivery, login, password, category=category)
    assert response.status_code == 200, response.text
    return response


def approved_admin_headers(client, delivery, login="owner@example.invalid", password="synthetic-admin-password",
                           category="computer"):
    response = approved_admin_session(client, delivery, login, password, category)
    access_token = response.json().get("access_token")
    assert isinstance(access_token, str) and access_token
    return {"Authorization": f"Bearer {access_token}"}
