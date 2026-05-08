import pytest
from unittest.mock import patch, MagicMock, AsyncMock


class TestSchedulerSetup:
    def test_setup_returns_worker(self):
        from app.workers.scheduler import setup

        mock_worker = MagicMock()

        with patch("app.workers.scheduler.Worker", return_value=mock_worker):
            result = setup()

        assert result is mock_worker

    def test_setup_registers_two_cron_jobs(self):
        from app.workers.scheduler import setup

        cron_jobs_registered = []

        def capture_worker(queue, functions, cron_jobs):
            cron_jobs_registered.extend(cron_jobs)
            return MagicMock()

        with patch("app.workers.scheduler.Worker", side_effect=capture_worker):
            setup()

        assert len(cron_jobs_registered) == 2

    def test_setup_diary_cron_schedule(self):
        from app.workers.scheduler import setup

        cron_jobs_registered = []

        def capture_worker(queue, functions, cron_jobs):
            cron_jobs_registered.extend(cron_jobs)
            return MagicMock()

        with patch("app.workers.scheduler.Worker", side_effect=capture_worker):
            setup()

        cron_exprs = [cj.cron for cj in cron_jobs_registered]
        assert "0 23 * * *" in cron_exprs

    def test_setup_pattern_cron_schedule(self):
        from app.workers.scheduler import setup

        cron_jobs_registered = []

        def capture_worker(queue, functions, cron_jobs):
            cron_jobs_registered.extend(cron_jobs)
            return MagicMock()

        with patch("app.workers.scheduler.Worker", side_effect=capture_worker):
            setup()

        cron_exprs = [cj.cron for cj in cron_jobs_registered]
        assert "0 4 * * 0" in cron_exprs

    def test_setup_registers_both_functions(self):
        from app.workers.scheduler import setup, run_diary, run_patterns

        functions_registered = []

        def capture_worker(queue, functions, cron_jobs):
            functions_registered.extend(functions)
            return MagicMock()

        with patch("app.workers.scheduler.Worker", side_effect=capture_worker):
            setup()

        assert run_diary in functions_registered
        assert run_patterns in functions_registered


class TestSchedulerShutdown:
    async def test_shutdown_closes_redis_connection(self):
        from app.workers.scheduler import shutdown

        mock_redis = AsyncMock()
        mock_queue = MagicMock()
        mock_queue.redis = mock_redis

        with patch("app.workers.scheduler.queue", mock_queue):
            await shutdown()

        mock_redis.aclose.assert_called_once()

    async def test_shutdown_handles_aclose_exception(self):
        from app.workers.scheduler import shutdown

        mock_redis = AsyncMock()
        mock_redis.aclose = AsyncMock(side_effect=Exception("connection error"))
        mock_queue = MagicMock()
        mock_queue.redis = mock_redis

        with patch("app.workers.scheduler.queue", mock_queue):
            await shutdown()  # must not raise

    async def test_shutdown_handles_no_redis_attribute(self):
        from app.workers.scheduler import shutdown

        mock_queue = MagicMock(spec=[])  # no 'redis' attribute

        with patch("app.workers.scheduler.queue", mock_queue):
            await shutdown()  # must not raise
