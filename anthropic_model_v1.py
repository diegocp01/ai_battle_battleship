from __future__ import annotations

import json
import time
import logging
import anthropic
from dotenv import load_dotenv

load_dotenv()
client = anthropic.Anthropic()

# Retry configuration for handling thinking-only responses
MAX_RETRIES = 3
RETRY_DELAY_BASE = 1  # seconds (exponential backoff: 1s, 2s, 4s)

PLACEMENT_SYSTEM_PROMPT = """You are a Battleship ship placement generator.

RULES:
- Grid is 10x10: columns A-J, rows 1-10
- Ships: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2)
- Direction: H = horizontal (extends RIGHT), V = vertical (extends DOWN)
- Ships cannot overlap or go out of bounds
- Place all 5 ships strategically

OUTPUT FORMAT (strict JSON):
{
  "Carrier": {"start": "A1", "direction": "H"},
  "Battleship": {"start": "C3", "direction": "V"},
  "Cruiser": {"start": "E5", "direction": "H"},
  "Submarine": {"start": "G7", "direction": "V"},
  "Destroyer": {"start": "I9", "direction": "H"}
}

No extra text. Output only valid JSON.""".strip()

FIRE_SYSTEM_PROMPT = """You are a Battleship targeting AI.

RULES:
- Grid is 10x10: columns A-J, rows 1-10
- Choose ONE coordinate to fire at
- Pick coordinates you haven't fired at before
- Use strategy: if you hit something, try adjacent cells

OUTPUT FORMAT (strict JSON):
{"target": "A1"}

No extra text. Output only valid JSON with a single target coordinate.""".strip()


PLACEMENT_SCHEMA = {
    "type": "object",
    "properties": {
        "Carrier": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "pattern": "^[A-Ja-j]([1-9]|10)$"},
                "direction": {"type": "string", "pattern": "^[HVhv]$"}
            },
            "required": ["start", "direction"],
            "additionalProperties": False
        },
        "Battleship": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "pattern": "^[A-Ja-j]([1-9]|10)$"},
                "direction": {"type": "string", "pattern": "^[HVhv]$"}
            },
            "required": ["start", "direction"],
            "additionalProperties": False
        },
        "Cruiser": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "pattern": "^[A-Ja-j]([1-9]|10)$"},
                "direction": {"type": "string", "pattern": "^[HVhv]$"}
            },
            "required": ["start", "direction"],
            "additionalProperties": False
        },
        "Submarine": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "pattern": "^[A-Ja-j]([1-9]|10)$"},
                "direction": {"type": "string", "pattern": "^[HVhv]$"}
            },
            "required": ["start", "direction"],
            "additionalProperties": False
        },
        "Destroyer": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "pattern": "^[A-Ja-j]([1-9]|10)$"},
                "direction": {"type": "string", "pattern": "^[HVhv]$"}
            },
            "required": ["start", "direction"],
            "additionalProperties": False
        }
    },
    "required": ["Carrier", "Battleship", "Cruiser", "Submarine", "Destroyer"],
    "additionalProperties": False
}


FIRE_SCHEMA = {
    "type": "object",
    "properties": {
        "target": {"type": "string", "pattern": "^[A-Ja-j]([1-9]|10)$"}
    },
    "required": ["target"],
    "additionalProperties": False
}


