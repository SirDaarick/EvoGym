import pytest
from sqlalchemy import create_engine, event, text

from app.db.engine import create_engine_from_settings
from app.db.session import create_session_factory, get_session
from app.settings import Settings


def test_engine_is_lazy_and_hides_sql_parameters():
    settings = Settings(
        environment="test",
        database_url="sqlite+pysqlite:///:memory:",
        _env_file=None,
    )
    engine = create_engine_from_settings(settings)
    connections = []
    event.listen(engine, "connect", lambda *_: connections.append(True))

    assert engine.echo is False
    assert engine.hide_parameters is True
    assert connections == []
    with engine.connect() as connection:
        assert connection.execute(text("select 1")).scalar_one() == 1
    assert connections == [True]
    engine.dispose()


def test_session_dependency_rolls_back_uncommitted_work_and_closes_session():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("create table sample (value text not null)"))
    factory = create_session_factory(engine)
    dependency = get_session(factory)
    session = next(dependency)

    session.execute(text("insert into sample (value) values ('not committed')"))
    with pytest.raises(StopIteration):
        next(dependency)

    with factory() as verification_session:
        assert verification_session.execute(text("select count(*) from sample")).scalar_one() == 0
    engine.dispose()


def test_session_dependency_rolls_back_on_error_and_propagates_error():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(text("create table sample (value text not null)"))
    factory = create_session_factory(engine)
    dependency = get_session(factory)
    session = next(dependency)
    session.execute(text("insert into sample (value) values ('not committed')"))

    with pytest.raises(RuntimeError, match="use case failed"):
        dependency.throw(RuntimeError("use case failed"))

    with factory() as verification_session:
        assert verification_session.execute(text("select count(*) from sample")).scalar_one() == 0
    engine.dispose()
