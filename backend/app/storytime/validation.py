"""Validate cited English narration and authentic voice excerpts before paying for assets."""

import re
from uuid import UUID

from app.models import NarrationScene, SceneVisual, Storyboard, VoiceScene

FIRST_PERSON = re.compile(r"\b(I|me|my|mine|myself|we|our|ours|ourselves)\b", re.IGNORECASE)
YEAR = re.compile(r"\b(?:1[5-9]|20)\d{2}\b")


def validate(board: Storyboard, segments: dict, facts: dict, photos: set[UUID], narrator_id: UUID):
    scenes, problems = [], []
    for index, original in enumerate(board.scenes):
        scene = original.model_copy(deep=True)
        if isinstance(scene, NarrationScene):
            valid = []
            source_text = []
            for cite in scene.cites:
                key = cite.segment_id if cite.kind == "segment" else cite.fact_id
                source = (segments if cite.kind == "segment" else facts).get(key)
                if source:
                    valid.append(cite)
                    source_text.append(str(source["text"]) + " " + str(source.get("year", "")))
                else:
                    problems.append(f"scene {index}: unknown citation")
            scene.cites = valid
            if not valid or FIRST_PERSON.search(scene.narration):
                problems.append(f"scene {index}: narration must be cited and in third person")
                continue
            if not set(YEAR.findall(scene.narration)) <= set(YEAR.findall(" ".join(source_text))):
                problems.append(f"scene {index}: unsupported year")
                continue
        else:
            chosen = [segments[i] for i in scene.segment_ids if i in segments]
            if len(chosen) != len(scene.segment_ids) or not chosen:
                problems.append(f"scene {index}: unknown voice segment")
                continue
            if any(s["narrator_id"] != narrator_id for s in chosen):
                problems.append(f"scene {index}: voice must be the storyteller's original audio")
                continue
            turn = chosen[0]["turn_id"]
            if any(s["turn_id"] != turn for s in chosen):
                problems.append(f"scene {index}: voice segments cross answer turns")
                continue
            ordered = sorted(
                (s for s in segments.values() if s["turn_id"] == turn), key=lambda s: s["start_ms"]
            )
            indexes = [next(i for i, s in enumerate(ordered) if s["id"] == c["id"]) for c in chosen]
            if any(s["turn_id"] != turn for s in chosen) or indexes != list(
                range(indexes[0], indexes[0] + len(indexes))
            ):
                problems.append(f"scene {index}: voice segments must be consecutive in one answer")
                continue
            if chosen[-1]["end_ms"] - chosen[0]["start_ms"] > 20000:
                problems.append(f"scene {index}: choose a complete voice excerpt under 20 seconds")
                continue
        visual = scene.visual
        text = (
            scene.narration
            if isinstance(scene, NarrationScene)
            else " ".join(segments[s]["text"] for s in scene.segment_ids)
        )
        fallback = visual.prompt or f"Illustrate this cited family memory: {text}"
        if visual.source == "family_photo" and visual.media_id not in photos:
            problems.append(f"scene {index}: unknown family photo replaced with illustration")
            scene.visual = SceneVisual(source="generated", prompt=fallback)
        elif visual.source == "generated" and not visual.prompt:
            visual.prompt = fallback
        elif visual.source == "stock" and not visual.stock_query:
            problems.append(f"scene {index}: stock image needs a search query")
            scene.visual = SceneVisual(source="generated", prompt=fallback)
        scenes.append(scene)
    # At least half the imagery comes from the family or imagined illustrations.
    stocks = [s for s in scenes if s.visual.source == "stock"]
    for scene in stocks[len(scenes) // 2 :]:
        scene.visual = SceneVisual(
            source="generated", prompt=scene.visual.prompt or scene.visual.stock_query
        )
    if scenes and photos:
        # Preserve the script's observation-based choice rather than replacing it by UUID order.
        fallback = sorted(photos, key=str)[0]
        for scene in (scenes[0], scenes[-1]):
            if scene.visual.source != "family_photo":
                scene.visual = SceneVisual(source="family_photo", media_id=fallback)
        scenes[-1].visual.motion = "zoom_out"
    voices = sum(isinstance(s, VoiceScene) for s in scenes)
    words = sum(len(s.narration.split()) for s in scenes if isinstance(s, NarrationScene))
    if len(scenes) > 6 or words > 95 or voices > 1:
        problems.append("shorten to at most six scenes, 95 narration words and one voice excerpt")
        return None, problems
    if (
        len(scenes) < 3
        or not 1 <= voices <= 3
        or not any(isinstance(s, NarrationScene) for s in scenes)
    ):
        problems.append("not enough story yet: need three scenes and an original voice clip")
        return None, problems
    return board.model_copy(update={"scenes": scenes}), problems
