"""Tests for the interrupt orchestration in app_runtime.

Covers:
- ``is_anything_running()`` detecting an active playback channel even when both
  the TTS and UI queues have drained (so a new message interrupts playback).
- ``request_interrupt()`` bumping the monotonic ``interrupt_generation`` counter
  that lets in-flight TTS synthesis detect an interrupt after the shared
  ``cancellation_requested`` event is cleared by the next turn.
"""

from unittest.mock import MagicMock

from core.runtime.app_runtime import is_anything_running, request_interrupt


def test_is_anything_running_false_when_idle(mock_app_runtime):
    rt = mock_app_runtime
    rt.generating.clear()
    assert is_anything_running() is False


def test_is_anything_running_true_when_generating(mock_app_runtime):
    rt = mock_app_runtime
    rt.generating.set()
    assert is_anything_running() is True


def test_is_anything_running_true_when_queue_has_items(mock_app_runtime):
    rt = mock_app_runtime
    rt.generating.clear()
    rt.tts_queue.put(object())
    assert is_anything_running() is True
    rt.tts_queue.get()
    assert is_anything_running() is False
    rt.audio_path_queue.put(object())
    assert is_anything_running() is True


def test_is_anything_running_detects_active_playback(mock_app_runtime):
    """generating unset + both queues empty, but the dialog channel is busy —
    is_anything_running() must be True so a new message interrupts playback."""
    rt = mock_app_runtime
    rt.generating.clear()
    assert rt.tts_queue.empty() and rt.audio_path_queue.empty()
    assert is_anything_running() is False

    ch = MagicMock()
    ch.get_busy.return_value = True
    rt.ui_playback.dialog_channel = ch
    assert is_anything_running() is True


def test_request_interrupt_bumps_monotonic_generation(mock_app_runtime):
    rt = mock_app_runtime
    before = rt.interrupt_generation
    request_interrupt()
    assert rt.cancellation_requested.is_set()
    assert rt.interrupt_generation == before + 1
    # Simulate the next turn clearing the shared cancel event; the monotonic
    # generation must NOT go backwards.
    rt.cancellation_requested.clear()
    request_interrupt()
    assert rt.interrupt_generation == before + 2
