#!/usr/bin/env python3
"""Patch Hermes api_server for Grok/multi-provider per-run overrides + model catalogue."""
from pathlib import Path

path = Path("/var/lib/hermes/hermes-agent/gateway/platforms/api_server.py")
text = path.read_text(encoding="utf-8")
backup = path.with_suffix(".py.bak-llm-20260720")
if not backup.exists():
    backup.write_text(text, encoding="utf-8")

old_allow = '''_DEFAULT_RUN_MODEL_ALLOWLIST = {
    "claude-sonnet-4-6",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex-spark",
}'''

new_allow = '''_DEFAULT_RUN_MODEL_ALLOWLIST = {
    # Anthropic
    "claude-sonnet-4-6",
    "claude-opus-4-6",
    "claude-haiku-4-5",
    # OpenAI Codex / ChatGPT
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    # xAI Grok (API key + SuperGrok OAuth)
    "grok-build-0.1",
    "grok-4.6",
    "grok-4.5",
    "grok-4.3",
    "grok-composer-2.5-fast",
    "grok-4.20-0309-reasoning",
    "grok-4.20-0309-non-reasoning",
    "grok-4.20-multi-agent-0309",
    "grok-4.20-reasoning",  # legacy alias still present in some profile fallbacks
    # Gemini
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3-flash-preview",
    # DeepSeek (API key · base https://api.deepseek.com)
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "deepseek-chat",
    "deepseek-reasoner",
}'''

if old_allow not in text:
    raise SystemExit("allowlist block not found — abort")
text = text.replace(old_allow, new_allow, 1)

old_infer = '''    @staticmethod
    def _infer_provider_for_model_override(model: str) -> Optional[str]:
        lowered = model.strip().lower()
        if lowered.startswith("claude") or lowered.startswith("anthropic/claude"):
            return "anthropic"
        if lowered.startswith("gpt-"):
            return "openai-codex"
        return None

    def _apply_model_override_provider(self, runtime_kwargs: Dict[str, Any], model: str) -> None:
        provider = self._infer_provider_for_model_override(model)
        if not provider or runtime_kwargs.get("provider") == provider:
            return'''

new_infer = '''    @staticmethod
    def _infer_provider_for_model_override(model: str) -> Optional[str]:
        lowered = model.strip().lower()
        if lowered.startswith("claude") or lowered.startswith("anthropic/claude"):
            return "anthropic"
        if lowered.startswith("grok-") or lowered.startswith("x-ai/") or lowered.startswith("xai/"):
            return "xai"
        if lowered.startswith("gemini-") or lowered.startswith("google/gemini"):
            return "gemini"
        if lowered.startswith("deepseek") or lowered.startswith("deepseek/"):
            return "deepseek"
        if lowered.startswith("gpt-"):
            return "openai-codex"
        if "/" in lowered:
            return "openrouter"
        return None

    def _apply_model_override_provider(
        self,
        runtime_kwargs: Dict[str, Any],
        model: str,
        provider_override: Optional[str] = None,
    ) -> None:
        provider = (provider_override or "").strip() or self._infer_provider_for_model_override(model)
        if not provider or runtime_kwargs.get("provider") == provider:
            return'''

if old_infer not in text:
    raise SystemExit("infer/apply block not found — abort")
text = text.replace(old_infer, new_infer, 1)

text = text.replace(
    "        model_override: Optional[str] = None,\n    ) -> Any:",
    "        model_override: Optional[str] = None,\n        provider_override: Optional[str] = None,\n    ) -> Any:",
    1,
)
text = text.replace(
    "        if model_override:\n            model = model_override\n            self._apply_model_override_provider(runtime_kwargs, model_override)\n",
    "        if model_override:\n            model = model_override\n            self._apply_model_override_provider(runtime_kwargs, model_override, provider_override)\n",
    1,
)

old_create = '''                    agent = self._create_agent(
                        ephemeral_system_prompt=ephemeral_system_prompt,
                        session_id=session_id,
                        stream_delta_callback=_text_cb,
                        tool_progress_callback=event_cb,
                        gateway_session_key=gateway_session_key,
                        route=route,
                        reasoning_override=reasoning_override,
                        model_override=model_override,
                    )'''
new_create = '''                    agent = self._create_agent(
                        ephemeral_system_prompt=ephemeral_system_prompt,
                        session_id=session_id,
                        stream_delta_callback=_text_cb,
                        tool_progress_callback=event_cb,
                        gateway_session_key=gateway_session_key,
                        route=route,
                        reasoning_override=reasoning_override,
                        model_override=model_override,
                        provider_override=(
                            body.get("provider").strip()
                            if isinstance(body.get("provider"), str) and body.get("provider").strip()
                            else None
                        ),
                    )'''
if old_create not in text:
    raise SystemExit("create_agent call site not found — abort")
text = text.replace(old_create, new_create, 1)

old_models_tail = '''        for alias, route_cfg in self._model_routes.items():
            if alias == model_name:
                continue  # already listed above
            models.append({
                "id": alias,
                "object": "model",
                "created": now,
                "owned_by": "hermes",
                "permission": [],
                "root": route_cfg.get("model", alias),
                "parent": model_name,
            })

        return web.json_response({"object": "list", "data": models})'''

new_models_tail = '''        for alias, route_cfg in self._model_routes.items():
            if alias == model_name:
                continue  # already listed above
            models.append({
                "id": alias,
                "object": "model",
                "created": now,
                "owned_by": "hermes",
                "permission": [],
                "root": route_cfg.get("model", alias),
                "parent": model_name,
                "provider": route_cfg.get("provider"),
                "configured": True,
                "available": True,
            })

        # Advertise allowlisted per-run override models so Messages can select
        # Grok / Claude / Codex / Gemini without waiting on model_routes.
        seen = {m["id"] for m in models}
        for mid in sorted(self._run_model_allowlist()):
            if mid in seen:
                continue
            provider = self._infer_provider_for_model_override(mid)
            models.append({
                "id": mid,
                "object": "model",
                "created": now,
                "owned_by": provider or "hermes",
                "permission": [],
                "root": mid,
                "parent": model_name,
                "provider": provider,
                "configured": True,
                "available": True,
            })

        return web.json_response({"object": "list", "data": models})'''

if old_models_tail not in text:
    raise SystemExit("models handler tail not found — abort")
text = text.replace(old_models_tail, new_models_tail, 1)

path.write_text(text, encoding="utf-8")
print("patched api_server.py")

changed = []
for cfg in sorted(Path("/var/lib/hermes/profiles").glob("*/config.yaml")):
    raw = cfg.read_text(encoding="utf-8")
    new = raw.replace("grok-4.20-reasoning", "grok-4.20-0309-reasoning")
    if new != raw:
        cfg.write_text(new, encoding="utf-8")
        changed.append(cfg.parent.name)
print("fallback model updated:", ",".join(changed) if changed else "(none)")