def call_claude_placement(user_prompt: str, model: str = "claude-haiku-4-5-20251001") -> tuple[dict, str | None]:
    """
    Call Claude to place ships.
    Returns (placement_dict, reasoning_summary)
    """
    for attempt in range(MAX_RETRIES):
        response = client.beta.messages.create(
            model=model,
            max_tokens=4096,
            thinking={
                "type": "enabled",
                "budget_tokens": 2048,
            },
            betas=["structured-outputs-2025-11-13"],
            system=PLACEMENT_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt}
            ],
            output_format={
                "type": "json_schema",
                "schema": PLACEMENT_SCHEMA
            }
        )

        # Grab thinking summary
        thinking_summary = None
        thinking_parts = []
        for block in response.content:
            if getattr(block, "type", None) == "thinking":
                s = getattr(block, "thinking", None) or getattr(block, "summary", None) or ""
                if s:
                    thinking_parts.append(s)
        if thinking_parts:
            thinking_summary = "\n".join(thinking_parts).strip()

        # Parse JSON response
        json_text = ""
        for block in response.content:
            if getattr(block, "type", None) == "text":
                t = getattr(block, "text", "") or ""
                if t.strip():
                    json_text += t

        if not json_text.strip():
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAY_BASE * (2 ** attempt)
                logging.warning(f"Claude placement returned thinking-only response, retry {attempt+1}/{MAX_RETRIES} in {delay}s")
                time.sleep(delay)
                continue
            raise RuntimeError(f"No text response from Claude model after {MAX_RETRIES} attempts. Response blocks: {[b.type for b in response.content]}")

        try:
            data = json.loads(json_text)
        except json.JSONDecodeError:
            raise RuntimeError(f"Expected JSON from model, got:\n{json_text}")

        # Normalize to uppercase
        placement = {}
        for ship in ['Carrier', 'Battleship', 'Cruiser', 'Submarine', 'Destroyer']:
            placement[ship] = {
                'start': data[ship]['start'].upper(),
                'direction': data[ship]['direction'].upper()
            }

        return placement, thinking_summary
    
    # Should never reach here, but just in case
    raise RuntimeError("Unexpected error in call_claude_placement")


def call_claude_fire(user_prompt: str, model: str = "claude-haiku-4-5-20251001") -> tuple[str, str | None]:
    """
    Call Claude to fire at a coordinate.
    Returns (target_coord, reasoning_summary)
    """
    for attempt in range(MAX_RETRIES):
        response = client.beta.messages.create(
            model=model,
            max_tokens=2048,
            thinking={
                "type": "enabled",
                "budget_tokens": 1024,
            },
            betas=["structured-outputs-2025-11-13"],
            system=FIRE_SYSTEM_PROMPT,
            messages=[
                {"role": "user", "content": user_prompt}
            ],
            output_format={
                "type": "json_schema",
                "schema": FIRE_SCHEMA
            }
        )

        # Grab thinking summary
        thinking_summary = None
        thinking_parts = []
        for block in response.content:
            if getattr(block, "type", None) == "thinking":
                s = getattr(block, "thinking", None) or getattr(block, "summary", None) or ""
                if s:
                    thinking_parts.append(s)
        if thinking_parts:
            thinking_summary = "\n".join(thinking_parts).strip()

        # Parse JSON response
        json_text = ""
        for block in response.content:
            if getattr(block, "type", None) == "text":
                t = getattr(block, "text", "") or ""
                if t.strip():
                    json_text += t

        if not json_text.strip():
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAY_BASE * (2 ** attempt)
                logging.warning(f"Claude fire returned thinking-only response, retry {attempt+1}/{MAX_RETRIES} in {delay}s")
                time.sleep(delay)
                continue
            raise RuntimeError(f"No text response from Claude model after {MAX_RETRIES} attempts. Response blocks: {[b.type for b in response.content]}")

        try:
            data = json.loads(json_text)
        except json.JSONDecodeError:
            raise RuntimeError(f"Expected JSON from model, got:\n{json_text}")

        target = data["target"].upper()
        return target, thinking_summary
    
    # Should never reach here, but just in case
    raise RuntimeError("Unexpected error in call_claude_fire")


# Test
if __name__ == "__main__":
    test_prompt = """You are Player B (Claude) in a game of Battleship.

GRID: 10x10
- Columns: A, B, C, D, E, F, G, H, I, J
- Rows: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10

SHIPS TO PLACE:
- Carrier: 5 cells
- Battleship: 4 cells
- Cruiser: 3 cells
- Submarine: 3 cells
- Destroyer: 2 cells

Place all 5 ships strategically."""

    placement, summary = call_claude_placement(test_prompt)
    print("Placement:", placement)
    print("\n🧠 Reasoning Summary:\n", summary or "No reasoning summary found.")