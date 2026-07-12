"""Unit tests for InputBatcher — lock-safe tick callback and disabled-bypass."""

import threading

from core.runtime.input_batcher import InputBatcher


def _text_sink(store):
    return lambda msg: store.append(msg.text)


def test_flush_combines_buffered_messages_and_clears():
    sink = []
    b = InputBatcher(sink=_text_sink(sink), separator="\n")
    b.submit("x")
    b.submit("y")
    assert b.pending_count == 2
    b.flush()
    assert sink == ["x\ny"]
    assert b.pending_count == 0


def test_countdown_reaches_zero_signals_flush():
    b = InputBatcher(sink=lambda m: None, idle_seconds=2)
    b.submit("x")
    b.schedule_flush()
    assert b.on_countdown_tick() is False  # 2 -> 1
    assert b.on_countdown_tick() is True   # 1 -> 0, caller must flush


def test_tick_callback_may_reenter_without_deadlock():
    """The tick callback is invoked OUTSIDE the internal lock, so a callback
    that reads pending_count / calls cancel()/on_user_typing() (each of which
    re-acquires the non-reentrant lock) must not deadlock."""
    sink = []
    holder = {}
    seen = {}

    def tick_cb(text):
        b = holder["b"]
        # Every one of these re-acquires the batcher's lock.
        seen["pending"] = b.pending_count
        seen["typing"] = b.on_user_typing()
        b.cancel()

    b = InputBatcher(sink=_text_sink(sink), idle_seconds=3, tick_callback=tick_cb)
    holder["b"] = b
    b.submit("hello")

    # Run schedule_flush (which fires the tick callback) on a worker thread and
    # assert it returns promptly — a deadlock would hang here forever.
    done = threading.Event()

    def run():
        b.schedule_flush()
        done.set()

    t = threading.Thread(target=run, daemon=True)
    t.start()
    assert done.wait(timeout=3.0), "schedule_flush deadlocked when tick_cb re-entered the batcher"
    assert "pending" in seen


def test_on_countdown_tick_callback_reenter_without_deadlock():
    holder = {}
    fired = threading.Event()

    def tick_cb(text):
        # Re-enter under the countdown path too.
        holder["b"].pending_count
        fired.set()

    b = InputBatcher(sink=lambda m: None, idle_seconds=5, tick_callback=tick_cb)
    holder["b"] = b
    b.submit("hi")
    b.schedule_flush()  # countdown = 5

    done = threading.Event()

    def run():
        b.on_countdown_tick()  # 5 -> 4, fires tick_cb
        done.set()

    t = threading.Thread(target=run, daemon=True)
    t.start()
    assert done.wait(timeout=3.0), "on_countdown_tick deadlocked when tick_cb re-entered"
    assert fired.is_set()


def test_disabling_batch_flushes_single_buffered_before_current():
    """A message buffered while enabled must not be stranded when batching is
    later disabled: submitting while disabled flushes the buffer first."""
    enabled = {"v": True}
    sink = []
    b = InputBatcher(
        sink=_text_sink(sink),
        separator="\n",
        enabled_factory=lambda: enabled["v"],
    )
    b.submit("A")                 # buffered while enabled
    assert b.pending_count == 1

    enabled["v"] = False
    b.submit("B")                 # disabled -> flush A, then send B

    assert b.pending_count == 0
    assert sink == ["A", "B"]     # buffered A first, then current B


def test_disabling_batch_flushes_multiple_buffered_in_order():
    enabled = {"v": True}
    sink = []
    b = InputBatcher(
        sink=_text_sink(sink),
        separator="\n",
        enabled_factory=lambda: enabled["v"],
    )
    b.submit("A1")
    b.submit("A2")
    assert b.pending_count == 2

    enabled["v"] = False
    b.submit("B")

    assert b.pending_count == 0
    # Earlier buffer flushed as one combined block, then the current message.
    assert sink == ["A1\nA2", "B"]


def test_disabled_from_start_passes_through():
    sink = []
    b = InputBatcher(sink=_text_sink(sink), enabled_factory=lambda: False)
    b.submit("hi")
    assert sink == ["hi"]
    assert b.pending_count == 0
