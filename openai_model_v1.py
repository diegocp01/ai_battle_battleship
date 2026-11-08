from __future__ import annotations

from openai import OpenAI
from pydantic import BaseModel, Field
from typing import Dict
from dotenv import load_dotenv
load_dotenv()
client = OpenAI()


# Structured response for ship placement
class ShipPlacement(BaseModel):
    start: str = Field(pattern=r"^[A-Ja-j]([1-9]|10)$")
    direction: str = Field(pattern=r"^[HVhv]$")


class PlacementAnswer(BaseModel):
    Carrier: ShipPlacement
    Battleship: ShipPlacement
    Cruiser: ShipPlacement
    Submarine: ShipPlacement
    Destroyer: ShipPlacement


# Structured response for firing
class FireAnswer(BaseModel):
    target: str = Field(pattern=r"^[A-Ja-j]([1-9]|10)$")


def call_chatgpt_placement(user_prompt: str, model: str = "gpt-5.1") -> tuple[dict, str | None]:
    """
    Call ChatGPT to place ships.
    Returns (placement_dict, reasoning_summary)
    """
    response = client.responses.parse(
        model=model,
        input=[
            {"role": "system", "content": """You are a Battleship ship placement generator.

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
  ...etc for all 5 ships
}

No extra text. Output only valid JSON."""},
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
        text_format=PlacementAnswer,
        reasoning={
            "effort": "medium",
            "summary": "auto"
        },
    )
    
    # Parse the placement
    parsed = response.output_parsed
    placement = {
        'Carrier': {'start': parsed.Carrier.start.upper(), 'direction': parsed.Carrier.direction.upper()},
        'Battleship': {'start': parsed.Battleship.start.upper(), 'direction': parsed.Battleship.direction.upper()},
        'Cruiser': {'start': parsed.Cruiser.start.upper(), 'direction': parsed.Cruiser.direction.upper()},
        'Submarine': {'start': parsed.Submarine.start.upper(), 'direction': parsed.Submarine.direction.upper()},
        'Destroyer': {'start': parsed.Destroyer.start.upper(), 'direction': parsed.Destroyer.direction.upper()},
    }

    # Get reasoning summary
    reasoning_summary = None
    for item in response.output:
        if getattr(item, "type", None) == "reasoning":
            parts = []
            for s in (item.summary or []):
                if getattr(s, "text", None):
                    parts.append(s.text)
            if parts:
                reasoning_summary = "\n".join(parts)
            break

    return placement, reasoning_summary


def call_chatgpt_fire(user_prompt: str, model: str = "gpt-5.1") -> tuple[str, str | None]:
    """
    Call ChatGPT to fire at a coordinate.
    Returns (target_coord, reasoning_summary)
    """
    response = client.responses.parse(
        model=model,
        input=[
            {"role": "system", "content": """You are a Battleship targeting AI.

RULES:
- Grid is 10x10: columns A-J, rows 1-10
- Choose ONE coordinate to fire at
- Pick coordinates you haven't fired at before
- Use strategy: if you hit something, try adjacent cells

OUTPUT FORMAT (strict):
Output only a valid coordinate like: A1, B5, J10
No extra text."""},
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
        text_format=FireAnswer,
        reasoning={
            "effort": "medium",
            "summary": "auto"
        },
    )
    
    target = response.output_parsed.target.upper()

    # Get reasoning summary
    reasoning_summary = None
    for item in response.output:
        if getattr(item, "type", None) == "reasoning":
            parts = []
            for s in (item.summary or []):
                if getattr(s, "text", None):
                    parts.append(s.text)
            if parts:
                reasoning_summary = "\n".join(parts)
            break

    return target, reasoning_summary


# Test
if __name__ == "__main__":
    test_prompt = """You are Player A (GPT) in a game of Battleship.

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

    placement, summary = call_chatgpt_placement(test_prompt)
    print("Placement:", placement)
    print("\n🧠 Reasoning Summary:\n", summary or "No reasoning summary found.")