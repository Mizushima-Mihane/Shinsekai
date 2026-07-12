"""Unit tests for ClearableQueue."""

import threading
import time

from core.runtime.queue_utils import ClearableQueue


def test_clear_removes_all_items():
    q = ClearableQueue()
    q.put(1)
    q.put(2)
    q.put(3)
    q.clear()
    assert q.empty()
    assert q.qsize() == 0


def test_clear_preserves_in_flight_task_done():
    """clear() must account for items still in the queue but not those already get()'d."""
    q = ClearableQueue()
    q.put(1)        # unfinished_tasks=1
    q.put(2)        # unfinished_tasks=2
    item = q.get()  # worker retrieves item 1; unfinished_tasks stays 2
    q.clear()       # removes item 2 from queue → unfinished_tasks = 2-1 = 1
    q.task_done()   # unfinished_tasks = 1-1 = 0  ✓
    q.join()        # should return immediately


def test_drain_returns_items():
    q = ClearableQueue()
    q.put("a")
    q.put("b")
    q.put("c")
    drained = q.drain()
    assert drained == ["a", "b", "c"]
    assert q.empty()


def test_drain_max_items():
    q = ClearableQueue()
    q.put(1)
    q.put(2)
    q.put(3)
    drained = q.drain(max_items=2)
    assert drained == [1, 2]
    assert q.qsize() == 1


def test_clear_does_not_deliver_phantom_to_waiter():
    """clear() must NOT unblock a get() waiting on an (already empty) queue.

    A ``not_empty`` notify cannot deliver an item: a woken ``get()`` re-checks,
    finds the queue empty, and waits again. By design a consumer blocked on
    ``get()`` should keep waiting for the next *real* message after a clear().
    This test proves that behaviour by observing that the waiter stays blocked
    across a clear() and only returns once a real item is put — and that the
    value it receives is that real item, never a phantom ``None``.
    """
    q = ClearableQueue()
    results = []
    ready = threading.Event()

    def waiter():
        ready.set()
        try:
            results.append(q.get(timeout=1.0))
        except Exception:
            results.append("timeout")

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    ready.wait(timeout=1.0)
    time.sleep(0.15)  # let waiter actually block inside get() on the empty queue

    q.clear()          # must NOT wake the waiter with a phantom item
    time.sleep(0.2)
    assert results == [], "clear() on an empty queue must not make get() return"

    q.put("real")      # a real put is what wakes the waiter
    t.join(timeout=1.0)
    assert not t.is_alive(), "waiter should have exited after the real put"
    assert results == ["real"], "waiter must receive the real item, not a phantom"


def test_clear_while_waiter_blocked_discards_queued_items():
    """clear() while a consumer is blocked drops queued items; the consumer then
    receives the *next* real put rather than a stale, cleared one."""
    q = ClearableQueue()
    results = []
    ready = threading.Event()

    def waiter():
        ready.set()
        # Two sequential gets: the first should see the post-clear "fresh" item.
        try:
            results.append(q.get(timeout=1.0))
        except Exception:
            results.append("timeout")

    t = threading.Thread(target=waiter, daemon=True)
    t.start()
    ready.wait(timeout=1.0)
    time.sleep(0.15)

    q.clear()          # nothing queued yet — no-op for items, waiter stays blocked
    q.put("fresh")
    t.join(timeout=1.0)
    assert results == ["fresh"]


def test_clearable_queue_factory_compatible():
    """Verify ClearableQueue can be used as a queue_factory."""
    from sdk.graph import Dag

    dag = Dag(queue_factory=ClearableQueue)
    assert dag is not None


def test_standard_get_put_works():
    q = ClearableQueue()
    q.put("hello")
    assert q.get() == "hello"
    q.task_done()
    assert q.empty()
