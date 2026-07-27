from __future__ import annotations

import sys
from types import ModuleType, SimpleNamespace

from plugins.shinsekai_chat_phone import webface


def test_resolve_bridge_state_supports_webui_react_module(monkeypatch):
    state = SimpleNamespace()
    module = ModuleType("webui_react")
    module.get_bridge_state = lambda: state
    monkeypatch.setitem(sys.modules, "webui_react", module)

    assert webface._resolve_bridge_state() is state


def test_send_runtime_command_uses_live_chat_session(monkeypatch):
    sent: list[tuple[str, dict]] = []
    stream = SimpleNamespace(send_command=lambda session_id, command: sent.append((session_id, command)) or True)
    monkeypatch.setattr(
        webface,
        "_resolve_bridge_state",
        lambda: SimpleNamespace(chat_stream=stream, chat_session={"sessionId": "session-1"}),
    )

    assert webface._send_runtime_command({"type": "send-message", "payload": {"text": "test"}}) is True
    assert sent[0][0] == "session-1"
    assert sent[0][1]["type"] == "send-message"
    assert sent[0][1]["cmdId"]


def test_hidden_runtime_turn_marks_command_payload(monkeypatch):
    sent: list[dict] = []
    monkeypatch.setattr(webface, "_send_runtime_command", lambda command: sent.append(command) or True)

    assert webface._trigger_runtime_turn("[call accepted]", hidden=True) is True
    assert sent == [{
        "type": "send-message",
        "payload": {"text": "[call accepted]", "attachments": [], "hidden": True},
    }]


def test_outgoing_call_prompt_keeps_player_as_caller(monkeypatch):
    turns: list[tuple[str, bool]] = []
    monkeypatch.setattr(
        webface,
        "_trigger_runtime_turn_with_retry",
        lambda text, *, hidden: turns.append((text, hidden)) or True,
    )

    assert webface._call_dial("狛枝凪斗", video=False) == {"ok": True}
    assert "玩家主动拨通了狛枝凪斗的电话" in turns[0][0]
    assert "不是狛枝凪斗主动来电" in turns[0][0]
    assert turns[0][1] is True


def test_hangup_prompt_requests_visible_narration(monkeypatch):
    turns: list[tuple[str, bool]] = []
    monkeypatch.setattr(webface, "_send_runtime_command", lambda _command: True)
    monkeypatch.setattr(
        webface,
        "_trigger_runtime_turn_with_retry",
        lambda text, *, hidden: turns.append((text, hidden)) or True,
    )

    assert webface._call_hangup("狛枝凪斗", 10, incoming=False, video=False) == {"ok": True}
    assert "NARR" in turns[0][0]
    assert "玩家挂断了电话。" in turns[0][0]
    assert turns[0][1] is True
