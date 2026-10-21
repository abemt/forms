"""Convert an audio file to a Telegram-style voice note (OGG/Opus, mono, 48 kHz). Used by the voice tests.

  python scripts/wav-to-ogg.py input.wav output.ogg
"""
import sys

import av


def main(src, dst):
    with av.open(src) as inp, av.open(dst, "w", format="ogg") as out:
        stream = out.add_stream("libopus", rate=48000)
        stream.layout = "mono"
        resampler = av.AudioResampler(format="s16", layout="mono", rate=48000)
        for frame in inp.decode(audio=0):
            for chunk in resampler.resample(frame):
                for packet in stream.encode(chunk):
                    out.mux(packet)
        for chunk in resampler.resample(None):
            for packet in stream.encode(chunk):
                out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
