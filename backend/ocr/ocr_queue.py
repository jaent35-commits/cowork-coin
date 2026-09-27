"""OCR 추론 대기열 — 한 번에 하나씩, 들어온 순서대로 (PaddleOCR 예측기는 스레드 안전하지 않음).

기존 threading.Lock 은 스레드 안에서 기다려 대기 중인 요청의 연결 상태를 볼 수 없었다.
여기서는 이벤트 루프에서 기다리며 0.5초마다 check()(연결 끊김·대기 시간 초과)를 확인하고,
해당하면 추론을 시작하지 않고 대기열에서 빠진다. 이미 시작한 추론은 끊지 않는다(끝난 뒤 release).
"""
from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Awaitable, Callable

POLL_S = 0.5


class Skipped(Exception):
    """추론 전에 빠진 요청 — reason: disconnected | timeout"""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class OcrQueue:
    """max_waiting: 추론 중인 1건을 뺀 대기 가능 수 — 넘치면 기다리게 하지 않고 곧바로 Skipped("full")"""

    def __init__(self, max_waiting: int) -> None:
        self.max_waiting = max_waiting
        self._waiters: deque[asyncio.Future[None]] = deque()
        self._busy = False
        self._closed = False
        self._idle = asyncio.Event()
        self._idle.set()

    def close(self) -> None:
        """서버 종료 — 새 요청과 대기 중인 요청은 추론 없이 Skipped("shutdown"), 진행 중인 추론은 그대로."""
        self._closed = True
        while self._waiters:
            fut = self._waiters.popleft()
            if not fut.done():
                fut.set_exception(Skipped("shutdown"))

    async def wait_idle(self) -> None:
        """진행 중인 추론이 끝날 때까지."""
        await self._idle.wait()

    @property
    def waiting(self) -> int:
        return len(self._waiters)

    @property
    def running(self) -> bool:
        return self._busy

    async def acquire(self, check: Callable[[], Awaitable[str | None]]) -> None:
        """차례가 오면 반환(이후 반드시 release). check() 가 사유를 돌려주면 Skipped."""
        if self._closed:
            raise Skipped("shutdown")
        if not self._busy and not self._waiters:
            self._busy = True
            self._idle.clear()
            return
        if len(self._waiters) >= self.max_waiting:
            raise Skipped("full")
        fut: asyncio.Future[None] = asyncio.get_running_loop().create_future()
        self._waiters.append(fut)
        try:
            while True:
                try:
                    await asyncio.wait_for(asyncio.shield(fut), POLL_S)
                    return  # 차례 받음 (busy 는 넘겨받은 상태)
                except TimeoutError:
                    reason = await check()
                    if reason:
                        raise Skipped(reason)
        except BaseException:
            # 빠지는 중 — 이미 차례를 넘겨받았다면 다음 사람에게 넘김
            if fut.done() and not fut.cancelled() and fut.exception() is None:
                self.release()
            else:
                fut.cancel()
                try:
                    self._waiters.remove(fut)
                except ValueError:
                    pass
            raise

    def release(self) -> None:
        while self._waiters:
            fut = self._waiters.popleft()
            if not fut.done():
                fut.set_result(None)  # busy 유지한 채 다음 요청에 넘김
                return
        self._busy = False
        self._idle.set()
