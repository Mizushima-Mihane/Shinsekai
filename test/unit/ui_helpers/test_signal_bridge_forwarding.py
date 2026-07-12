"""Forwarding tests for ChatUISignalBridge.

Verifies that window-level ``interrupt_requested`` and ``flush_batch`` signals
are relayed to the bridge exactly once while attached, and stop being relayed
after ``detach_chat_ui_window()``. Uses a headless ``QCoreApplication`` (no
display / platform plugin needed), so it runs in the default unit suite.
"""

import pytest

from PySide6.QtCore import QObject, QCoreApplication, Signal

from ui.chat_ui.signal_bridge import (
    attach_chat_ui_window,
    detach_chat_ui_window,
    get_chat_ui_signal_bridge,
)


@pytest.fixture(scope="module")
def _qapp():
    app = QCoreApplication.instance() or QCoreApplication([])
    yield app


class _FakeWindow(QObject):
    # Only the two signals under test; the bridge tolerates the rest being
    # absent (it just logs a warning per missing signal).
    interrupt_requested = Signal()
    flush_batch = Signal()


def test_interrupt_and_flush_forwarded_once_then_stop_after_detach(_qapp):
    detach_chat_ui_window()  # start from a clean attachment state
    bridge = get_chat_ui_signal_bridge()

    counts = {"interrupt": 0, "flush": 0}
    bridge.interrupt_requested.connect(lambda: counts.__setitem__("interrupt", counts["interrupt"] + 1))
    bridge.flush_batch.connect(lambda: counts.__setitem__("flush", counts["flush"] + 1))

    window = _FakeWindow()
    attach_chat_ui_window(window)

    window.interrupt_requested.emit()
    window.flush_batch.emit()
    assert counts == {"interrupt": 1, "flush": 1}, "each window signal must forward exactly once"

    detach_chat_ui_window()

    window.interrupt_requested.emit()
    window.flush_batch.emit()
    assert counts == {"interrupt": 1, "flush": 1}, "signals must not forward after detach"
