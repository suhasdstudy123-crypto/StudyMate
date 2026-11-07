"""
LLM abstraction layer for StudyMate RAG answer generation.
Supports Google Gemini via google-genai, plus mock and fallback providers for tests and offline use.
"""

import logging
from abc import ABC, abstractmethod
from typing import Any

from backend.app.config import CHAT_MODEL, CHAT_TEMPERATURE, GEMINI_API_KEY

log = logging.getLogger("studymate.llm")


class LLMError(Exception):
    """Raised when the LLM provider fails to generate an answer."""
    pass


class LLMConfigError(LLMError):
    """Raised when LLM configuration or credentials are missing."""
    pass


class BaseLLM(ABC):
    @abstractmethod
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        """Generate text given a system prompt and user prompt."""
        pass


class GeminiLLM(BaseLLM):
    def __init__(
        self,
        api_key: str,
        model_name: str = CHAT_MODEL,
        temperature: float = CHAT_TEMPERATURE,
    ):
        self.api_key = api_key
        self.model_name = model_name
        self.temperature = temperature
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            from google import genai

            self._client = genai.Client(api_key=self.api_key)
        return self._client

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        from google.genai import types

        client = self._get_client()
        models_to_try = [self.model_name]
        for fallback in ["gemini-3-flash-preview", "gemini-3.5-flash-lite"]:
            if fallback not in models_to_try:
                models_to_try.append(fallback)

        last_error = None
        for m in models_to_try:
            try:
                config = types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=self.temperature,
                    max_output_tokens=2048,
                )
                response = client.models.generate_content(
                    model=m,
                    contents=user_prompt,
                    config=config,
                )
                if response and response.text:
                    return response.text.strip()
            except Exception as exc:
                log.warning("Model %s generation failed: %s", m, exc)
                last_error = exc

        log.exception("All Gemini answer generation attempts failed: %s", last_error)
        raise LLMError(f"AI answer generation error: {last_error}") from last_error


class MockLLM(BaseLLM):
    """Deterministic mock LLM for testing without network requests."""

    def __init__(self, response_generator=None):
        self.response_generator = response_generator
        self.calls: list[dict[str, str]] = []

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        self.calls.append({"system": system_prompt, "user": user_prompt})
        if callable(self.response_generator):
            return self.response_generator(system_prompt, user_prompt)
        if isinstance(self.response_generator, str):
            return self.response_generator
        return (
            "Third Normal Form (3NF) requires a relation to be in 2NF and have no "
            "transitive dependencies [Source 1]. This ensures every non-prime attribute "
            "is directly dependent on the candidate key."
        )


_active_llm: BaseLLM | None = None


def set_llm(llm: BaseLLM | None) -> None:
    """Override the active LLM instance (used in tests)."""
    global _active_llm
    _active_llm = llm


def get_llm() -> BaseLLM:
    """Return the active or configured LLM provider."""
    global _active_llm
    if _active_llm is not None:
        return _active_llm

    if GEMINI_API_KEY:
        return GeminiLLM(api_key=GEMINI_API_KEY)

    raise LLMConfigError(
        "GEMINI_API_KEY is not configured. Please set GEMINI_API_KEY in backend/.env "
        "to enable AI answer generation."
    )
