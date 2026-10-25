"""A measured timeline and pure FFmpeg command builder; no shell execution."""

import asyncio
import json
import math
import textwrap
from dataclasses import dataclass
from pathlib import Path

from app.config import get_settings


@dataclass(frozen=True)
class Clip:
    image: str
    audio: str | None
    seconds: float
    text: str = ""
    motion: str = "zoom_in"
    voice: bool = False
    audio_seconds: float | None = None


@dataclass(frozen=True)
class RenderPlan:
    clips: list[Clip]
    captions: str
    music: str
    output: str
    width: int = 1280
    height: int = 720
    fps: int = 24
    transition: float = 0.5

    @property
    def starts(self) -> list[float]:
        result, cursor = [], 0.0
        for clip in self.clips:
            result.append(cursor)
            cursor += clip.seconds - self.transition
        return result

    @property
    def duration(self) -> float:
        return sum(c.seconds for c in self.clips) - self.transition * (len(self.clips) - 1)


def filter_path(path: str) -> str:
    return path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def build_ffmpeg_args(plan: RenderPlan) -> list[str]:
    if not plan.clips or any(c.seconds <= plan.transition for c in plan.clips):
        raise ValueError("Every scene must outlast its transition")
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-filter_complex_threads", "1"]
    for clip in plan.clips:
        # Decode/scale each still once. zoompan emits the frames for its entire scene.
        args += ["-i", clip.image]
    count = len(plan.clips)
    audio_inputs = {}
    for i, clip in enumerate(plan.clips):
        if clip.audio:
            audio_inputs[i] = count + len(audio_inputs)
            args += ["-i", clip.audio]
    music_index = count + len(audio_inputs)
    args += ["-stream_loop", "-1", "-i", plan.music]
    filters = []
    for i, clip in enumerate(plan.clips):
        zoom = "max(1.0,1.06-on*0.00015)" if clip.motion == "zoom_out" else "min(1.06,1+on*0.00015)"
        x = "iw/2-iw/zoom/2"
        if clip.motion in ("pan_left", "pan_right"):
            zoom = "1.06"
            ratio = f"min(on/{max(1, math.ceil(clip.seconds * plan.fps) - 1)},1)"
            x = (
                f"(iw-iw/zoom)*({ratio})"
                if clip.motion == "pan_right"
                else f"(iw-iw/zoom)*(1-{ratio})"
            )
        filters.append(
            f"[{i}:v]scale={plan.width * 2}:{plan.height * 2}:force_original_aspect_ratio=increase,"
            f"crop={plan.width * 2}:{plan.height * 2},setsar=1,"
            f"zoompan=z='{zoom}':x='{x}':y='ih/2-ih/zoom/2':"
            f"d={math.ceil(clip.seconds * plan.fps)}:"
            f"s={plan.width}x{plan.height}:fps={plan.fps},format=yuv420p,"
            f"settb=AVTB,setpts=PTS-STARTPTS[v{i}]"
        )
    video = "v0"
    for i in range(1, count):
        filters.append(
            f"[{video}][v{i}]xfade=transition=fade:duration={plan.transition}:"
            f"offset={plan.starts[i]:.6f},fps={plan.fps},settb=AVTB[x{i}]"
        )
        video = f"x{i}"
    filters.append(f"[{video}]subtitles='{filter_path(plan.captions)}'[video]")
    # A silent bed makes the intro, pauses, and credits explicit parts of the timeline.
    filters.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={plan.duration:.6f}[silence]")
    audio_labels = ["[silence]"]
    for i, index in audio_inputs.items():
        delay = round(plan.starts[i] * 1000)
        filters.append(
            f"[{index}:a]aresample=48000,aformat=channel_layouts=stereo,"
            f"asetpts=PTS-STARTPTS,adelay={delay}|{delay}[a{i}]"
        )
        audio_labels.append(f"[a{i}]")
    filters.append(
        "".join(audio_labels) + f"amix=inputs={len(audio_labels)}:normalize=0,"
        f"atrim=duration={plan.duration:.6f},asplit=2[speech][sidechain]"
    )
    muted = "+".join(
        f"between(t,{plan.starts[i]:.6f},{plan.starts[i] + c.seconds - plan.transition:.6f})"
        for i, c in enumerate(plan.clips)
        if c.voice
    )
    mute = f",volume=0:enable='{muted}'" if muted else ""
    filters.append(
        f"[{music_index}:a]aresample=48000,aformat=channel_layouts=stereo,"
        f"atrim=duration={plan.duration:.6f},volume=0.07943{mute}[music]"
    )
    filters.append(
        "[music][sidechain]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=300[ducked]"
    )
    filters.append("[speech][ducked]amix=inputs=2:normalize=0,alimiter=limit=0.95[audio]")
    args += [
        "-filter_complex",
        ";".join(filters),
        "-map",
        "[video]",
        "-map",
        "[audio]",
        "-t",
        f"{plan.duration:.6f}",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-threads",
        "2",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        plan.output,
    ]
    return args


