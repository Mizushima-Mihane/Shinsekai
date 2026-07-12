"""Cancellation-token tests for LLMManager.

The manager uses a per-turn ``threading.Event`` (``_current_cancel_event``)
captured locally by each streaming/sync method, so:
- ``cancel_current_chat()`` stops an in-flight stream promptly, and
- a brand-new outer turn rotates the token WITHOUT resetting a prior turn's
  still-set token (the race the review flagged).
"""

from llm.llm_manager import LLMManager
from test.mocks import MockLLMAdapter


def _mgr(response: str) -> LLMManager:
    return LLMManager(adapter=MockLLMAdapter(responses=[response]))


def test_cancel_current_chat_stops_stream_early():
    mgr = _mgr("abcdefghij")
    gen = mgr.chat("hi", stream=True, include_local_time=False)

    out = []
    for i, piece in enumerate(gen):
        out.append(piece)
        if i == 2:
            mgr.cancel_current_chat()

    # Streaming stopped on the next iteration after cancel — not all 10 chars.
    assert out == ["a", "b", "c"]


def test_new_outer_turn_does_not_reset_prior_cancel_token():
    mgr = _mgr("x")

    gen1 = mgr.chat("first", stream=True, include_local_time=False)
    e1 = mgr._current_cancel_event
    assert e1 is not None and not e1.is_set()

    mgr.cancel_current_chat()
    assert e1.is_set()

    # Draining gen1 breaks immediately on the cancelled token and its finally
    # resets the chat depth back to 0 (clean outer boundary for the next turn).
    assert list(gen1) == []

    gen2 = mgr.chat("second", stream=True, include_local_time=False)
    e2 = mgr._current_cancel_event
    assert e2 is not e1, "a new outer turn must rotate the cancel token"
    assert not e2.is_set(), "the new turn must not inherit the prior cancellation"
    assert e1.is_set(), "the prior turn's token must stay cancelled (never reset)"

    list(gen2)  # drain cleanly


def test_cancel_before_any_chat_is_noop():
    mgr = _mgr("x")
    assert mgr._current_cancel_event is None
    # Must not raise even though there is no active turn/token yet.
    mgr.cancel_current_chat()
