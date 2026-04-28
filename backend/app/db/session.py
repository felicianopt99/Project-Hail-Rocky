import logging
from prisma import Prisma

logger = logging.getLogger("RockyDB")
db = Prisma()

async def init_db():
    try:
        if not db.is_connected():
            await db.connect()
            logger.info("Connected to database. Amaze!")
    except Exception as e:
        logger.error(f"Failed to connect to database: {e}. Bad math!")

async def close_db():
    try:
        if db.is_connected():
            await db.disconnect()
            logger.info("Disconnected from database. Sleep time!")
    except Exception as e:
        logger.error(f"Error disconnecting from database: {e}")