def ass_text(text: str) -> str:
    return text.replace("\\", "").replace("{", "").replace("}", "").replace("\n", " ")


def timestamp(seconds: float) -> str:
    cs = round(seconds * 100)
    return f"{cs // 360000}:{cs // 6000 % 60:02}:{cs // 100 % 60:02}.{cs % 100:02}"


ASS_LINE_0 = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineCo"
    "lour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spaci"
    "ng, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, Margi"
    "nV, Encoding"
)

ASS_LINE_1 = (
    "Style: Default,Arial,36,&H00F5F5F5,&H00FFFFFF,&H00181818,&H80000000,0,0,0,0"
    ",100,100,0,0,1,2,1,2,55,55,48,1"
)

ASS_LINE_2 = (
    "Style: Card,Arial,36,&H00F5F5F5,&H00FFFFFF,&H00181818,&H80000000,0,0,0,0,10"
    "0,100,0,0,1,2,1,5,65,65,40,1"
)

ASS_BADGE = (
    "Style: Badge,Arial,26,&H00F5F5F5,&H00FFFFFF,&H00181818,&H80000000,0,0,0,0,"
    "100,100,0,0,1,2,1,8,55,55,28,1"
)


def captions(plan: RenderPlan, title: str, narrator: str, credits: list[str]) -> str:
    out = [
        f"""[Script Info]
ScriptType: v4.00+
PlayResX: {plan.width}
PlayResY: {plan.height}
WrapStyle: 0
[V4+ Styles]
{ASS_LINE_0}
{ASS_LINE_1}
{ASS_LINE_2}
{ASS_BADGE}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"""
    ]

    def add(start, end, text, style="Default"):
        out.append(f"Dialogue: 0,{timestamp(start)},{timestamp(end)},{style},,0,0,0,,{text}")

    add(
        0,
        min(plan.starts[1] if len(plan.clips) > 1 else plan.duration, 4),
        ass_text(title) + r"\N\N" + ass_text(f"Narrated by AI from {narrator}'s own words"),
        "Card",
    )
    for i, clip in enumerate(plan.clips):
        if not clip.text:
            continue
        chunks = textwrap.wrap(ass_text(clip.text), width=85, break_long_words=False)
        duration = (
            clip.audio_seconds
            if clip.audio_seconds is not None
            else max(0.1, clip.seconds - plan.transition - (0.5 if clip.voice else 0.3))
        )
        total = max(1, sum(len(t) for t in chunks))
        cursor = plan.starts[i]
        for chunk in chunks:
            end = cursor + duration * len(chunk) / total
            lines = r"\N".join(textwrap.wrap(chunk, width=44, break_long_words=False))
            add(cursor, end, lines)
            cursor = end
        if clip.voice:
            add(
                plan.starts[i],
                plan.starts[i] + min(3, duration),
                ass_text(f"{narrator}, in their own words"),
                "Badge",
            )
    end_text = ass_text(f"Told by {narrator}")
    if credits:
        end_text += r"\N\N" + r"\N".join(ass_text(t) for t in credits)
    add(plan.starts[-1], plan.duration, end_text, "Card")
    return "\n".join(out) + "\n"


async def execute(args: list[str], *, seconds_limit: float = 600) -> bytes:
    # Explicit paths avoid uv/service PATH differences and Homebrew's keg-only libass build.
    settings = get_settings()
    binary = {"ffmpeg": settings.ffmpeg_binary, "ffprobe": settings.ffprobe_binary}.get(
        args[0], args[0]
    )
    proc = await asyncio.create_subprocess_exec(
        binary, *args[1:], stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), seconds_limit)
    except BaseException:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        raise
    if proc.returncode:
        raise RuntimeError(f"Media processing failed: {err.decode(errors='replace')[-1000:]}")
    return out


async def duration(path: Path) -> float:
    out = await execute(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        seconds_limit=30,
    )
    return float(json.loads(out)["format"]["duration"])
