"""Offline speech-to-text for Joy Form voice notes (faster-whisper; runs on this PC, no API key).

  python scripts/transcribe.py --check --models-dir tools/whisper/models
  python scripts/transcribe.py --download medium.en --models-dir tools/whisper/models
  python scripts/transcribe.py --jobs jobs.json --models-dir tools/whisper/models [--model auto] [--device auto] [--language en] [--prompt "names"]

jobs.json is a list of {"id", "audio", "out"}; the model is loaded once for the whole list.
Every event is printed to stdout as one JSON object per line.
"""
import argparse
import glob
import json
import os
import site
import sys

CPU_ORDER = ["medium.en", "small.en", "large-v3-turbo", "large-v3", "medium", "small", "base.en"]
GPU_ORDER = ["large-v3", "large-v3-turbo", "medium.en", "medium", "small.en", "small"]
DEFAULT_MODEL = "medium.en"


def emit(**event):
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def site_dirs():
    dirs = set()
    try:
        dirs.update(site.getsitepackages())
    except AttributeError:
        pass
    dirs.add(os.path.join(sys.prefix, "Lib", "site-packages"))
    return [d for d in dirs if os.path.isdir(d)]


def add_cuda_dll_dirs():
    """pip's nvidia-cublas/cudnn wheels keep their DLLs in site-packages/nvidia/<lib>/bin."""
    found = []
    for root in site_dirs():
        for d in glob.glob(os.path.join(root, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
            except (AttributeError, OSError):
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            found.append(d)
    return found


def cuda_device_count():
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count()
    except Exception:  # noqa: BLE001
        return 0


def local_model(models_dir, name):
    path = os.path.join(models_dir, name)
    return path if os.path.isfile(os.path.join(path, "model.bin")) else None


def present_models(models_dir):
    if not os.path.isdir(models_dir):
        return []
    return sorted(n for n in os.listdir(models_dir) if local_model(models_dir, n))


def resolve_model(models_dir, requested, gpu):
    from faster_whisper import download_model

    if requested == "auto":
        order = GPU_ORDER if gpu else CPU_ORDER
        # Prefer a model already on disk; only download when none is present.
        name = next((n for n in order if local_model(models_dir, n)), DEFAULT_MODEL)
    else:
        name = requested
    path = local_model(models_dir, name)
    if not path:
        emit(event="status", message=f"Downloading speech model {name} (one time)...")
        path = download_model(name, output_dir=os.path.join(models_dir, name))
    return name, path


def load_model(models_dir, requested, device):
    import numpy as np
    from faster_whisper import WhisperModel

    add_cuda_dll_dirs()
    if device in ("auto", "cuda") and cuda_device_count() > 0:
        name, path = resolve_model(models_dir, requested, True)
        try:
            model = WhisperModel(path, device="cuda", compute_type="float16")
            # A short warm-up surfaces missing cuBLAS/cuDNN DLLs now instead of mid-note.
            segments, _ = model.transcribe(np.zeros(16000, dtype=np.float32), language="en")
            list(segments)
            return model, name, "cuda"
        except Exception as exc:  # noqa: BLE001 - any GPU failure falls back to the CPU
            emit(event="warning", message=f"GPU not usable, using the CPU instead: {exc}")
            if device == "cuda":
                raise
    name, path = resolve_model(models_dir, requested, False)
    threads = max(1, (os.cpu_count() or 4) - 2)
    return WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=threads), name, "cpu"


def run_jobs(args):
    with open(args.jobs, encoding="utf-8-sig") as handle:
        jobs = json.load(handle)
    emit(event="status", message="Loading the speech model...")
    model, name, device = load_model(args.models_dir, args.model, args.device)
    emit(event="model", model=name, device=device)
    language = None if args.language in ("", "auto") else args.language
    for job in jobs:
        emit(event="start", id=job["id"])
        try:
            segments, info = model.transcribe(
                job["audio"],
                language=language,
                beam_size=5,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 700},
                initial_prompt=args.prompt or None,
                condition_on_previous_text=False,
            )
            parts = []
            for seg in segments:
                parts.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
                if info.duration:
                    emit(event="progress", id=job["id"], ratio=round(min(1.0, seg.end / info.duration), 3))
            result = {
                "text": " ".join(p["text"] for p in parts if p["text"]).strip(),
                "language": info.language,
                "duration": round(info.duration or 0, 2),
                "model": name,
                "device": device,
                "segments": parts,
            }
            with open(job["out"], "w", encoding="utf-8") as handle:
                json.dump(result, handle, ensure_ascii=False, indent=1)
            emit(event="done", id=job["id"])
        except Exception as exc:  # noqa: BLE001 - report per note and keep going
            emit(event="error", id=job["id"], message=str(exc))
    emit(event="finished")


def check(args):
    info = {"ok": False, "python": sys.version.split()[0], "executable": sys.executable}
    try:
        import faster_whisper

        info["fasterWhisper"] = getattr(faster_whisper, "__version__", "installed")
    except Exception as exc:  # noqa: BLE001
        info["error"] = f"faster-whisper is not installed: {exc}"
        emit(event="check", **info)
        return
    dll_dirs = add_cuda_dll_dirs()
    names = set()
    for d in dll_dirs:
        names.update(n.lower() for n in os.listdir(d))
    info.update(
        ok=True,
        cudaDevices=cuda_device_count(),
        cudaLibraries=any(n.startswith("cublas64_") for n in names) and any(n.startswith("cudnn64_") for n in names),
        models=present_models(args.models_dir),
    )
    emit(event="check", **info)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--download")
    parser.add_argument("--jobs")
    parser.add_argument("--model", default="auto")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    parser.add_argument("--language", default="en")
    parser.add_argument("--prompt", default="")
    args = parser.parse_args()
    os.makedirs(args.models_dir, exist_ok=True)
    if args.check:
        check(args)
    elif args.download:
        name, path = resolve_model(args.models_dir, args.download, False)
        emit(event="downloaded", model=name, path=path)
    elif args.jobs:
        run_jobs(args)
    else:
        parser.error("use --check, --download or --jobs")


if __name__ == "__main__":
    main()
