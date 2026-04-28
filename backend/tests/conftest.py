import pytest
import asyncio
from httpx import AsyncClient
from app.main import sio_app
from app.db.session import init_db, close_db

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()

@pytest.fixture(scope="session", autouse=True)
async def db_setup():
    await init_db()
    yield
    await close_db()

@pytest.fixture
async def client():
    async with AsyncClient(app=sio_app, base_url="http://test") as ac:
        yield ac
